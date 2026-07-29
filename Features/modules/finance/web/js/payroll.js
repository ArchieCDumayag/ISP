document.addEventListener('DOMContentLoaded', () => {
    const MAX_ATTENDANCE_DAYS = 62;
    const ATTENDANCE_STATUSES = ['absent', 'half-day', 'whole-day'];
    const ATTENDANCE_STATUS_ORDER = ['whole-day', 'half-day', 'absent'];
    const ATTENDANCE_STATUS_LABEL = {
        absent: 'Absent',
        'half-day': 'Half Day',
        'whole-day': 'Whole Day'
    };

    const tableBody = document.getElementById('payrollTableBody');
    const tableTotalSalaryEl = document.getElementById('payrollTableTotalSalary');
    const historyList = document.getElementById('payrollHistoryList');
    const searchInput = document.getElementById('payrollSearch');
    const addBtn = document.getElementById('addPayrollBtn');

    const modal = document.getElementById('payrollModal');
    const modalTitle = document.getElementById('payrollModalTitle');
    const closeModalBtn = document.getElementById('payrollModalClose');
    const cancelModalBtn = document.getElementById('payrollModalCancel');
    const form = document.getElementById('payrollForm');

    const attendanceModal = document.getElementById('payrollAttendanceModal');
    const attendanceTitle = document.getElementById('payrollAttendanceTitle');
    const attendanceChecklist = document.getElementById('payrollAttendanceChecklist');
    const attendanceCloseBtn = document.getElementById('payrollAttendanceClose');
    const attendanceCancelBtn = document.getElementById('payrollAttendanceCancel');
    const attendanceSaveBtn = document.getElementById('payrollAttendanceSave');

    const debtModal = document.getElementById('payrollDebtModal');
    const debtTitle = document.getElementById('payrollDebtTitle');
    const debtDateInput = document.getElementById('payrollDebtDate');
    const debtAmountInput = document.getElementById('payrollDebtAmount');
    const debtAddBtn = document.getElementById('payrollDebtAddBtn');
    const debtCloseBtn = document.getElementById('payrollDebtClose');
    const debtDoneBtn = document.getElementById('payrollDebtDone');

    const cutoffModal = document.getElementById('payrollCutoffModal');
    const cutoffModalTitle = document.getElementById('payrollCutoffModalTitle');
    const cutoffModalMeta = document.getElementById('payrollCutoffModalMeta');
    const cutoffModalBody = document.getElementById('payrollCutoffModalBody');
    const cutoffModalCloseBtn = document.getElementById('payrollCutoffModalClose');
    const cutoffModalDoneBtn = document.getElementById('payrollCutoffModalDone');

    const entryIdInput = document.getElementById('payrollEntryId');
    const payDateInput = document.getElementById('payrollPayDate');
    const employeeNameInput = document.getElementById('payrollEmployeeName');
    const periodStartInput = document.getElementById('payrollPeriodStart');
    const periodEndInput = document.getElementById('payrollPeriodEnd');
    const roleInput = document.getElementById('payrollRole');
    const ratePerDayInput = document.getElementById('payrollRatePerDay');
    const notesInput = document.getElementById('payrollNotes');

    const state = {
        items: [],
        filtered: [],
        cutoffLookup: new Map(),
        expandedMonths: new Set(),
        attendanceEntryId: '',
        debtEntryId: '',
        debtSaving: false
    };

    const pesoFormatter = new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
    const DEBT_ADD_BTN_DEFAULT_HTML = debtAddBtn?.innerHTML || '<i class="fa-solid fa-floppy-disk"></i> Save Debt';

    const escapeHtml = (value) =>
        String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    const padDatePart = (value) => String(value).padStart(2, '0');

    const toDateOnly = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (DATE_ONLY_PATTERN.test(raw)) return raw;
        const parsed = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
        if (Number.isNaN(parsed.getTime())) return '';
        return `${parsed.getFullYear()}-${padDatePart(parsed.getMonth() + 1)}-${padDatePart(parsed.getDate())}`;
    };

    const parseDateOnly = (value) => {
        const normalized = toDateOnly(value);
        if (!normalized) return null;
        const [year, month, day] = normalized.split('-').map((part) => Number(part));
        const parsed = new Date(year, month - 1, day);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const formatDate = (value) => {
        const parsed = parseDateOnly(value);
        if (!parsed) return 'N/A';
        return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const monthKeyFromDate = (dateObj) => `${dateObj.getFullYear()}-${padDatePart(dateObj.getMonth() + 1)}`;
    const monthLabelFromKey = (key) => {
        const [year, month] = String(key || '').split('-').map((part) => Number(part));
        if (!Number.isInteger(year) || !Number.isInteger(month)) return key || 'Unknown Month';
        return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    };

    const getPeriodDaySpan = (periodStart, periodEnd) => {
        const start = parseDateOnly(periodStart);
        const end = parseDateOnly(periodEnd);
        if (!start || !end) return 0;
        const diff = end.getTime() - start.getTime();
        if (!Number.isFinite(diff) || diff < 0) return 0;
        return Math.floor(diff / 86_400_000) + 1;
    };

    const formatCurrency = (value) => pesoFormatter.format(Number(value) || 0);
    const normalizeAmount = (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) return 0;
        return Number(parsed.toFixed(2));
    };

    const normalizeAttendanceStatus = (value, options = {}) => {
        const allowUnset = options && options.allowUnset === true;
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return allowUnset ? '' : 'absent';
        if (raw === 'halfday' || raw === 'half day') return 'half-day';
        if (raw === 'fullday' || raw === 'full day' || raw === 'wholeday' || raw === 'whole day') return 'whole-day';
        return ATTENDANCE_STATUSES.includes(raw) ? raw : (allowUnset ? '' : 'absent');
    };
    const isSubmittedPayroll = (item) => Boolean(item?.submitted);

    const normalizeDebtRows = (rows = []) => {
        const list = Array.isArray(rows) ? rows : [];
        return list
            .map((entry) => {
                const safeEntry = entry && typeof entry === 'object' ? entry : {};
                const date = toDateOnly(safeEntry.date || safeEntry.day || safeEntry.takenOn);
                const amount = normalizeAmount(safeEntry.amount);
                if (!date || !Number.isFinite(amount) || amount <= 0) return null;
                return { date, amount };
            })
            .filter(Boolean)
            .sort((left, right) => (parseDateOnly(left.date)?.getTime() || 0) - (parseDateOnly(right.date)?.getTime() || 0));
    };

    const computeDebtTotal = (rows = []) =>
        Number(rows.reduce((sum, row) => sum + (Number(row?.amount) || 0), 0).toFixed(2));

    const buildDefaultAttendance = (periodStart, periodEnd) => {
        const startDateRaw = toDateOnly(periodStart);
        const startDate = parseDateOnly(startDateRaw);
        const spanDays = getPeriodDaySpan(periodStart, periodEnd);
        if (!startDate || spanDays <= 0) return [];
        return Array.from({ length: spanDays }, (_entry, index) => {
            const current = new Date(startDate);
            current.setDate(startDate.getDate() + index);
            return {
                day: index + 1,
                date: `${current.getFullYear()}-${padDatePart(current.getMonth() + 1)}-${padDatePart(current.getDate())}`,
                status: ''
            };
        });
    };

    const normalizeAttendance = (rows, periodStart, periodEnd) => {
        const baseRows = buildDefaultAttendance(periodStart, periodEnd);
        if (!baseRows.length) return [];
        const list = Array.isArray(rows) ? rows : [];
        if (!list.length) return baseRows;

        const statusByDay = new Map();
        const statusByDate = new Map();
        list.forEach((entry, index) => {
            const safeEntry = entry && typeof entry === 'object' ? entry : {};
            const status = normalizeAttendanceStatus(safeEntry.status, { allowUnset: true });
            const day = Number(safeEntry.day ?? safeEntry.dayNumber ?? index + 1);
            const date = toDateOnly(safeEntry.date);
            if (Number.isInteger(day) && day >= 1 && day <= baseRows.length) statusByDay.set(day, status);
            if (date) statusByDate.set(date, status);
        });

        return baseRows.map((row) => ({
            ...row,
            status: statusByDate.get(row.date) || statusByDay.get(row.day) || row.status
        }));
    };

    const summarizeAttendance = (rows = []) => {
        const summary = { wholeDayCount: 0, halfDayCount: 0, absentCount: 0, unsetCount: 0, daysPresent: 0, paidDays: 0 };
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
                summary.daysPresent += 0.5;
                summary.paidDays += 0.5;
                return;
            }
            if (status === 'absent') {
                summary.absentCount += 1;
                return;
            }
            summary.unsetCount += 1;
        });
        summary.daysPresent = Number(summary.daysPresent.toFixed(2));
        summary.paidDays = Number(summary.paidDays.toFixed(2));
        return summary;
    };

    const computeTotalSalary = (ratePerDay, attendanceSummary) => {
        const rate = normalizeAmount(ratePerDay);
        const daysPresent = Number(attendanceSummary?.daysPresent) || 0;
        return Number((rate * daysPresent).toFixed(2));
    };

    const computeNetSalary = (grossSalary, debtTotal) =>
        Number(Math.max((Number(grossSalary) || 0) - (Number(debtTotal) || 0), 0).toFixed(2));

    const normalizePayrollItem = (item) => {
        const safeItem = item && typeof item === 'object' ? item : {};
        const periodStart = toDateOnly(safeItem.periodStart);
        const periodEnd = toDateOnly(safeItem.periodEnd);
        const payDate = toDateOnly(safeItem.payDate);
        const attendance = normalizeAttendance(safeItem.attendance, periodStart, periodEnd);
        const attendanceSummary = summarizeAttendance(attendance);
        const debts = normalizeDebtRows(safeItem.debts);
        const debtTotalFromSource = normalizeAmount(safeItem.debtTotal);
        const debtTotal = debtTotalFromSource > 0 ? debtTotalFromSource : computeDebtTotal(debts);
        const ratePerDay = normalizeAmount(safeItem.ratePerDay || safeItem.grossPay || 0);
        const totalSalary = safeItem.ratePerDay != null
            ? computeTotalSalary(ratePerDay, attendanceSummary)
            : normalizeAmount(safeItem.grossPay || 0);
        const netSalary = computeNetSalary(totalSalary, debtTotal);
        return {
            ...safeItem,
            payDate,
            periodStart,
            periodEnd,
            debts,
            debtTotal,
            netSalary,
            attendance,
            attendanceSummary,
            ratePerDay,
            totalSalary
        };
    };

    const cutoffTagFromPeriod = (periodStart, periodEnd) => {
        const start = parseDateOnly(periodStart);
        const end = parseDateOnly(periodEnd);
        const startDay = start ? start.getDate() : 0;
        const endDay = end ? end.getDate() : 0;
        if (startDay >= 1 && startDay <= 15 && endDay >= 1 && endDay <= 15) return 'First Cutoff';
        if (startDay >= 16) return 'Second Cutoff';
        return 'Cutoff';
    };

    const notify = (message, type = 'info') => {
        if (typeof window.appToast === 'function') {
            window.appToast(message, { type });
            return;
        }
        window.alert(message);
    };

    const requestJson = async (url, options = {}) => {
        const response = await fetch(url, { credentials: 'include', ...options });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const errorMessage = payload?.error || payload?.message || `Request failed (${response.status})`;
            throw new Error(errorMessage);
        }
        return payload;
    };

    const setTableTotalSalary = (totalSalary) => {
        if (!tableTotalSalaryEl) return;
        tableTotalSalaryEl.textContent = formatCurrency(totalSalary);
    };

    const isDateWithinRange = (dateValue, startValue, endValue) => {
        const date = parseDateOnly(dateValue);
        const start = parseDateOnly(startValue);
        const end = parseDateOnly(endValue);
        if (!date || !start || !end) return true;
        return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
    };

    const setDebtModalSaving = (saving) => {
        const isSaving = Boolean(saving);
        state.debtSaving = isSaving;

        if (debtDateInput) debtDateInput.disabled = isSaving;
        if (debtAmountInput) debtAmountInput.disabled = isSaving;
        if (debtAddBtn) {
            debtAddBtn.disabled = isSaving;
            debtAddBtn.innerHTML = isSaving
                ? '<i class="fa-solid fa-spinner fa-spin"></i> Saving...'
                : DEBT_ADD_BTN_DEFAULT_HTML;
        }
        if (debtDoneBtn) debtDoneBtn.disabled = isSaving;
        if (debtCloseBtn) debtCloseBtn.disabled = isSaving;
    };

    const resetDebtModalContent = () => {
        state.debtEntryId = '';
        if (debtTitle) debtTitle.textContent = 'Payroll Debt';
        if (debtDateInput) debtDateInput.value = '';
        if (debtAmountInput) debtAmountInput.value = '';
        setDebtModalSaving(false);
    };

    const closeModal = () => {
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        form.reset();
        entryIdInput.value = '';
    };

    const closeAttendanceModal = () => {
        if (!attendanceModal) return;
        attendanceModal.classList.remove('show');
        attendanceModal.setAttribute('aria-hidden', 'true');
        state.attendanceEntryId = '';
        if (attendanceChecklist) {
            attendanceChecklist.innerHTML = '';
            attendanceChecklist.dataset.entryId = '';
        }
    };

    const closeDebtModal = () => {
        if (!debtModal) return;
        debtModal.classList.remove('show');
        debtModal.setAttribute('aria-hidden', 'true');
        resetDebtModalContent();
    };

    const closeCutoffModal = () => {
        if (!cutoffModal) return;
        cutoffModal.classList.remove('show');
        cutoffModal.setAttribute('aria-hidden', 'true');
        if (cutoffModalBody) cutoffModalBody.innerHTML = '';
    };

    const openDebtModal = (entry) => {
        if (!debtModal || !entry) return;
        state.debtEntryId = String(entry.id || '').trim();
        if (!state.debtEntryId) return;

        if (debtTitle) {
            debtTitle.textContent = `Debt - ${entry.employeeName || 'Employee'}`;
        }
        setDebtModalSaving(false);

        if (debtDateInput) {
            const defaultDate = toDateOnly(entry.periodEnd) || toDateOnly(entry.payDate) || toDateOnly(new Date().toISOString());
            debtDateInput.value = defaultDate;
        }
        if (debtAmountInput) debtAmountInput.value = '';

        debtModal.classList.add('show');
        debtModal.setAttribute('aria-hidden', 'false');
        debtAmountInput?.focus();
    };

    const saveDebt = async () => {
        if (state.debtSaving) return;
        const entryId = String(state.debtEntryId || '').trim();
        if (!entryId) return;

        const entry = state.items.find((item) => String(item?.id || '') === entryId);
        if (!entry) throw new Error('Payroll entry not found.');

        const debtDate = toDateOnly(debtDateInput?.value);
        const debtAmount = normalizeAmount(debtAmountInput?.value);
        if (!debtDate) throw new Error('Debt date is required.');
        if (!Number.isFinite(debtAmount) || debtAmount <= 0) throw new Error('Debt amount must be greater than zero.');
        if (!isDateWithinRange(debtDate, entry.periodStart, entry.periodEnd)) {
            throw new Error(`Debt date must be within payroll period (${formatDate(entry.periodStart)} - ${formatDate(entry.periodEnd)}).`);
        }

        const existingDebts = normalizeDebtRows(entry.debts);
        const debts = [...existingDebts, { date: debtDate, amount: debtAmount }];

        setDebtModalSaving(true);
        try {
            await requestJson(`/api/payroll/${encodeURIComponent(entryId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ debts })
            });

            notify('Debt record saved.', 'success');
            closeDebtModal();
            await loadPayroll();
        } finally {
            setDebtModalSaving(false);
        }
    };

    const renderAttendanceChecklist = (entry) => {
        if (!attendanceChecklist || !entry) return;
        const rows = normalizeAttendance(entry.attendance, entry.periodStart, entry.periodEnd);
        if (!rows.length) {
            attendanceChecklist.innerHTML = '<p class="finance-empty">No attendance days in this period.</p>';
            return;
        }

        const dateHeadersHtml = rows.map((row) => `
            <th scope="col" class="attendance-matrix__date" data-day="${row.day}" data-date="${escapeHtml(row.date)}">
                <span class="attendance-matrix__date-label">${escapeHtml(formatDate(row.date))}</span>
            </th>
        `).join('');

        const statusRowsHtml = ATTENDANCE_STATUS_ORDER.map((status) => {
            const label = ATTENDANCE_STATUS_LABEL[status] || status;
            const cellsHtml = rows.map((row) => {
                const groupName = `attendance-day-${escapeHtml(entry.id)}-${row.day}`;
                const checked = normalizeAttendanceStatus(row.status, { allowUnset: true }) === status ? 'checked' : '';
                const rowDateLabel = formatDate(row.date);
                return `
                    <td class="attendance-matrix__cell">
                        <label class="attendance-choice attendance-choice--matrix" title="${label}">
                            <input type="radio" name="${groupName}" value="${status}" data-day="${row.day}" data-date="${escapeHtml(row.date)}" ${checked} aria-label="${escapeHtml(rowDateLabel)} ${label}">
                            <span class="attendance-dot" aria-hidden="true"></span>
                            <span class="attendance-choice__label">${label}</span>
                        </label>
                    </td>
                `;
            }).join('');

            return `
                <tr class="attendance-matrix__row" data-status="${escapeHtml(status)}">
                    <th scope="row" class="attendance-matrix__status">${label}</th>
                    ${cellsHtml}
                </tr>
            `;
        }).join('');

        attendanceChecklist.innerHTML = `
            <div class="attendance-matrix-wrap">
                <table class="attendance-matrix-table" aria-label="Attendance matrix by status and date">
                    <thead>
                        <tr>
                            <th scope="col" class="attendance-matrix__corner">Status</th>
                            ${dateHeadersHtml}
                        </tr>
                    </thead>
                    <tbody>
                        ${statusRowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    };

    const openAttendanceModal = (entry) => {
        if (!attendanceModal || !entry) return;
        state.attendanceEntryId = String(entry.id || '').trim();
        if (!state.attendanceEntryId) return;

        attendanceTitle.textContent = `Attendance - ${entry.employeeName || 'Employee'}`;
        if (attendanceChecklist) {
            attendanceChecklist.dataset.entryId = state.attendanceEntryId;
        }
        renderAttendanceChecklist(entry);

        attendanceModal.classList.add('show');
        attendanceModal.setAttribute('aria-hidden', 'false');
    };

    const collectAttendanceRows = () => {
        if (!attendanceChecklist) return [];
        const columns = Array.from(attendanceChecklist.querySelectorAll('.attendance-matrix__date[data-day]'));
        const maxRows = columns.length;
        return columns
            .map((column, index) => {
                const day = Number(column.dataset.day || index + 1);
                const date = toDateOnly(column.dataset.date);
                const checked = attendanceChecklist.querySelector(`input[type="radio"][data-day="${day}"]:checked`);
                const status = normalizeAttendanceStatus(checked?.value, { allowUnset: true });
                if (!Number.isInteger(day) || day < 1 || day > maxRows || !date) return null;
                return { day, date, status };
            })
            .filter(Boolean)
            .sort((left, right) => left.day - right.day)
            .slice(0, maxRows);
    };

    const saveAttendance = async () => {
        const entryId = String(state.attendanceEntryId || '').trim();
        if (!entryId) return;

        const entry = state.items.find((item) => String(item?.id || '') === entryId);
        if (!entry) throw new Error('Payroll entry not found.');

        const expectedDays = getPeriodDaySpan(entry.periodStart, entry.periodEnd);
        const attendance = collectAttendanceRows();
        if (attendance.length !== expectedDays) {
            throw new Error(`Attendance checklist must match period range (${expectedDays} days).`);
        }

        await requestJson(`/api/payroll/${encodeURIComponent(entryId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attendance })
        });

        notify('Attendance checklist saved.', 'success');
        closeAttendanceModal();
        await loadPayroll();
    };

    const buildHistoryGroups = (items) => {
        const monthly = new Map();
        items.forEach((item) => {
            const monthDate = parseDateOnly(item.periodStart || item.payDate);
            const monthKey = monthDate ? monthKeyFromDate(monthDate) : 'undated';
            const monthLabel = monthDate ? monthLabelFromKey(monthKey) : 'Undated';
            const monthSortWeight = monthDate ? Number(`${monthDate.getFullYear()}${padDatePart(monthDate.getMonth() + 1)}`) : 0;

            const cutoffStart = toDateOnly(item.periodStart);
            const cutoffEnd = toDateOnly(item.periodEnd);
            const cutoffKey = `${monthKey}__${cutoffStart || 'na'}__${cutoffEnd || 'na'}`;
            const cutoffTag = cutoffTagFromPeriod(cutoffStart, cutoffEnd);
            const cutoffPeriodText = `${formatDate(cutoffStart)} - ${formatDate(cutoffEnd)}`;

            const monthGroup = monthly.get(monthKey) || {
                key: monthKey,
                label: monthLabel,
                sortWeight: monthSortWeight,
                totalSalary: 0,
                cutoffsMap: new Map()
            };

            const cutoffGroup = monthGroup.cutoffsMap.get(cutoffKey) || {
                key: cutoffKey,
                label: `${cutoffTag} (${cutoffPeriodText})`,
                periodText: cutoffPeriodText,
                periodStart: cutoffStart,
                entries: [],
                employeeCount: 0,
                totalSalary: 0,
                wholeDayCount: 0,
                halfDayCount: 0,
                absentCount: 0
            };

            const summary = item.attendanceSummary || summarizeAttendance(item.attendance);
            const entryNetSalary = Number(item.netSalary);
            const salaryToUse = Number.isFinite(entryNetSalary)
                ? entryNetSalary
                : computeNetSalary(item.totalSalary, item.debtTotal);
            cutoffGroup.entries.push(item);
            cutoffGroup.employeeCount += 1;
            cutoffGroup.totalSalary += salaryToUse;
            cutoffGroup.wholeDayCount += Number(summary.wholeDayCount) || 0;
            cutoffGroup.halfDayCount += Number(summary.halfDayCount) || 0;
            cutoffGroup.absentCount += Number(summary.absentCount) || 0;
            monthGroup.totalSalary += salaryToUse;
            monthGroup.cutoffsMap.set(cutoffKey, cutoffGroup);
            monthly.set(monthKey, monthGroup);
        });

        return Array.from(monthly.values())
            .map((group) => ({
                key: group.key,
                label: group.label,
                sortWeight: group.sortWeight,
                totalSalary: Number(group.totalSalary.toFixed(2)),
                cutoffs: Array.from(group.cutoffsMap.values())
                    .map((cutoff) => ({
                        ...cutoff,
                        totalSalary: Number(cutoff.totalSalary.toFixed(2)),
                        entries: cutoff.entries.sort((left, right) =>
                            String(left?.employeeName || '').localeCompare(String(right?.employeeName || ''), undefined, { sensitivity: 'base' })
                        )
                    }))
                    .sort((left, right) => (parseDateOnly(left.periodStart)?.getTime() || 0) - (parseDateOnly(right.periodStart)?.getTime() || 0))
            }))
            .sort((left, right) => right.sortWeight - left.sortWeight);
    };

    const openCutoffModal = (cutoff) => {
        if (!cutoffModal || !cutoff) return;
        const rowsHtml = cutoff.entries.map((entry) => {
            const summary = entry.attendanceSummary || summarizeAttendance(entry.attendance);
            const debtTotal = computeDebtTotal(normalizeDebtRows(entry.debts));
            const grossSalary = computeTotalSalary(entry.ratePerDay, summary);
            const netSalary = Number(entry.netSalary);
            const salary = Number.isFinite(netSalary)
                ? netSalary
                : computeNetSalary(grossSalary, debtTotal);
            return `
                <tr class="payroll-cutoff-entry" data-entry-id="${escapeHtml(entry.id)}">
                    <td>
                        <button type="button" class="finance-link-btn payroll-cutoff-payee-btn" data-action="history-attendance" data-id="${escapeHtml(entry.id)}" aria-label="View attendance dates for ${escapeHtml(entry.employeeName || 'employee')}">
                            <span class="finance-link-btn__title">${escapeHtml(entry.employeeName || '-')}</span>
                            <span class="finance-link-btn__hint">View attendance dates</span>
                        </button>
                    </td>
                    <td class="text-right amount">${escapeHtml(formatCurrency(entry.ratePerDay))}</td>
                    <td class="text-center">${summary.wholeDayCount}</td>
                    <td class="text-center">${summary.halfDayCount}</td>
                    <td class="text-center">${summary.absentCount}</td>
                    <td class="text-center">${summary.daysPresent} Days</td>
                    <td class="text-right amount">${escapeHtml(formatCurrency(salary))}</td>
                </tr>
            `;
        }).join('');

        cutoffModalTitle.textContent = cutoff.label;
        if (cutoffModalMeta) {
            cutoffModalMeta.textContent = `${cutoff.employeeCount} ${cutoff.employeeCount === 1 ? 'employee' : 'employees'} | ${cutoff.periodText}`;
        }
        if (cutoffModalBody) {
            cutoffModalBody.innerHTML = `
                <div class="table-wrapper">
                    <table class="finance-table finance-table--payroll-cutoff" aria-label="Payroll cutoff details">
                        <thead>
                            <tr>
                                <th>Employee</th>
                                <th class="text-right">Rate / Day</th>
                                <th class="text-center">Whole Day</th>
                                <th class="text-center">Half Day</th>
                                <th class="text-center">Absent</th>
                                <th class="text-center">Days Present</th>
                                <th class="text-right">Salary</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml || '<tr><td colspan="7" class="finance-empty">No payroll entries found for this cutoff.</td></tr>'}
                        </tbody>
                        <tfoot>
                            <tr>
                                <th colspan="6" class="finance-total-label">Total Salary</th>
                                <th class="text-right amount">${escapeHtml(formatCurrency(cutoff.totalSalary))}</th>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;
        }

        cutoffModal.classList.add('show');
        cutoffModal.setAttribute('aria-hidden', 'false');
    };

    const renderHistory = () => {
        if (!historyList) return;
        const groups = buildHistoryGroups(state.items.filter((item) => isSubmittedPayroll(item)));
        state.cutoffLookup.clear();

        const validMonthKeys = new Set(groups.map((group) => group.key));
        state.expandedMonths.forEach((key) => {
            if (!validMonthKeys.has(key)) state.expandedMonths.delete(key);
        });

        if (!groups.length) {
            historyList.innerHTML = '<p class="finance-empty">No payroll history yet.</p>';
            return;
        }

        historyList.innerHTML = groups.map((month) => {
            const isExpanded = state.expandedMonths.has(month.key);
            const cutoffRows = month.cutoffs.map((cutoff) => {
                state.cutoffLookup.set(cutoff.key, cutoff);
                return `
                    <button type="button" class="payroll-cutoff-item" data-cutoff-key="${escapeHtml(cutoff.key)}" aria-label="View ${escapeHtml(cutoff.label)} details">
                        <span class="payroll-cutoff-item__title">${escapeHtml(cutoff.label)}</span>
                        <span class="payroll-cutoff-item__total">${escapeHtml(formatCurrency(cutoff.totalSalary))}</span>
                    </button>
                `;
            }).join('');

            return `
                <article class="payroll-history-month ${isExpanded ? 'is-open' : ''}">
                    <button type="button" class="payroll-history-month__button" data-month-key="${escapeHtml(month.key)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
                        <span class="payroll-history-month__label">${escapeHtml(month.label)}</span>
                        <span class="payroll-history-month__meta">${month.cutoffs.length} ${month.cutoffs.length === 1 ? 'cutoff' : 'cutoffs'}</span>
                        <span class="payroll-history-month__total">${escapeHtml(formatCurrency(month.totalSalary))}</span>
                        <span class="payroll-history-month__icon"><i class="fa-solid fa-chevron-down"></i></span>
                    </button>
                    <div class="payroll-history-cutoffs" ${isExpanded ? '' : 'hidden'}>
                        ${cutoffRows || '<p class="finance-empty">No cutoff entries found.</p>'}
                    </div>
                </article>
            `;
        }).join('');
    };

    const renderTable = () => {
        if (!tableBody) return;
        if (!state.filtered.length) {
            setTableTotalSalary(0);
            tableBody.innerHTML = '<tr><td colspan="9" class="finance-empty">No pending payroll entries found.</td></tr>';
            return;
        }

        const totalSalaryAll = state.filtered.reduce((sum, item) => {
            const netSalary = Number(item.netSalary);
            const value = Number.isFinite(netSalary)
                ? netSalary
                : computeNetSalary(item.totalSalary, item.debtTotal);
            return sum + value;
        }, 0);
        setTableTotalSalary(totalSalaryAll);

        tableBody.innerHTML = state.filtered.map((item) => {
            const summary = item.attendanceSummary || summarizeAttendance(item.attendance);
            const debts = normalizeDebtRows(item.debts);
            const debtTotal = computeDebtTotal(debts);
            const salaryToUse = Number.isFinite(Number(item.netSalary))
                ? Number(item.netSalary)
                : computeNetSalary(item.totalSalary, debtTotal);
            const periodText = `${formatDate(item.periodStart)} - ${formatDate(item.periodEnd)}`;
            const attendanceMetaText = `W:${summary.wholeDayCount} H:${summary.halfDayCount} A:${summary.absentCount}`;
            return `
                <tr>
                    <td>${escapeHtml(formatDate(item.payDate))}</td>
                    <td>
                        <div class="payroll-employee-cell">
                            <span class="finance-link-btn__title">${escapeHtml(item.employeeName || '')}</span>
                            <span class="finance-link-btn__subtitle">${escapeHtml(item.role || '-')}</span>
                        </div>
                    </td>
                    <td>${escapeHtml(periodText)}</td>
                    <td>
                        <span class="payroll-days-present">${summary.daysPresent} Days</span>
                        <small class="payroll-days-breakdown">${escapeHtml(attendanceMetaText)}</small>
                    </td>
                    <td class="text-right amount">${escapeHtml(formatCurrency(item.ratePerDay))}</td>
                    <td class="text-center">
                        <div class="payroll-debt-cell">
                            <span class="payroll-debt-total">${escapeHtml(formatCurrency(debtTotal))}</span>
                        </div>
                    </td>
                    <td class="text-right amount">${escapeHtml(formatCurrency(salaryToUse))}</td>
                    <td class="text-center">
                        <button type="button" class="ghost-icon payroll-attendance-btn" data-action="attendance" data-id="${escapeHtml(item.id)}" title="View Attendance" aria-label="View attendance for ${escapeHtml(item.employeeName || 'employee')}">
                            <i class="fa-solid fa-calendar-check"></i>
                        </button>
                    </td>
                    <td class="text-center">
                        <div class="finance-actions finance-actions--payroll">
                            <button type="button" class="ghost-icon payroll-debt-action-btn" data-action="debt" data-id="${escapeHtml(item.id)}" title="Add Debt" aria-label="Add debt for ${escapeHtml(item.employeeName || 'employee')}">
                                <i class="fa-solid fa-hand-holding-dollar"></i>
                            </button>
                            <button type="button" class="ghost-icon payroll-submit-btn" data-action="submit" data-id="${escapeHtml(item.id)}" title="Submit Payroll" aria-label="Submit payroll for ${escapeHtml(item.employeeName || 'employee')}">
                                <i class="fa-solid fa-paper-plane"></i>
                            </button>
                            <button type="button" class="ghost-icon" data-action="edit" data-id="${escapeHtml(item.id)}" title="Edit" aria-label="Edit payroll">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button type="button" class="ghost-icon danger" data-action="delete" data-id="${escapeHtml(item.id)}" title="Delete" aria-label="Delete payroll">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    };

    const applyFilters = () => {
        const query = String(searchInput?.value || '').trim().toLowerCase();
        const filtered = state.items.filter((item) => !isSubmittedPayroll(item)).filter((item) => {
            if (!query) return true;
            const summary = item.attendanceSummary || summarizeAttendance(item.attendance);
            const debts = normalizeDebtRows(item.debts);
            const debtTotal = computeDebtTotal(debts);
            const debtText = debts.map((debt) => `${debt.date} ${debt.amount}`).join(' ');
            const haystack = [
                item.payDate, item.employeeName, item.role, item.periodStart, item.periodEnd,
                item.ratePerDay, item.totalSalary, item.netSalary, summary.daysPresent, summary.wholeDayCount,
                summary.halfDayCount, summary.absentCount, debtTotal, debtText, item.notes
            ].join(' ').toLowerCase();
            return haystack.includes(query);
        });

        state.filtered = filtered.sort((left, right) =>
            (parseDateOnly(right?.payDate)?.getTime() || 0) - (parseDateOnly(left?.payDate)?.getTime() || 0)
        );
        renderTable();
    };

    const openModal = (entry = null) => {
        const today = new Date();
        const todayIso = `${today.getFullYear()}-${padDatePart(today.getMonth() + 1)}-${padDatePart(today.getDate())}`;
        if (!entry) {
            modalTitle.textContent = 'Add Payroll';
            form.reset();
            entryIdInput.value = '';
            payDateInput.value = todayIso;
            periodStartInput.value = todayIso;
            periodEndInput.value = todayIso;
            ratePerDayInput.value = '';
        } else {
            modalTitle.textContent = 'Edit Payroll';
            entryIdInput.value = entry.id || '';
            payDateInput.value = toDateOnly(entry.payDate);
            employeeNameInput.value = entry.employeeName || '';
            periodStartInput.value = toDateOnly(entry.periodStart);
            periodEndInput.value = toDateOnly(entry.periodEnd);
            roleInput.value = entry.role || '';
            ratePerDayInput.value = normalizeAmount(entry.ratePerDay).toFixed(2);
            notesInput.value = entry.notes || '';
        }
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        employeeNameInput.focus();
    };

    const loadPayroll = async () => {
        const payload = await requestJson('/api/payroll');
        const items = Array.isArray(payload?.items) ? payload.items : [];
        state.items = items.map((item) => normalizePayrollItem(item));
        applyFilters();
        renderHistory();
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        const entryId = String(entryIdInput.value || '').trim();

        const payload = {
            payDate: toDateOnly(payDateInput.value),
            employeeName: String(employeeNameInput.value || '').trim(),
            periodStart: toDateOnly(periodStartInput.value),
            periodEnd: toDateOnly(periodEndInput.value),
            role: String(roleInput.value || '').trim(),
            ratePerDay: normalizeAmount(ratePerDayInput.value),
            notes: notesInput.value
        };

        if (!payload.payDate || !payload.employeeName || !payload.periodStart || !payload.periodEnd) {
            notify('Please complete the required fields.', 'warning');
            return;
        }
        const periodDaySpan = getPeriodDaySpan(payload.periodStart, payload.periodEnd);
        if (!periodDaySpan) {
            notify('Period end must be the same day or after period start.', 'warning');
            return;
        }
        if (periodDaySpan > MAX_ATTENDANCE_DAYS) {
            notify(`Payroll period is too long. Maximum ${MAX_ATTENDANCE_DAYS} days.`, 'warning');
            return;
        }
        if (!Number.isFinite(payload.ratePerDay) || payload.ratePerDay <= 0) {
            notify('Rate per day must be greater than zero.', 'warning');
            return;
        }

        if (entryId) {
            await requestJson(`/api/payroll/${encodeURIComponent(entryId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            notify('Payroll entry updated.', 'success');
        } else {
            await requestJson('/api/payroll', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            notify('Payroll entry added.', 'success');
        }

        closeModal();
        await loadPayroll();
    };

    const handleTableAction = async (event) => {
        const actionBtn = event.target.closest('button[data-action]');
        if (!actionBtn) return;
        const action = actionBtn.dataset.action;
        const entryId = String(actionBtn.dataset.id || '').trim();
        if (!entryId) return;

        const entry = state.items.find((item) => String(item?.id || '') === entryId);
        if (!entry) return;

        if (action === 'attendance') {
            openAttendanceModal(entry);
            return;
        }
        if (action === 'debt') {
            openDebtModal(entry);
            return;
        }
        if (action === 'edit') {
            openModal(entry);
            return;
        }
        if (action === 'submit') {
            const confirmed = window.appConfirm
                ? await window.appConfirm('Submit this payroll to history?', { title: 'Submit Payroll' })
                : window.confirm('Submit this payroll to history?');
            if (!confirmed) return;

            await requestJson(`/api/payroll/${encodeURIComponent(entryId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ submitted: true })
            });
            notify('Payroll submitted to history.', 'success');
            await loadPayroll();
            return;
        }
        if (action === 'delete') {
            const confirmed = window.appConfirm
                ? await window.appConfirm('Delete this payroll entry?', { title: 'Delete Payroll Entry' })
                : window.confirm('Delete this payroll entry?');
            if (!confirmed) return;

            await requestJson(`/api/payroll/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
            notify('Payroll entry deleted.', 'success');
            await loadPayroll();
        }
    };

    const handleHistoryClick = (event) => {
        const monthBtn = event.target.closest('button[data-month-key]');
        if (monthBtn) {
            const key = String(monthBtn.dataset.monthKey || '').trim();
            if (!key) return;
            if (state.expandedMonths.has(key)) {
                state.expandedMonths.delete(key);
            } else {
                state.expandedMonths.add(key);
            }
            renderHistory();
            return;
        }

        const cutoffBtn = event.target.closest('button[data-cutoff-key]');
        if (cutoffBtn) {
            const key = String(cutoffBtn.dataset.cutoffKey || '').trim();
            if (!key) return;
            const cutoff = state.cutoffLookup.get(key);
            if (cutoff) openCutoffModal(cutoff);
        }
    };

    addBtn?.addEventListener('click', () => openModal());
    closeModalBtn?.addEventListener('click', closeModal);
    cancelModalBtn?.addEventListener('click', closeModal);

    attendanceCloseBtn?.addEventListener('click', closeAttendanceModal);
    attendanceCancelBtn?.addEventListener('click', closeAttendanceModal);
    attendanceSaveBtn?.addEventListener('click', async () => {
        try {
            await saveAttendance();
        } catch (error) {
            notify(error.message || 'Unable to save attendance.', 'error');
        }
    });

    debtCloseBtn?.addEventListener('click', closeDebtModal);
    debtDoneBtn?.addEventListener('click', closeDebtModal);
    debtAddBtn?.addEventListener('click', async () => {
        try {
            await saveDebt();
        } catch (error) {
            notify(error.message || 'Unable to save debt.', 'error');
        }
    });
    const handleDebtQuickSave = async (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        try {
            await saveDebt();
        } catch (error) {
            notify(error.message || 'Unable to save debt.', 'error');
        }
    };
    debtDateInput?.addEventListener('keydown', handleDebtQuickSave);
    debtAmountInput?.addEventListener('keydown', handleDebtQuickSave);

    cutoffModalCloseBtn?.addEventListener('click', closeCutoffModal);
    cutoffModalDoneBtn?.addEventListener('click', closeCutoffModal);
    cutoffModalBody?.addEventListener('click', (event) => {
        const attendanceBtn = event.target.closest('button[data-action="history-attendance"]');
        const attendanceRow = event.target.closest('tr[data-entry-id]');
        const entryId = attendanceBtn
            ? String(attendanceBtn.dataset.id || '').trim()
            : String(attendanceRow?.dataset.entryId || '').trim();
        if (!entryId) return;
        const entry = state.items.find((item) => String(item?.id || '') === entryId);
        if (entry) {
            closeCutoffModal();
            openAttendanceModal(entry);
            return;
        }
        notify('Payroll entry not found.', 'warning');
    });

    modal?.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });
    attendanceModal?.addEventListener('click', (event) => {
        if (event.target === attendanceModal) closeAttendanceModal();
    });
    debtModal?.addEventListener('click', (event) => {
        if (event.target === debtModal) closeDebtModal();
    });
    cutoffModal?.addEventListener('click', (event) => {
        if (event.target === cutoffModal) closeCutoffModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (debtModal?.classList.contains('show')) {
            closeDebtModal();
            return;
        }
        if (cutoffModal?.classList.contains('show')) {
            closeCutoffModal();
            return;
        }
        if (attendanceModal?.classList.contains('show')) {
            closeAttendanceModal();
            return;
        }
        if (modal?.classList.contains('show')) {
            closeModal();
        }
    });

    form?.addEventListener('submit', async (event) => {
        try {
            await handleSubmit(event);
        } catch (error) {
            notify(error.message || 'Unable to save payroll.', 'error');
        }
    });

    tableBody?.addEventListener('click', async (event) => {
        try {
            await handleTableAction(event);
        } catch (error) {
            notify(error.message || 'Unable to process action.', 'error');
        }
    });

    historyList?.addEventListener('click', handleHistoryClick);
    searchInput?.addEventListener('input', applyFilters);

    loadPayroll().catch((error) => {
        notify(error.message || 'Unable to load payroll.', 'error');
        setTableTotalSalary(0);
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="9" class="finance-empty">Unable to load payroll entries.</td></tr>';
        }
        if (historyList) {
            historyList.innerHTML = '<p class="finance-empty">Unable to load payroll history.</p>';
        }
    });
});
