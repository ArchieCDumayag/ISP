const express = require('express');
const createError = require('http-errors');
const { readJson, writeJson } = require('./data-store');
const { query, isMysqlEnabled } = require('./db');
const { accountHasRole } = require('./role-utils');
const { isJsonStorageMode } = require('./storage-mode');

const router = express.Router();
const STORE_KEY_PREFIX = 'finance_payroll_branch_';
const MAX_ATTENDANCE_DAYS = 62;
const ALLOWED_ATTENDANCE_STATUSES = new Set(['absent', 'half-day', 'whole-day']);
const legacyImportByBranch = new Map();
const useJsonPayrollStorage = () => isJsonStorageMode() || !isMysqlEnabled();

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

const normalizeDateTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) return '';
    return parsed.toISOString();
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

const parseJsonText = (value, fallback) => {
    if (value == null || value === '') return fallback;
    try {
        const parsed = JSON.parse(value);
        return parsed == null ? fallback : parsed;
    } catch {
        return fallback;
    }
};

const parseJsonPayload = (value, fallback) => {
    if (value == null || value === '') return fallback;
    if (typeof value === 'string') return parseJsonText(value, fallback);
    return value == null ? fallback : value;
};

const normalizeBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return Boolean(fallback);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const raw = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return Boolean(fallback);
};

const normalizeAmount = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Number(amount.toFixed(2));
};

const normalizeDebtRows = (value, fallbackValue = []) => {
    const sourceRows = Array.isArray(value) ? value : (Array.isArray(fallbackValue) ? fallbackValue : []);
    if (!sourceRows.length) return [];

    return sourceRows
        .map((entry) => {
            const safeEntry = entry && typeof entry === 'object' ? entry : {};
            const date = normalizeDateOnly(safeEntry.date || safeEntry.takenOn || safeEntry.day);
            const amount = normalizeAmount(safeEntry.amount);
            if (!date || amount == null || amount <= 0) return null;
            return {
                date,
                amount
            };
        })
        .filter(Boolean)
        .sort((left, right) => {
            const leftTime = parseDateOnlyUtc(left.date)?.getTime() || 0;
            const rightTime = parseDateOnlyUtc(right.date)?.getTime() || 0;
            return leftTime - rightTime;
        });
};

const summarizeDebt = (rows = []) => ({
    count: rows.length,
    total: Number(rows.reduce((sum, row) => sum + (Number(row?.amount) || 0), 0).toFixed(2))
});

const normalizeAttendanceStatus = (value, options = {}) => {
    const allowUnset = options && options.allowUnset === true;
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return allowUnset ? '' : 'absent';
    if (raw === 'halfday' || raw === 'half day') return 'half-day';
    if (raw === 'fullday' || raw === 'full day' || raw === 'wholeday' || raw === 'whole day') return 'whole-day';
    return ALLOWED_ATTENDANCE_STATUSES.has(raw) ? raw : (allowUnset ? '' : 'absent');
};

const parseDateOnlyUtc = (value) => {
    const dateOnly = normalizeDateOnly(value);
    if (!dateOnly) return null;
    const [year, month, day] = dateOnly.split('-').map((part) => Number(part));
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const getPeriodDaySpan = (periodStart, periodEnd) => {
    const start = parseDateOnlyUtc(periodStart);
    const end = parseDateOnlyUtc(periodEnd);
    if (!start || !end) return 0;
    const diff = end.getTime() - start.getTime();
    if (!Number.isFinite(diff) || diff < 0) return 0;
    return Math.floor(diff / 86_400_000) + 1;
};

const buildDefaultAttendance = (periodStart, periodEnd) => {
    const baseDate = parseDateOnlyUtc(periodStart);
    const spanDays = getPeriodDaySpan(periodStart, periodEnd);
    if (!baseDate || spanDays <= 0) return [];
    return Array.from({ length: spanDays }, (_entry, index) => {
        const current = new Date(baseDate);
        current.setUTCDate(baseDate.getUTCDate() + index);
        return {
            day: index + 1,
            date: current.toISOString().slice(0, 10),
            status: ''
        };
    });
};

const normalizeAttendance = (value, periodStart, periodEnd, fallbackValue = []) => {
    const baseRows = buildDefaultAttendance(periodStart, periodEnd);
    if (!baseRows.length) return [];
    const sourceRows = Array.isArray(value) ? value : Array.isArray(fallbackValue) ? fallbackValue : [];
    if (!sourceRows.length) return baseRows;

    const statusByDate = new Map();
    const statusByDay = new Map();
    sourceRows.forEach((entry, index) => {
        const safeEntry = entry && typeof entry === 'object' ? entry : {};
        const status = normalizeAttendanceStatus(safeEntry.status, { allowUnset: true });
        const date = normalizeDateOnly(safeEntry.date);
        const dayRaw = Number(safeEntry.day ?? safeEntry.dayNumber ?? index + 1);
        if (date) statusByDate.set(date, status);
        if (Number.isInteger(dayRaw) && dayRaw >= 1 && dayRaw <= baseRows.length) {
            statusByDay.set(dayRaw, status);
        }
    });

    return baseRows.map((row) => ({
        ...row,
        status: statusByDate.get(row.date) || statusByDay.get(row.day) || row.status
    }));
};

const summarizeAttendance = (rows = []) => {
    const summary = {
        wholeDayCount: 0,
        halfDayCount: 0,
        absentCount: 0,
        unsetCount: 0,
        daysPresent: 0,
        paidDays: 0
    };
    rows.forEach((row) => {
        const status = normalizeAttendanceStatus(row?.status, { allowUnset: true });
        if (status === 'whole-day') {
            summary.wholeDayCount += 1;
            summary.daysPresent += 1;
            summary.paidDays += 1;
            return;
        }
        if (status === 'half-day') {
            summary.halfDayCount += 1;
            summary.daysPresent += 1;
            summary.paidDays += 0.5;
            return;
        }
        if (status === 'absent') {
            summary.absentCount += 1;
            return;
        }
        summary.unsetCount += 1;
    });
    summary.paidDays = Number(summary.paidDays.toFixed(2));
    return summary;
};

const computeGrossFromAttendance = (ratePerDay, attendanceSummary) => {
    const safeRate = Number(ratePerDay) || 0;
    const paidDays = Number(attendanceSummary?.paidDays) || 0;
    return Number((safeRate * paidDays).toFixed(2));
};

const computeNetPay = (grossPay, deductions) => Number(Math.max(grossPay - deductions, 0).toFixed(2));

const resolveBranchId = (req) => {
    const branchId = Number(req.user?.branchId || 0);
    return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
};

const buildStoreKey = (branchId) => `${STORE_KEY_PREFIX}${branchId}`;

const readJsonPayroll = async (branchId) => {
    const storeKey = buildStoreKey(branchId);
    const items = await readJson(storeKey, []);
    return (Array.isArray(items) ? items : []).map((item) => hydratePayrollEntry(item));
};

const writeJsonPayroll = async (branchId, items) => {
    const storeKey = buildStoreKey(branchId);
    const normalized = (Array.isArray(items) ? items : []).map((item) => hydratePayrollEntry(item));
    await writeJson(storeKey, normalized);
};

const mapPayrollRow = (row = {}) => ({
    id: toSafeText(row.id, 80),
    payDate: normalizeDateOnly(row.pay_date || row.payDate),
    periodStart: normalizeDateOnly(row.period_start || row.periodStart),
    periodEnd: normalizeDateOnly(row.period_end || row.periodEnd),
    employeeName: toSafeText(row.employee_name || row.employeeName, 140),
    role: toSafeText(row.role, 120),
    ratePerDay: normalizeAmount(row.rate_per_day ?? row.ratePerDay ?? row.gross_pay ?? row.grossPay),
    grossPay: normalizeAmount(row.gross_pay ?? row.grossPay),
    deductions: normalizeAmount(row.deductions),
    netPay: normalizeAmount(row.net_pay ?? row.netPay),
    notes: toSafeText(row.notes, 1200),
    submitted: normalizeBoolean(row.submitted, false),
    submittedAt: normalizeDateTime(row.submitted_at || row.submittedAt),
    attendance: parseJsonText(row.attendance_json ?? row.attendance, []),
    attendanceSummary: parseJsonText(row.attendance_summary_json ?? row.attendanceSummary, {}),
    debts: parseJsonText(row.debts_json ?? row.debts, []),
    debtTotal: normalizeAmount(row.debt_total ?? row.debtTotal),
    debtCount: Number(row.debt_count ?? row.debtCount) || 0,
    createdAt: normalizeDateTime(row.created_at || row.createdAt),
    updatedAt: normalizeDateTime(row.updated_at || row.updatedAt),
    createdByUserId: row.created_by_user_id != null ? String(row.created_by_user_id) : '',
    createdByUsername: toSafeText(row.created_by_username, 100),
    createdByName: toSafeText(row.created_by_name, 120),
    createdBy: toSafeText(row.created_by_username || row.created_by_name || row.createdBy, 120)
});

const toDbPayrollRecord = (branchId, entry = {}, actor = {}) => {
    const hydrated = hydratePayrollEntry(entry);
    const attendance = normalizeAttendance(
        hydrated.attendance,
        hydrated.periodStart,
        hydrated.periodEnd,
        hydrated.attendance
    );
    const attendanceSummary = summarizeAttendance(attendance);
    const debts = normalizeDebtRows(hydrated.debts, hydrated.debtEntries);
    const debtSummary = summarizeDebt(debts);

    const recordId = toSafeText(hydrated.id || entry.id, 80) || `payroll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdByUserId = actor.userId != null
        ? String(actor.userId)
        : (entry.createdByUserId != null ? String(entry.createdByUserId) : null);
    const createdByUsername = toSafeText(
        actor.username || entry.createdByUsername || entry.createdBy || '',
        100
    ) || null;
    const createdByName = toSafeText(
        actor.name || entry.createdByName || '',
        120
    ) || null;

    return {
        id: recordId,
        branchId,
        payDate: normalizeDateOnly(hydrated.payDate),
        periodStart: normalizeDateOnly(hydrated.periodStart),
        periodEnd: normalizeDateOnly(hydrated.periodEnd),
        employeeName: toSafeText(hydrated.employeeName, 140),
        role: toSafeText(hydrated.role, 120),
        notes: toSafeText(hydrated.notes, 1200),
        ratePerDay: normalizeAmount(hydrated.ratePerDay) || 0,
        grossPay: normalizeAmount(hydrated.grossPay) || 0,
        deductions: normalizeAmount(hydrated.deductions ?? 0) || 0,
        netPay: normalizeAmount(hydrated.netPay ?? 0) || 0,
        submitted: normalizeBoolean(hydrated.submitted, false),
        submittedAt: normalizeBoolean(hydrated.submitted, false)
            ? toMysqlDateTime(hydrated.submittedAt, { fallbackToNow: true })
            : null,
        attendanceJson: JSON.stringify(attendance),
        attendanceSummaryJson: JSON.stringify(attendanceSummary),
        debtsJson: JSON.stringify(debts),
        debtTotal: debtSummary.total,
        debtCount: debtSummary.count,
        createdAt: toMysqlDateTime(hydrated.createdAt, { fallbackToNow: true }),
        updatedAt: toMysqlDateTime(hydrated.updatedAt, { fallbackToNow: true }),
        createdByUserId,
        createdByUsername,
        createdByName
    };
};

const payrollRecordToJsonEntry = (record = {}) => hydratePayrollEntry({
    id: toSafeText(record.id, 80),
    payDate: normalizeDateOnly(record.payDate || record.pay_date),
    periodStart: normalizeDateOnly(record.periodStart || record.period_start),
    periodEnd: normalizeDateOnly(record.periodEnd || record.period_end),
    employeeName: toSafeText(record.employeeName || record.employee_name, 140),
    role: toSafeText(record.role, 120),
    ratePerDay: normalizeAmount(record.ratePerDay ?? record.rate_per_day ?? record.grossPay ?? record.gross_pay),
    grossPay: normalizeAmount(record.grossPay ?? record.gross_pay),
    deductions: normalizeAmount(record.deductions ?? 0) || 0,
    netPay: normalizeAmount(record.netPay ?? record.net_pay),
    notes: toSafeText(record.notes, 1200),
    submitted: normalizeBoolean(record.submitted, false),
    submittedAt: normalizeDateTime(record.submittedAt || record.submitted_at),
    attendance: parseJsonPayload(record.attendanceJson ?? record.attendance_json ?? record.attendance, []),
    attendanceSummary: parseJsonPayload(record.attendanceSummaryJson ?? record.attendance_summary_json ?? record.attendanceSummary, {}),
    debts: parseJsonPayload(record.debtsJson ?? record.debts_json ?? record.debts, []),
    debtTotal: normalizeAmount(record.debtTotal ?? record.debt_total),
    debtCount: Number(record.debtCount ?? record.debt_count) || 0,
    createdAt: normalizeDateTime(record.createdAt || record.created_at),
    updatedAt: normalizeDateTime(record.updatedAt || record.updated_at),
    createdByUserId: record.createdByUserId != null
        ? String(record.createdByUserId)
        : (record.created_by_user_id != null ? String(record.created_by_user_id) : ''),
    createdByUsername: toSafeText(record.createdByUsername || record.created_by_username, 100),
    createdByName: toSafeText(record.createdByName || record.created_by_name, 120),
    createdBy: toSafeText(
        record.createdByUsername ||
        record.created_by_username ||
        record.createdByName ||
        record.created_by_name ||
        record.createdBy,
        120
    )
});

const insertPayrollRecord = async (record, { upsert = false } = {}) => {
    if (useJsonPayrollStorage()) {
        const items = await readJsonPayroll(record.branchId);
        const entry = payrollRecordToJsonEntry(record);
        const existingIndex = items.findIndex((item) => String(item?.id || '') === String(entry.id));
        if (existingIndex >= 0) {
            if (!upsert) {
                throw createError(409, 'Payroll entry already exists.');
            }
            items[existingIndex] = hydratePayrollEntry({
                ...items[existingIndex],
                ...entry,
                createdAt: items[existingIndex].createdAt || entry.createdAt,
                createdBy: items[existingIndex].createdBy || entry.createdBy,
                createdByUserId: items[existingIndex].createdByUserId || entry.createdByUserId,
                createdByUsername: items[existingIndex].createdByUsername || entry.createdByUsername,
                createdByName: items[existingIndex].createdByName || entry.createdByName
            });
        } else {
            items.push(entry);
        }
        await writeJsonPayroll(record.branchId, items);
        return { affectedRows: existingIndex >= 0 ? 2 : 1 };
    }

    const sql = upsert
        ? `INSERT INTO finance_payroll (
                id, branch_id, pay_date, period_start, period_end, employee_name, role,
                rate_per_day, gross_pay, deductions, net_pay, notes, submitted, submitted_at,
                attendance_json, attendance_summary_json, debts_json, debt_total, debt_count,
                created_at, updated_at, created_by_user_id, created_by_username, created_by_name
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
                pay_date = VALUES(pay_date),
                period_start = VALUES(period_start),
                period_end = VALUES(period_end),
                employee_name = VALUES(employee_name),
                role = VALUES(role),
                rate_per_day = VALUES(rate_per_day),
                gross_pay = VALUES(gross_pay),
                deductions = VALUES(deductions),
                net_pay = VALUES(net_pay),
                notes = VALUES(notes),
                submitted = VALUES(submitted),
                submitted_at = VALUES(submitted_at),
                attendance_json = VALUES(attendance_json),
                attendance_summary_json = VALUES(attendance_summary_json),
                debts_json = VALUES(debts_json),
                debt_total = VALUES(debt_total),
                debt_count = VALUES(debt_count),
                updated_at = VALUES(updated_at),
                created_by_user_id = VALUES(created_by_user_id),
                created_by_username = VALUES(created_by_username),
                created_by_name = VALUES(created_by_name)`
        : `INSERT INTO finance_payroll (
                id, branch_id, pay_date, period_start, period_end, employee_name, role,
                rate_per_day, gross_pay, deductions, net_pay, notes, submitted, submitted_at,
                attendance_json, attendance_summary_json, debts_json, debt_total, debt_count,
                created_at, updated_at, created_by_user_id, created_by_username, created_by_name
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    await query(sql, [
        record.id,
        record.branchId,
        record.payDate,
        record.periodStart,
        record.periodEnd,
        record.employeeName,
        record.role || null,
        record.ratePerDay,
        record.grossPay,
        record.deductions,
        record.netPay,
        record.notes || null,
        record.submitted ? 1 : 0,
        record.submittedAt,
        record.attendanceJson,
        record.attendanceSummaryJson,
        record.debtsJson,
        record.debtTotal,
        record.debtCount,
        record.createdAt,
        record.updatedAt,
        record.createdByUserId,
        record.createdByUsername,
        record.createdByName
    ]);
};

const updatePayrollRecord = async (record) => {
    if (useJsonPayrollStorage()) {
        const items = await readJsonPayroll(record.branchId);
        const existingIndex = items.findIndex((item) => String(item?.id || '') === String(record.id));
        if (existingIndex < 0) return { affectedRows: 0 };
        const entry = payrollRecordToJsonEntry(record);
        items[existingIndex] = hydratePayrollEntry({
            ...items[existingIndex],
            ...entry,
            id: record.id,
            createdAt: items[existingIndex].createdAt || entry.createdAt,
            createdBy: items[existingIndex].createdBy || entry.createdBy,
            createdByUserId: items[existingIndex].createdByUserId || entry.createdByUserId,
            createdByUsername: items[existingIndex].createdByUsername || entry.createdByUsername,
            createdByName: items[existingIndex].createdByName || entry.createdByName
        });
        await writeJsonPayroll(record.branchId, items);
        return { affectedRows: 1 };
    }

    const [result] = await query(
        `UPDATE finance_payroll
         SET pay_date = ?,
             period_start = ?,
             period_end = ?,
             employee_name = ?,
             role = ?,
             rate_per_day = ?,
             gross_pay = ?,
             deductions = ?,
             net_pay = ?,
             notes = ?,
             submitted = ?,
             submitted_at = ?,
             attendance_json = ?,
             attendance_summary_json = ?,
             debts_json = ?,
             debt_total = ?,
             debt_count = ?,
             updated_at = ?
         WHERE id = ? AND branch_id = ?`,
        [
            record.payDate,
            record.periodStart,
            record.periodEnd,
            record.employeeName,
            record.role || null,
            record.ratePerDay,
            record.grossPay,
            record.deductions,
            record.netPay,
            record.notes || null,
            record.submitted ? 1 : 0,
            record.submittedAt,
            record.attendanceJson,
            record.attendanceSummaryJson,
            record.debtsJson,
            record.debtTotal,
            record.debtCount,
            record.updatedAt,
            record.id,
            record.branchId
        ]
    );
    return result;
};

const getPayrollById = async (branchId, entryId) => {
    if (useJsonPayrollStorage()) {
        const items = await readJsonPayroll(branchId);
        return items.find((item) => String(item?.id || '') === String(entryId)) || null;
    }

    const [rows] = await query(
        `SELECT
            id,
            branch_id,
            pay_date,
            period_start,
            period_end,
            employee_name,
            role,
            rate_per_day,
            gross_pay,
            deductions,
            net_pay,
            notes,
            submitted,
            submitted_at,
            attendance_json,
            attendance_summary_json,
            debts_json,
            debt_total,
            debt_count,
            created_at,
            updated_at,
            created_by_user_id,
            created_by_username,
            created_by_name
         FROM finance_payroll
         WHERE id = ? AND branch_id = ?
         LIMIT 1`,
        [entryId, branchId]
    );
    if (!rows || !rows.length) return null;
    return hydratePayrollEntry(mapPayrollRow(rows[0]));
};

const ensureLegacyPayrollImported = async (branchId) => {
    if (!branchId) return;
    if (useJsonPayrollStorage()) return;
    if (legacyImportByBranch.has(branchId)) {
        return legacyImportByBranch.get(branchId);
    }
    const promise = (async () => {
        const [countRows] = await query(
            'SELECT COUNT(*) AS total FROM finance_payroll WHERE branch_id = ?',
            [branchId]
        );
        const existingTotal = Number(countRows?.[0]?.total || 0);
        if (existingTotal > 0) return;

        const storeKey = buildStoreKey(branchId);
        const legacyItems = await readJson(storeKey, []);
        const list = Array.isArray(legacyItems) ? legacyItems : [];
        for (const item of list) {
            const record = toDbPayrollRecord(branchId, item, {});
            await insertPayrollRecord(record, { upsert: true });
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

const readBranchPayroll = async (branchId) => {
    if (useJsonPayrollStorage()) {
        return readJsonPayroll(branchId);
    }

    await ensureLegacyPayrollImported(branchId);
    const [rows] = await query(
        `SELECT
            id,
            branch_id,
            pay_date,
            period_start,
            period_end,
            employee_name,
            role,
            rate_per_day,
            gross_pay,
            deductions,
            net_pay,
            notes,
            submitted,
            submitted_at,
            attendance_json,
            attendance_summary_json,
            debts_json,
            debt_total,
            debt_count,
            created_at,
            updated_at,
            created_by_user_id,
            created_by_username,
            created_by_name
         FROM finance_payroll
         WHERE branch_id = ?
         ORDER BY pay_date DESC, updated_at DESC, id DESC`,
        [branchId]
    );
    return (rows || []).map((row) => hydratePayrollEntry(mapPayrollRow(row)));
};

const hydratePayrollEntry = (entry = {}) => {
    const payDate = normalizeDateOnly(entry?.payDate);
    const periodStart = normalizeDateOnly(entry?.periodStart);
    const periodEnd = normalizeDateOnly(entry?.periodEnd);
    const attendance = normalizeAttendance(entry?.attendance, periodStart, periodEnd, entry?.attendance);
    const attendanceSummary = summarizeAttendance(attendance);
    const debts = normalizeDebtRows(entry?.debts, entry?.debtEntries);
    const debtSummary = summarizeDebt(debts);

    const deductionsNormalized = normalizeAmount(entry?.deductions ?? 0);
    const deductions = deductionsNormalized == null ? 0 : deductionsNormalized;

    const normalizedRatePerDay = normalizeAmount(entry?.ratePerDay);
    const normalizedGrossPay = normalizeAmount(entry?.grossPay);
    const normalizedNetPay = normalizeAmount(entry?.netPay);

    let ratePerDay = normalizedRatePerDay;
    let grossPay = normalizedGrossPay;
    let netPay = normalizedNetPay;

    if (ratePerDay != null && ratePerDay > 0) {
        grossPay = computeGrossFromAttendance(ratePerDay, attendanceSummary);
        netPay = computeNetPay(grossPay, deductions);
    } else {
        if (grossPay == null) grossPay = 0;
        if (netPay == null) netPay = computeNetPay(grossPay, deductions);
        ratePerDay = grossPay > 0 ? grossPay : 0;
    }

    const submitted = normalizeBoolean(entry?.submitted, false);
    const submittedAt = submitted
        ? (
            normalizeDateTime(entry?.submittedAt) ||
            normalizeDateTime(entry?.updatedAt) ||
            normalizeDateTime(entry?.createdAt)
        )
        : '';

    return {
        ...entry,
        payDate,
        periodStart,
        periodEnd,
        ratePerDay,
        deductions,
        grossPay,
        netPay,
        submitted,
        submittedAt,
        debts,
        debtTotal: debtSummary.total,
        debtCount: debtSummary.count,
        attendance,
        attendanceSummary
    };
};

const sortByDateDesc = (rows = []) =>
    rows.slice().sort((left, right) => {
        const leftTs = new Date(left?.payDate || left?.updatedAt || left?.createdAt || 0).getTime();
        const rightTs = new Date(right?.payDate || right?.updatedAt || right?.createdAt || 0).getTime();
        return rightTs - leftTs;
    });

router.use((req, _res, next) => {
    if (!accountHasRole(req.user, 'Admin')) {
        return next(createError(403, 'Admin access required.'));
    }
    const branchId = resolveBranchId(req);
    if (!branchId) {
        return next(createError(400, 'Branch assignment missing for this admin account.'));
    }
    req.branchId = branchId;
    return ensureLegacyPayrollImported(branchId)
        .then(() => next())
        .catch(next);
});

router.get('/', async (req, res, next) => {
    try {
        const items = await readBranchPayroll(req.branchId);
        const hydrated = items.map((item) => hydratePayrollEntry(item));
        return res.json({ ok: true, items: sortByDateDesc(hydrated) });
    } catch (error) {
        return next(error);
    }
});

router.post('/', async (req, res, next) => {
    try {
        const payDate = normalizeDateOnly(req.body?.payDate);
        const periodStart = normalizeDateOnly(req.body?.periodStart);
        const periodEnd = normalizeDateOnly(req.body?.periodEnd);
        const employeeName = toSafeText(req.body?.employeeName, 140);
        const role = toSafeText(req.body?.role, 120);
        const notes = toSafeText(req.body?.notes, 1200);
        const ratePerDay = normalizeAmount(req.body?.ratePerDay ?? req.body?.grossPay);
        const deductions = normalizeAmount(req.body?.deductions ?? 0);
        const submitted = normalizeBoolean(req.body?.submitted, false);
        const debts = normalizeDebtRows(req.body?.debts);
        const debtSummary = summarizeDebt(debts);
        const periodDaySpan = getPeriodDaySpan(periodStart, periodEnd);

        if (!payDate) return next(createError(400, 'Pay date is required.'));
        if (!periodStart || !periodEnd) return next(createError(400, 'Payroll period is required.'));
        if (!periodDaySpan) return next(createError(400, 'Period end must be the same day or after period start.'));
        if (periodDaySpan > MAX_ATTENDANCE_DAYS) {
            return next(createError(400, `Payroll period is too long. Maximum ${MAX_ATTENDANCE_DAYS} days.`));
        }
        if (!employeeName) return next(createError(400, 'Employee name is required.'));
        if (ratePerDay == null || ratePerDay <= 0) return next(createError(400, 'Rate per day must be greater than zero.'));
        if (deductions == null) return next(createError(400, 'Deductions must be a valid number.'));

        const attendance = normalizeAttendance(req.body?.attendance, periodStart, periodEnd);
        const attendanceSummary = summarizeAttendance(attendance);
        const grossPay = computeGrossFromAttendance(ratePerDay, attendanceSummary);
        const netPay = computeNetPay(grossPay, deductions);

        const nowIso = new Date().toISOString();
        const submittedAt = submitted
            ? (normalizeDateTime(req.body?.submittedAt) || nowIso)
            : '';
        const entry = {
            id: `payroll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            payDate,
            periodStart,
            periodEnd,
            employeeName,
            role,
            ratePerDay,
            grossPay,
            deductions,
            netPay,
            notes,
            submitted,
            submittedAt,
            debts,
            debtTotal: debtSummary.total,
            debtCount: debtSummary.count,
            attendance,
            attendanceSummary,
            createdAt: nowIso,
            updatedAt: nowIso,
            createdBy: req.user?.username || req.user?.name || String(req.user?.id || 'admin')
        };
        const record = toDbPayrollRecord(req.branchId, entry, {
            userId: req.user?.id,
            username: req.user?.username,
            name: req.user?.name
        });
        await insertPayrollRecord(record, { upsert: false });

        return res.status(201).json({ ok: true, item: hydratePayrollEntry(entry) });
    } catch (error) {
        return next(error);
    }
});

router.put('/:id', async (req, res, next) => {
    try {
        const entryId = toSafeText(req.params?.id, 80);
        if (!entryId) return next(createError(400, 'Payroll ID is required.'));

        const current = await getPayrollById(req.branchId, entryId);
        if (!current) return next(createError(404, 'Payroll entry not found.'));
        const payDate = normalizeDateOnly(req.body?.payDate || current.payDate);
        const periodStart = normalizeDateOnly(req.body?.periodStart || current.periodStart);
        const periodEnd = normalizeDateOnly(req.body?.periodEnd || current.periodEnd);
        const employeeName = toSafeText(req.body?.employeeName ?? current.employeeName, 140);
        const role = toSafeText(req.body?.role ?? current.role, 120);
        const notes = toSafeText(req.body?.notes ?? current.notes, 1200);
        const ratePerDay = normalizeAmount(req.body?.ratePerDay ?? current.ratePerDay ?? req.body?.grossPay ?? current.grossPay);
        const deductions = normalizeAmount(req.body?.deductions ?? current.deductions ?? 0);
        const submitted = normalizeBoolean(req.body?.submitted, current.submitted === true);
        const debts = normalizeDebtRows(req.body?.debts, current.debts);
        const debtSummary = summarizeDebt(debts);
        const periodDaySpan = getPeriodDaySpan(periodStart, periodEnd);

        if (!payDate) return next(createError(400, 'Pay date is required.'));
        if (!periodStart || !periodEnd) return next(createError(400, 'Payroll period is required.'));
        if (!periodDaySpan) return next(createError(400, 'Period end must be the same day or after period start.'));
        if (periodDaySpan > MAX_ATTENDANCE_DAYS) {
            return next(createError(400, `Payroll period is too long. Maximum ${MAX_ATTENDANCE_DAYS} days.`));
        }
        if (!employeeName) return next(createError(400, 'Employee name is required.'));
        if (ratePerDay == null || ratePerDay <= 0) return next(createError(400, 'Rate per day must be greater than zero.'));
        if (deductions == null) return next(createError(400, 'Deductions must be a valid number.'));

        const attendance = normalizeAttendance(req.body?.attendance ?? current.attendance, periodStart, periodEnd, current.attendance);
        const attendanceSummary = summarizeAttendance(attendance);
        const grossPay = computeGrossFromAttendance(ratePerDay, attendanceSummary);
        const netPay = computeNetPay(grossPay, deductions);
        let submittedAt = submitted
            ? (
                normalizeDateTime(req.body?.submittedAt) ||
                normalizeDateTime(current.submittedAt)
            )
            : '';
        if (submitted && !submittedAt) submittedAt = new Date().toISOString();

        const updated = {
            ...current,
            payDate,
            periodStart,
            periodEnd,
            employeeName,
            role,
            notes,
            ratePerDay,
            grossPay,
            deductions,
            netPay,
            submitted,
            submittedAt,
            debts,
            debtTotal: debtSummary.total,
            debtCount: debtSummary.count,
            attendance,
            attendanceSummary,
            updatedAt: new Date().toISOString()
        };
        const record = toDbPayrollRecord(req.branchId, updated, {
            userId: current.createdByUserId,
            username: current.createdByUsername || current.createdBy,
            name: current.createdByName
        });
        record.id = entryId;
        record.createdAt = toMysqlDateTime(current.createdAt, { fallbackToNow: true });
        record.updatedAt = toMysqlDateTime(updated.updatedAt, { fallbackToNow: true });
        const result = await updatePayrollRecord(record);
        if (!result || Number(result.affectedRows || 0) === 0) {
            return next(createError(404, 'Payroll entry not found.'));
        }

        return res.json({ ok: true, item: hydratePayrollEntry({ ...updated, id: entryId }) });
    } catch (error) {
        return next(error);
    }
});

router.delete('/:id', async (req, res, next) => {
    try {
        const entryId = toSafeText(req.params?.id, 80);
        if (!entryId) return next(createError(400, 'Payroll ID is required.'));

        if (useJsonPayrollStorage()) {
            const items = await readJsonPayroll(req.branchId);
            const nextItems = items.filter((item) => String(item?.id || '') !== String(entryId));
            if (nextItems.length === items.length) {
                return next(createError(404, 'Payroll entry not found.'));
            }
            await writeJsonPayroll(req.branchId, nextItems);
            return res.json({ ok: true });
        }

        const [result] = await query(
            'DELETE FROM finance_payroll WHERE id = ? AND branch_id = ?',
            [entryId, req.branchId]
        );
        if (!result || Number(result.affectedRows || 0) === 0) {
            return next(createError(404, 'Payroll entry not found.'));
        }
        return res.json({ ok: true });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
