/* global Chart */

(function () {
    'use strict';

    const pesoSign = '\u20B1';

    const ENTRY_KIND_DIRECTIONS = {
        payment: 'credit',
        rebate: 'credit',
        discount: 'credit',
        charge: 'debit',
        debit: 'debit'
    };

    const normalizeKind = (value) => {
        const key = String(value || 'payment').toLowerCase().trim();
        return ENTRY_KIND_DIRECTIONS[key] ? key : 'payment';
    };

    const resolveDirection = (entry) => {
        if (!entry) return 'credit';
        const normalizedKind = normalizeKind(entry.kind);
        const fallbackDirection = ENTRY_KIND_DIRECTIONS[normalizedKind] || 'credit';
        const candidate = String(entry.direction || entry.nature || fallbackDirection).toLowerCase().trim();
        return candidate === 'debit' ? 'debit' : 'credit';
    };

    const parseDateValue = (value) => {
        if (!value && value !== 0) return null;
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }
        const raw = String(value).trim();
        if (!raw) return null;
        const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) {
            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
                return new Date(year, month - 1, day);
            }
        }
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const parseDateOnly = (value) => {
        const parsed = parseDateValue(value);
        if (!parsed) return null;
        parsed.setHours(0, 0, 0, 0);
        return parsed;
    };

    const formatDateISO = (dateObj) => {
        if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };

    const formatDate = (value) => {
        const parsed = parseDateValue(value);
        return parsed
            ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'N/A';
    };

    const dateDiffDays = (fromDate, toDate) => {
        if (!(fromDate instanceof Date) || !(toDate instanceof Date)) return null;
        const a = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
        const b = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
        const ms = b.getTime() - a.getTime();
        return Math.floor(ms / 86400000);
    };

    const formatCurrency = (amount) =>
        `${pesoSign}${(Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const formatSignedCurrency = (direction, amount) => {
        const sign = direction === 'debit' ? '-' : '';
        return `${sign}${formatCurrency(amount)}`;
    };

    const toTitleCase = (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return '';
        return raw.charAt(0).toUpperCase() + raw.slice(1);
    };

    const formatCustomerName = (customer) => {
        if (!customer) return 'Unknown';
        const trimmedName = (customer.name || '').trim();
        if (trimmedName) return trimmedName;
        const first = (customer.firstName || '').trim();
        const last = (customer.lastName || '').trim();
        if (first || last) return `${first}${first && last ? ' ' : ''}${last}`.trim();
        return customer.accountNumber ? `Account ${customer.accountNumber}` : 'Unknown';
    };

    const formatRecorderLabel = (recorder, kind) => {
        if (recorder && (recorder.name || recorder.username || recorder.id)) {
            const base = (recorder.name || recorder.username || recorder.id || 'Unknown').toString().trim();
            const role = (recorder.role || '').toString().trim();
            return role ? `${base} (${role})` : base;
        }
        const normalizedKind = String(kind || '').toLowerCase().trim();
        if (normalizedKind === 'charge' || normalizedKind === 'bill') return 'System';
        return 'Unknown';
    };

    const getChartTheme = () => {
        const isDark = document.body.classList.contains('theme-dark');
        return {
            isDark,
            text: isDark ? 'rgba(226, 232, 240, 0.92)' : '#334155',
            muted: isDark ? 'rgba(148, 163, 184, 0.9)' : '#64748b',
            grid: isDark ? 'rgba(148, 163, 184, 0.20)' : 'rgba(148, 163, 184, 0.25)',
            canvasBorder: isDark ? 'rgba(15, 23, 42, 0.95)' : '#ffffff'
        };
    };

    const ensureChartMessage = (canvas, message) => {
        if (!canvas) return;
        const wrapper = canvas.closest('.chart-wrapper');
        if (!wrapper) return;
        let msg = wrapper.querySelector('.chart-empty-msg');
        if (!msg) {
            msg = document.createElement('p');
            msg.className = 'chart-empty-msg';
            wrapper.appendChild(msg);
        }
        msg.textContent = message;
        canvas.classList.add('is-hidden');
    };

    const clearChartMessage = (canvas) => {
        if (!canvas) return;
        const wrapper = canvas.closest('.chart-wrapper');
        if (!wrapper) return;
        const msg = wrapper.querySelector('.chart-empty-msg');
        if (msg) msg.remove();
        canvas.classList.remove('is-hidden');
    };

    const todayLocal = () => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    };

    const computePresetRange = (key) => {
        const today = todayLocal();
        const y = today.getFullYear();
        const m = today.getMonth();

        const clamp = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const shiftDays = (base, delta) => {
            const d = new Date(base);
            d.setDate(d.getDate() + delta);
            return clamp(d);
        };

        switch (String(key || '').trim()) {
            case 'last7': {
                const to = today;
                const from = shiftDays(today, -6);
                return { from, to };
            }
            case 'thisMonth': {
                return { from: new Date(y, m, 1), to: today };
            }
            case 'prevMonth': {
                const from = new Date(y, m - 1, 1);
                const to = new Date(y, m, 0);
                return { from, to };
            }
            case 'thisYear': {
                return { from: new Date(y, 0, 1), to: today };
            }
            case 'all': {
                return { from: null, to: null };
            }
            case 'last30':
            default: {
                const to = today;
                const from = shiftDays(today, -29);
                return { from, to };
            }
        }
    };

    const normalizeRangeInputs = (fromInput, toInput) => {
        const from = parseDateOnly(fromInput?.value);
        const to = parseDateOnly(toInput?.value);
        if (from && to && from.getTime() > to.getTime()) {
            return { from: to, to: from, swapped: true };
        }
        return { from, to, swapped: false };
    };

    const withinRange = (dateObj, from, to) => {
        if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return false;
        const t = dateObj.getTime();
        if (from) {
            const fromStart = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0).getTime();
            if (t < fromStart) return false;
        }
        if (to) {
            const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999).getTime();
            if (t > toEnd) return false;
        }
        return true;
    };

    document.addEventListener('DOMContentLoaded', () => {
        const toast = document.getElementById('toast');

        const reportsFrom = document.getElementById('reportsFrom');
        const reportsTo = document.getElementById('reportsTo');
        const reportsRange = document.getElementById('reportsRange');
        const reportsArea = document.getElementById('reportsArea');
        const reportsRefreshBtn = document.getElementById('reportsRefreshBtn');

        const tabs = Array.from(document.querySelectorAll('.reports-tab'));
        const panels = Array.from(document.querySelectorAll('.reports-panel'));

        const summaryBilled = document.getElementById('summaryBilled');
        const summaryBilledSub = document.getElementById('summaryBilledSub');
        const summaryCollected = document.getElementById('summaryCollected');
        const summaryCollectedSub = document.getElementById('summaryCollectedSub');
        const summaryRate = document.getElementById('summaryRate');
        const summaryRateSub = document.getElementById('summaryRateSub');
        const summaryOutstanding = document.getElementById('summaryOutstanding');
        const summaryOutstandingSub = document.getElementById('summaryOutstandingSub');

        const summaryDailyCanvas = document.getElementById('summaryDailyChart');
        const summaryAreaCanvas = document.getElementById('summaryAreaChart');
        const summaryAreaTableBody = document.getElementById('summaryAreaTableBody');
        const summaryAreaSummary = document.getElementById('summaryAreaSummary');

        const agingBucketsCanvas = document.getElementById('agingBucketsChart');
        const agingMinDays = document.getElementById('agingMinDays');
        const agingSearch = document.getElementById('agingSearch');
        const agingClearBtn = document.getElementById('agingClearBtn');
        const agingApplyBtn = document.getElementById('agingApplyBtn');
        const agingTableBody = document.getElementById('agingTableBody');
        const agingSummary = document.getElementById('agingSummary');

        const collectorTotalsCanvas = document.getElementById('collectorTotalsChart');
        const collectorSearch = document.getElementById('collectorSearch');
        const collectorClearBtn = document.getElementById('collectorClearBtn');
        const collectorApplyBtn = document.getElementById('collectorApplyBtn');
        const collectorTableBody = document.getElementById('collectorTableBody');
        const collectorSummary = document.getElementById('collectorSummary');

        const txnSearch = document.getElementById('txnSearch');
        const txnType = document.getElementById('txnType');
        const txnPageSize = document.getElementById('txnPageSize');
        const txnTableBody = document.getElementById('txnTableBody');
        const txnSummary = document.getElementById('txnSummary');
        const txnPrev = document.getElementById('txnPrev');
        const txnNext = document.getElementById('txnNext');
        const txnPageInfo = document.getElementById('txnPageInfo');

        const state = {
            activeTab: 'summary',
            records: [],
            collectors: { assignments: {}, accounts: [] },
            allTxns: [],
            charts: {
                summaryDaily: null,
                summaryArea: null,
                agingBuckets: null,
                collectorTotals: null
            },
            computed: {
                summaryAreaRows: [],
                agingRows: [],
                collectorRows: [],
                collectorSearch: '',
                agingSearch: '',
                agingMinDays: 0,
                txnsFiltered: []
            },
            txn: {
                search: '',
                type: 'payments',
                pageSize: 25,
                page: 1
            }
        };

        function showToast(message) {
            if (typeof window.appToast === 'function') {
                window.appToast(message, { type: 'info' });
                return;
            }
            if (!toast) return;
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        function setActiveTab(nextTab) {
            const tab = String(nextTab || '').trim() || 'summary';
            state.activeTab = tab;

            tabs.forEach((btn) => {
                const isActive = btn.dataset.tab === tab;
                btn.classList.toggle('is-active', isActive);
                btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });
            panels.forEach((panel) => {
                panel.classList.toggle('is-active', panel.dataset.panel === tab);
            });

            // Ensure charts resize after becoming visible
            window.setTimeout(() => {
                if (tab === 'summary') {
                    state.charts.summaryDaily?.resize?.();
                    state.charts.summaryArea?.resize?.();
                } else if (tab === 'aging') {
                    renderAgingChart();
                    state.charts.agingBuckets?.resize?.();
                } else if (tab === 'collectors') {
                    renderCollectorChart();
                    state.charts.collectorTotals?.resize?.();
                }
            }, 30);
        }

        function destroyChart(key) {
            if (!state.charts[key]) return;
            try {
                state.charts[key].destroy();
            } catch {
                // ignore
            }
            state.charts[key] = null;
        }

        function buildAreasFromRecords(records) {
            const set = new Set();
            (records || []).forEach((r) => {
                const area = String(r?.area || '').trim();
                if (area) set.add(area);
            });
            return Array.from(set).sort((a, b) => a.localeCompare(b));
        }

        function populateAreaOptions(areas) {
            if (!reportsArea) return;
            const current = String(reportsArea.value || '');
            reportsArea.innerHTML = '';

            const allOpt = document.createElement('option');
            allOpt.value = '';
            allOpt.textContent = 'All areas';
            reportsArea.appendChild(allOpt);

            areas.forEach((area) => {
                const opt = document.createElement('option');
                opt.value = area;
                opt.textContent = area;
                reportsArea.appendChild(opt);
            });

            const exists = Array.from(reportsArea.options).some((opt) => opt.value === current);
            reportsArea.value = exists ? current : '';
        }

        function buildAllTransactions(records) {
            const txns = [];
            (records || []).forEach((record) => {
                const accountNumber = String(record?.accountNumber || '').trim();
                if (!accountNumber) return;
                const subscriber = formatCustomerName(record);
                const area = String(record?.area || '').trim() || '';
                const dueDate = record?.dueDate || record?.due || record?.nextDueDate || '';
                const paymentStatus = record?.status || '';
                const planCategory = String(record?.planCategory || '').trim().toLowerCase() || '';
                const history = Array.isArray(record?.history) ? record.history : [];

                history.forEach((entry) => {
                    const amount = Math.abs(Number(entry?.amount) || 0);
                    if (!amount) return;
                    const kind = normalizeKind(entry?.kind);
                    const direction = resolveDirection(entry);
                    const dateObj = parseDateValue(entry?.date || entry?.recordedAt);
                    if (!dateObj) return;

                    const recorder = entry?.recordedBy && typeof entry.recordedBy === 'object' ? entry.recordedBy : null;
                    const recorderId = recorder?.id != null ? String(recorder.id).trim() : '';
                    const recorderName = formatRecorderLabel(recorder, kind);

                    const reference = String(entry?.reference || entry?.refNo || entry?.receiptNo || '').trim();

                    txns.push({
                        accountNumber,
                        subscriber,
                        area,
                        dueDate,
                        paymentStatus,
                        planCategory,
                        kind,
                        direction,
                        amount,
                        reference,
                        recorder,
                        recorderId,
                        recorderName,
                        dateObj,
                        dateKey: formatDateISO(parseDateOnly(dateObj) || dateObj)
                    });
                });
            });

            txns.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
            return txns;
        }

        function getCurrentAreaFilter() {
            return String(reportsArea?.value || '').trim();
        }

        function getCurrentRangeFilter() {
            const { from, to, swapped } = normalizeRangeInputs(reportsFrom, reportsTo);
            if (swapped) showToast('From/To were swapped (invalid range).');
            return { from, to };
        }

        function filterTxns(txns, { from, to }, area) {
            return (txns || []).filter((t) => {
                if (area && t.area !== area) return false;
                return withinRange(t.dateObj, from, to);
            });
        }

        function computeOutstanding(records, area) {
            let outstanding = 0;
            let count = 0;
            (records || []).forEach((r) => {
                if (area && String(r?.area || '').trim() !== area) return;
                const balance = Number(r?.balance) || 0;
                if (balance > 0) {
                    outstanding += balance;
                    count += 1;
                }
            });
            return { outstanding, count };
        }

        function computeSummary(txns, { from, to }, area) {
            let billed = 0;
            let collected = 0;
            let chargeCount = 0;
            let paymentCount = 0;

            const areaMap = new Map();

            txns.forEach((t) => {
                const bucketArea = t.area || 'Unassigned';
                if (!areaMap.has(bucketArea)) {
                    areaMap.set(bucketArea, { area: bucketArea, collected: 0, billed: 0, payments: 0, charges: 0 });
                }
                const bucket = areaMap.get(bucketArea);

                if (t.direction === 'debit') {
                    billed += t.amount;
                    chargeCount += 1;
                    bucket.billed += t.amount;
                    bucket.charges += 1;
                } else if (t.direction === 'credit' && t.kind === 'payment') {
                    collected += t.amount;
                    paymentCount += 1;
                    bucket.collected += t.amount;
                    bucket.payments += 1;
                }
            });

            const areaRows = Array.from(areaMap.values()).sort((a, b) => b.collected - a.collected);

            // Decide time grain for the line chart (day vs month).
            let start = from;
            let end = to;
            if (!start || !end) {
                const first = txns[txns.length - 1]?.dateObj || null;
                const last = txns[0]?.dateObj || null;
                start = start || (first ? parseDateOnly(first) : null);
                end = end || (last ? parseDateOnly(last) : null);
            }
            const spanDays = start && end ? Math.max(0, dateDiffDays(start, end) || 0) : 0;
            const grain = spanDays > 120 ? 'month' : 'day';

            const seriesMap = new Map();
            const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
            const dayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

            txns.forEach((t) => {
                const d = parseDateOnly(t.dateObj) || t.dateObj;
                const key = grain === 'month'
                    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                    : formatDateISO(d);
                if (!seriesMap.has(key)) {
                    const label = grain === 'month'
                        ? monthFormatter.format(new Date(d.getFullYear(), d.getMonth(), 1))
                        : dayFormatter.format(d);
                    seriesMap.set(key, { key, label, billed: 0, collected: 0 });
                }
                const row = seriesMap.get(key);
                if (t.direction === 'debit') row.billed += t.amount;
                if (t.direction === 'credit' && t.kind === 'payment') row.collected += t.amount;
            });

            let series = Array.from(seriesMap.values());
            series.sort((a, b) => a.key.localeCompare(b.key));

            // If day grain and a sane range, fill missing days for smoother chart UX.
            if (grain === 'day' && start && end && spanDays <= 60) {
                const filled = [];
                const map = new Map(series.map((s) => [s.key, s]));
                const cursor = new Date(start);
                while (cursor.getTime() <= end.getTime()) {
                    const key = formatDateISO(cursor);
                    const existing = map.get(key);
                    filled.push(existing || { key, label: dayFormatter.format(cursor), billed: 0, collected: 0 });
                    cursor.setDate(cursor.getDate() + 1);
                }
                series = filled;
            }

            const outstanding = computeOutstanding(state.records, area);
            const rate = billed > 0 ? (collected / billed) * 100 : 0;

            return {
                billed,
                collected,
                rate,
                chargeCount,
                paymentCount,
                series,
                areaRows,
                outstanding
            };
        }

        function renderSummary(summary, { from, to }, area) {
            if (!summary) return;

            if (summaryBilled) summaryBilled.textContent = formatCurrency(summary.billed);
            if (summaryBilledSub) summaryBilledSub.textContent = `${summary.chargeCount.toLocaleString()} charges`;

            if (summaryCollected) summaryCollected.textContent = formatCurrency(summary.collected);
            if (summaryCollectedSub) summaryCollectedSub.textContent = `${summary.paymentCount.toLocaleString()} payments`;

            if (summaryRate) summaryRate.textContent = `${summary.rate.toFixed(1)}%`;
            if (summaryRateSub) summaryRateSub.textContent = summary.billed > 0 ? 'Based on billed vs collected' : 'No billed amount for range';

            if (summaryOutstanding) summaryOutstanding.textContent = formatCurrency(summary.outstanding.outstanding);
            if (summaryOutstandingSub) summaryOutstandingSub.textContent = `${summary.outstanding.count.toLocaleString()} accounts due`;

            // Area breakdown table
            if (summaryAreaTableBody) {
                summaryAreaTableBody.innerHTML = '';
                if (!summary.areaRows.length) {
                    const tr = document.createElement('tr');
                    const td = document.createElement('td');
                    td.colSpan = 5;
                    td.className = 'empty';
                    td.textContent = 'No data for the selected filters.';
                    tr.appendChild(td);
                    summaryAreaTableBody.appendChild(tr);
                } else {
                    summary.areaRows.forEach((row) => {
                        const tr = document.createElement('tr');
                        const tdArea = document.createElement('td');
                        tdArea.textContent = row.area;
                        const tdCollected = document.createElement('td');
                        tdCollected.textContent = formatCurrency(row.collected);
                        tdCollected.className = 'num';
                        const tdBilled = document.createElement('td');
                        tdBilled.textContent = formatCurrency(row.billed);
                        tdBilled.className = 'num';
                        const tdPayments = document.createElement('td');
                        tdPayments.textContent = row.payments.toLocaleString();
                        tdPayments.className = 'num';
                        const tdCharges = document.createElement('td');
                        tdCharges.textContent = row.charges.toLocaleString();
                        tdCharges.className = 'num';
                        tr.appendChild(tdArea);
                        tr.appendChild(tdCollected);
                        tr.appendChild(tdBilled);
                        tr.appendChild(tdPayments);
                        tr.appendChild(tdCharges);
                        summaryAreaTableBody.appendChild(tr);
                    });
                }
            }

            if (summaryAreaSummary) {
                const areaLabel = area ? `Area: ${area}` : 'All areas';
                const fromLabel = from ? formatDateISO(from) : 'All time';
                const toLabel = to ? formatDateISO(to) : 'All time';
                summaryAreaSummary.textContent = `${areaLabel} | ${fromLabel} to ${toLabel} | Collected ${formatCurrency(summary.collected)} | Billed ${formatCurrency(summary.billed)}`;
            }

            state.computed.summaryAreaRows = summary.areaRows;
            renderSummaryCharts(summary);
        }

        function renderSummaryCharts(summary) {
            const theme = getChartTheme();

            if (summaryDailyCanvas) {
                destroyChart('summaryDaily');
                if (!summary.series.length || summary.series.every((s) => (s.billed || 0) === 0 && (s.collected || 0) === 0)) {
                    ensureChartMessage(summaryDailyCanvas, 'No billed or collected activity for this range.');
                } else {
                    clearChartMessage(summaryDailyCanvas);
                    const labels = summary.series.map((s) => s.label);
                    const billedData = summary.series.map((s) => Number(s.billed) || 0);
                    const collectedData = summary.series.map((s) => Number(s.collected) || 0);

                    state.charts.summaryDaily = new Chart(summaryDailyCanvas, {
                        type: 'line',
                        data: {
                            labels,
                            datasets: [
                                {
                                    label: 'Billed',
                                    data: billedData,
                                    borderColor: '#2563eb',
                                    backgroundColor: 'rgba(37, 99, 235, 0.12)',
                                    fill: true,
                                    tension: 0.35,
                                    pointRadius: 3,
                                    pointHoverRadius: 6,
                                    pointBackgroundColor: theme.canvasBorder,
                                    pointBorderColor: '#2563eb',
                                    pointBorderWidth: 2
                                },
                                {
                                    label: 'Collected',
                                    data: collectedData,
                                    borderColor: '#16a34a',
                                    backgroundColor: 'rgba(34, 197, 94, 0.12)',
                                    fill: true,
                                    tension: 0.35,
                                    pointRadius: 3,
                                    pointHoverRadius: 6,
                                    pointBackgroundColor: theme.canvasBorder,
                                    pointBorderColor: '#16a34a',
                                    pointBorderWidth: 2
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            interaction: { mode: 'index', intersect: false },
                            plugins: {
                                legend: { position: 'top', align: 'end', labels: { color: theme.text } },
                                tooltip: {
                                    callbacks: {
                                        label: (context) => `${context.dataset.label}: ${formatCurrency(Number(context.raw) || 0)}`
                                    }
                                }
                            },
                            scales: {
                                x: { grid: { display: false }, ticks: { color: theme.muted } },
                                y: {
                                    beginAtZero: true,
                                    grid: { color: theme.grid, drawBorder: false },
                                    ticks: { color: theme.muted, callback: (value) => formatCurrency(Number(value) || 0) }
                                }
                            }
                        }
                    });
                }
            }

            if (summaryAreaCanvas) {
                destroyChart('summaryArea');
                const base = summary.areaRows.filter((r) => (r.collected || 0) > 0);
                if (!base.length) {
                    ensureChartMessage(summaryAreaCanvas, 'No collections for the selected range.');
                } else {
                    clearChartMessage(summaryAreaCanvas);
                    const sorted = [...base].sort((a, b) => b.collected - a.collected);
                    const top = sorted.slice(0, 7);
                    const rest = sorted.slice(7);
                    const otherTotal = rest.reduce((sum, r) => sum + (Number(r.collected) || 0), 0);
                    const rows = otherTotal > 0 ? [...top, { area: 'Other', collected: otherTotal }] : top;

                    const labels = rows.map((r) => r.area);
                    const data = rows.map((r) => Number(r.collected) || 0);
                    const palette = ['#2563eb', '#16a34a', '#f59e0b', '#0ea5e9', '#ef4444', '#8b5cf6', '#14b8a6', '#94a3b8'];

                    state.charts.summaryArea = new Chart(summaryAreaCanvas, {
                        type: 'doughnut',
                        data: {
                            labels,
                            datasets: [{
                                data,
                                backgroundColor: data.map((_, idx) => palette[idx % palette.length]),
                                borderColor: theme.canvasBorder,
                                borderWidth: 2,
                                hoverOffset: 8
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    position: 'bottom',
                                    labels: { color: theme.text, usePointStyle: true, padding: 16 }
                                },
                                tooltip: {
                                    callbacks: {
                                        label: (context) => `${context.label}: ${formatCurrency(Number(context.raw) || 0)}`
                                    }
                                }
                            }
                        }
                    });
                }
            }
        }

        // ---- Aging ----

        function computeAging(records, toDate, area) {
            const end = toDate || todayLocal();
            const minDays = Math.max(0, Number(state.computed.agingMinDays) || 0);
            const search = String(state.computed.agingSearch || '').trim().toLowerCase();

            const rows = [];
            const buckets = [
                { key: '0-30', label: '0-30', total: 0, count: 0 },
                { key: '31-60', label: '31-60', total: 0, count: 0 },
                { key: '61-90', label: '61-90', total: 0, count: 0 },
                { key: '90+', label: '90+', total: 0, count: 0 }
            ];

            const pickBucket = (days) => {
                if (days <= 30) return buckets[0];
                if (days <= 60) return buckets[1];
                if (days <= 90) return buckets[2];
                return buckets[3];
            };

            (records || []).forEach((r) => {
                const planCategory = String(r?.planCategory || '').trim().toLowerCase();
                if (planCategory === 'prepaid') return;
                if (area && String(r?.area || '').trim() !== area) return;
                const balance = Number(r?.balance) || 0;
                if (balance <= 0) return;

                const due = parseDateOnly(r?.dueDate);
                const diff = due ? (dateDiffDays(due, end) || 0) : 0;
                const daysOverdue = Math.max(0, diff);

                const bucket = pickBucket(daysOverdue);
                bucket.total += balance;
                bucket.count += 1;

                const row = {
                    accountNumber: String(r?.accountNumber || '').trim(),
                    subscriber: formatCustomerName(r),
                    area: String(r?.area || '').trim() || '',
                    status: String(r?.status || '').trim(),
                    dueDate: r?.dueDate || '',
                    daysOverdue,
                    balance
                };

                if (daysOverdue < minDays) return;
                if (search) {
                    const haystack = `${row.accountNumber} ${row.subscriber} ${row.area} ${row.status}`.toLowerCase();
                    if (!haystack.includes(search)) return;
                }
                rows.push(row);
            });

            rows.sort((a, b) => {
                if (b.daysOverdue !== a.daysOverdue) return b.daysOverdue - a.daysOverdue;
                return (b.balance || 0) - (a.balance || 0);
            });

            const totals = {
                count: rows.length,
                balance: rows.reduce((sum, r) => sum + (Number(r.balance) || 0), 0)
            };

            return { end, rows, buckets, totals };
        }

        function renderAgingTable(aging) {
            if (!agingTableBody) return;
            agingTableBody.innerHTML = '';

            if (!aging.rows.length) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 7;
                td.className = 'empty';
                td.textContent = 'No outstanding accounts match the filters.';
                tr.appendChild(td);
                agingTableBody.appendChild(tr);
            } else {
                aging.rows.forEach((row) => {
                    const tr = document.createElement('tr');

                    const tdAcct = document.createElement('td');
                    tdAcct.textContent = row.accountNumber || '--';
                    const tdName = document.createElement('td');
                    tdName.textContent = row.subscriber || '--';
                    const tdArea = document.createElement('td');
                    tdArea.textContent = row.area || '--';
                    const tdStatus = document.createElement('td');
                    tdStatus.textContent = row.status || '--';
                    const tdDue = document.createElement('td');
                    tdDue.textContent = row.dueDate ? formatDate(row.dueDate) : 'N/A';
                    const tdDays = document.createElement('td');
                    tdDays.textContent = Number.isFinite(row.daysOverdue) ? row.daysOverdue.toLocaleString() : '0';
                    tdDays.className = 'num';
                    const tdBal = document.createElement('td');
                    tdBal.textContent = formatCurrency(row.balance);
                    tdBal.className = 'num amount debit';

                    tr.appendChild(tdAcct);
                    tr.appendChild(tdName);
                    tr.appendChild(tdArea);
                    tr.appendChild(tdStatus);
                    tr.appendChild(tdDue);
                    tr.appendChild(tdDays);
                    tr.appendChild(tdBal);
                    agingTableBody.appendChild(tr);
                });
            }

            if (agingSummary) {
                const endLabel = aging.end ? formatDateISO(aging.end) : 'Today';
                agingSummary.textContent = `${aging.totals.count.toLocaleString()} accounts | ${formatCurrency(aging.totals.balance)} outstanding | As of ${endLabel}`;
            }
        }

        function renderAgingChart() {
            if (state.activeTab !== 'aging') return;
            if (!agingBucketsCanvas) return;

            const { to } = getCurrentRangeFilter();
            const area = getCurrentAreaFilter();
            const aging = computeAging(state.records, to || todayLocal(), area);

            state.computed.agingRows = aging.rows;

            const theme = getChartTheme();
            destroyChart('agingBuckets');

            const haveData = aging.buckets.some((b) => (b.total || 0) > 0);
            if (!haveData) {
                ensureChartMessage(agingBucketsCanvas, 'No outstanding balances for the selected filters.');
                renderAgingTable(aging);
                return;
            }
            clearChartMessage(agingBucketsCanvas);

            const labels = aging.buckets.map((b) => b.label);
            const data = aging.buckets.map((b) => Number(b.total) || 0);

            state.charts.agingBuckets = new Chart(agingBucketsCanvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Outstanding',
                        data,
                        backgroundColor: [
                            'rgba(37, 99, 235, 0.55)',
                            'rgba(14, 165, 233, 0.55)',
                            'rgba(249, 115, 22, 0.55)',
                            'rgba(239, 68, 68, 0.55)'
                        ],
                        borderColor: theme.canvasBorder,
                        borderWidth: 1,
                        borderRadius: 10,
                        maxBarThickness: 56
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (context) => ` ${formatCurrency(Number(context.raw) || 0)}`
                            }
                        }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: theme.muted } },
                        y: {
                            beginAtZero: true,
                            grid: { color: theme.grid, drawBorder: false },
                            ticks: { color: theme.muted, callback: (value) => formatCurrency(Number(value) || 0) }
                        }
                    }
                }
            });

            renderAgingTable(aging);
        }

        // ---- Collectors ----

        function computeCollectors(txns, assignments, collectorAccounts) {
            const collectorsById = new Map((collectorAccounts || []).map((c) => [String(c?.id || '').trim(), c]));

            const areasByCollector = new Map();
            Object.entries(assignments || {}).forEach(([areaName, collectorId]) => {
                const id = String(collectorId || '').trim();
                if (!id) return;
                if (!areasByCollector.has(id)) areasByCollector.set(id, []);
                areasByCollector.get(id).push(String(areaName || '').trim());
            });
            areasByCollector.forEach((list) => list.sort((a, b) => a.localeCompare(b)));

            const perf = new Map();
            (collectorAccounts || []).forEach((acc) => {
                const id = String(acc?.id || '').trim();
                if (!id) return;
                perf.set(id, {
                    id,
                    name: String(acc?.name || acc?.username || id).trim(),
                    collected: 0,
                    payments: 0,
                    accounts: new Set(),
                    areas: areasByCollector.get(id) || []
                });
            });

            txns.forEach((t) => {
                if (t.direction !== 'credit') return;
                if (t.kind !== 'payment') return;
                const recorderId = String(t.recorderId || '').trim();
                if (!recorderId) return;
                if (!collectorsById.has(recorderId)) return;
                const entry = perf.get(recorderId);
                if (!entry) return;
                entry.collected += t.amount;
                entry.payments += 1;
                entry.accounts.add(t.accountNumber);
            });

            const search = String(state.computed.collectorSearch || '').trim().toLowerCase();
            let rows = Array.from(perf.values()).map((r) => ({
                collectorId: r.id,
                collector: r.name,
                collected: r.collected,
                payments: r.payments,
                uniqueAccounts: r.accounts.size,
                areas: r.areas
            }));

            if (search) {
                rows = rows.filter((r) => {
                    const haystack = `${r.collector} ${r.areas.join(' ')}`.toLowerCase();
                    return haystack.includes(search);
                });
            }

            rows.sort((a, b) => b.collected - a.collected);

            const totals = {
                collectors: rows.length,
                collected: rows.reduce((sum, r) => sum + (Number(r.collected) || 0), 0),
                payments: rows.reduce((sum, r) => sum + (Number(r.payments) || 0), 0)
            };

            return { rows, totals };
        }

        function renderCollectorsTable(model) {
            if (!collectorTableBody) return;
            collectorTableBody.innerHTML = '';

            if (!model.rows.length) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 5;
                td.className = 'empty';
                td.textContent = 'No collectors match the filters.';
                tr.appendChild(td);
                collectorTableBody.appendChild(tr);
            } else {
                model.rows.forEach((row) => {
                    const tr = document.createElement('tr');
                    const tdName = document.createElement('td');
                    tdName.textContent = row.collector || row.collectorId || 'Unknown';
                    const tdCollected = document.createElement('td');
                    tdCollected.textContent = formatCurrency(row.collected);
                    tdCollected.className = 'num amount credit';
                    const tdPayments = document.createElement('td');
                    tdPayments.textContent = row.payments.toLocaleString();
                    tdPayments.className = 'num';
                    const tdAccounts = document.createElement('td');
                    tdAccounts.textContent = row.uniqueAccounts.toLocaleString();
                    tdAccounts.className = 'num';
                    const tdAreas = document.createElement('td');
                    const list = Array.isArray(row.areas) ? row.areas : [];
                    tdAreas.textContent = list.length.toLocaleString();
                    tdAreas.className = 'num';
                    if (list.length) tdAreas.title = list.join(', ');

                    tr.appendChild(tdName);
                    tr.appendChild(tdCollected);
                    tr.appendChild(tdPayments);
                    tr.appendChild(tdAccounts);
                    tr.appendChild(tdAreas);
                    collectorTableBody.appendChild(tr);
                });
            }

            if (collectorSummary) {
                collectorSummary.textContent = `${model.totals.collectors.toLocaleString()} collectors | ${formatCurrency(model.totals.collected)} collected | ${model.totals.payments.toLocaleString()} payments`;
            }
        }

        function renderCollectorChart() {
            if (state.activeTab !== 'collectors') return;
            if (!collectorTotalsCanvas) return;

            const { from, to } = getCurrentRangeFilter();
            const area = getCurrentAreaFilter();
            const txns = filterTxns(state.allTxns, { from, to }, area);
            const model = computeCollectors(txns, state.collectors.assignments, state.collectors.accounts);
            state.computed.collectorRows = model.rows;

            const theme = getChartTheme();
            destroyChart('collectorTotals');

            const nonZero = model.rows.filter((r) => (r.collected || 0) > 0);
            if (!nonZero.length) {
                ensureChartMessage(collectorTotalsCanvas, 'No collector-recorded payments for the selected range.');
                renderCollectorsTable(model);
                return;
            }
            clearChartMessage(collectorTotalsCanvas);

            const top = nonZero.slice(0, 10);
            const labels = top.map((r) => r.collector);
            const data = top.map((r) => Number(r.collected) || 0);

            state.charts.collectorTotals = new Chart(collectorTotalsCanvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Collected',
                        data,
                        backgroundColor: 'rgba(16, 185, 129, 0.55)',
                        borderColor: theme.canvasBorder,
                        borderWidth: 1,
                        borderRadius: 10,
                        maxBarThickness: 56
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (context) => ` ${formatCurrency(Number(context.raw) || 0)}`
                            }
                        }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: theme.muted } },
                        y: {
                            beginAtZero: true,
                            grid: { color: theme.grid, drawBorder: false },
                            ticks: { color: theme.muted, callback: (value) => formatCurrency(Number(value) || 0) }
                        }
                    }
                }
            });

            renderCollectorsTable(model);
        }

        // ---- Transactions ----

        function computeTransactionsView(txns, { from, to }, area) {
            const search = String(state.txn.search || '').trim().toLowerCase();
            const type = String(state.txn.type || 'payments').trim();

            let rows = filterTxns(txns, { from, to }, area);
            if (type === 'payments') {
                rows = rows.filter((t) => t.direction === 'credit' && t.kind === 'payment');
            } else if (type === 'credits') {
                rows = rows.filter((t) => t.direction === 'credit');
            } else if (type === 'debits') {
                rows = rows.filter((t) => t.direction === 'debit');
            }

            if (search) {
                rows = rows.filter((t) => {
                    const haystack = `${t.accountNumber} ${t.subscriber} ${t.area} ${t.kind} ${t.direction} ${t.reference} ${t.recorderName}`.toLowerCase();
                    return haystack.includes(search);
                });
            }

            rows.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
            return rows;
        }

        function renderTransactionsTable(rows) {
            if (!txnTableBody) return;
            txnTableBody.innerHTML = '';

            const total = rows.length;
            const pageSize = Math.max(1, Number(state.txn.pageSize) || 25);
            const pageCount = Math.ceil(total / pageSize) || 1;
            state.txn.page = Math.min(Math.max(1, state.txn.page), pageCount);

            const startIndex = (state.txn.page - 1) * pageSize;
            const endIndex = Math.min(startIndex + pageSize, total);
            const slice = rows.slice(startIndex, endIndex);

            if (!slice.length) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 9;
                td.className = 'empty';
                td.textContent = 'No transactions match the filters.';
                tr.appendChild(td);
                txnTableBody.appendChild(tr);
            } else {
                slice.forEach((t) => {
                    const tr = document.createElement('tr');
                    const tdDate = document.createElement('td');
                    tdDate.textContent = formatDate(t.dateObj);
                    const tdAcct = document.createElement('td');
                    tdAcct.textContent = t.accountNumber;
                    const tdName = document.createElement('td');
                    tdName.textContent = t.subscriber;
                    tdName.className = 'truncate';
                    if (t.subscriber) tdName.title = t.subscriber;
                    const tdArea = document.createElement('td');
                    tdArea.textContent = t.area || '--';
                    const tdKind = document.createElement('td');
                    tdKind.textContent = toTitleCase(t.kind);
                    const tdDir = document.createElement('td');
                    tdDir.textContent = toTitleCase(t.direction);
                    const tdAmt = document.createElement('td');
                    tdAmt.textContent = formatSignedCurrency(t.direction, t.amount);
                    tdAmt.className = `num amount ${t.direction || ''}`.trim();
                    const tdRef = document.createElement('td');
                    tdRef.textContent = t.reference || '--';
                    tdRef.className = 'truncate';
                    if (t.reference) tdRef.title = t.reference;
                    const tdRec = document.createElement('td');
                    tdRec.textContent = t.recorderName || '--';
                    tdRec.className = 'truncate';
                    if (t.recorderName) tdRec.title = t.recorderName;

                    tr.appendChild(tdDate);
                    tr.appendChild(tdAcct);
                    tr.appendChild(tdName);
                    tr.appendChild(tdArea);
                    tr.appendChild(tdKind);
                    tr.appendChild(tdDir);
                    tr.appendChild(tdAmt);
                    tr.appendChild(tdRef);
                    tr.appendChild(tdRec);
                    txnTableBody.appendChild(tr);
                });
            }

            if (txnSummary) {
                const shown = total ? `${(startIndex + 1).toLocaleString()}-${endIndex.toLocaleString()}` : '0';
                txnSummary.textContent = `Showing ${shown} of ${total.toLocaleString()} transactions`;
            }
            if (txnPageInfo) txnPageInfo.textContent = `Page ${state.txn.page} of ${pageCount}`;
            if (txnPrev) txnPrev.disabled = state.txn.page <= 1;
            if (txnNext) txnNext.disabled = state.txn.page >= pageCount;
        }

        function renderAll() {
            const area = getCurrentAreaFilter();
            const { from, to } = getCurrentRangeFilter();

            const filteredTxns = filterTxns(state.allTxns, { from, to }, area);
            const summary = computeSummary(filteredTxns, { from, to }, area);
            renderSummary(summary, { from, to }, area);

            const aging = computeAging(state.records, to || todayLocal(), area);
            state.computed.agingRows = aging.rows;
            if (state.activeTab === 'aging') {
                renderAgingChart();
            } else {
                renderAgingTable(aging);
            }

            const collectorsModel = computeCollectors(filteredTxns, state.collectors.assignments, state.collectors.accounts);
            state.computed.collectorRows = collectorsModel.rows;
            if (state.activeTab === 'collectors') {
                renderCollectorChart();
            } else {
                renderCollectorsTable(collectorsModel);
            }

            const txView = computeTransactionsView(state.allTxns, { from, to }, area);
            state.computed.txnsFiltered = txView;
            renderTransactionsTable(txView);
        }

        async function loadData() {
            const unlock = window.withButtonLock?.(reportsRefreshBtn, { label: '<i class="fa-solid fa-rotate"></i> Refreshing...' });
            try {
                const [recordsRes, collectorsRes] = await Promise.all([
                    fetch('/api/payment-records', { cache: 'no-store' }).then((r) => r.json()),
                    fetch('/api/collectors', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ ok: false }))
                ]);

                state.records = Array.isArray(recordsRes?.records) ? recordsRes.records : [];
                state.collectors = {
                    assignments: collectorsRes?.assignments && typeof collectorsRes.assignments === 'object' ? collectorsRes.assignments : {},
                    accounts: Array.isArray(collectorsRes?.accounts) ? collectorsRes.accounts : []
                };
                state.allTxns = buildAllTransactions(state.records);

                const areas = buildAreasFromRecords(state.records);
                populateAreaOptions(areas);

                renderAll();
            } catch (err) {
                console.error('Failed to load reports data', err);
                showToast('Failed to load reports data. Please refresh.');
            } finally {
                if (typeof unlock === 'function') unlock();
            }
        }

        function bindEvents() {
            tabs.forEach((btn) => {
                btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
            });

            if (reportsRange) {
                reportsRange.addEventListener('change', () => {
                    const preset = computePresetRange(reportsRange.value);
                    if (reportsFrom) reportsFrom.value = preset.from ? formatDateISO(preset.from) : '';
                    if (reportsTo) reportsTo.value = preset.to ? formatDateISO(preset.to) : '';
                    renderAll();
                });
            }

            if (reportsFrom) reportsFrom.addEventListener('change', () => renderAll());
            if (reportsTo) reportsTo.addEventListener('change', () => renderAll());
            if (reportsArea) reportsArea.addEventListener('change', () => renderAll());

            if (reportsRefreshBtn) reportsRefreshBtn.addEventListener('click', () => loadData());

            if (agingApplyBtn) {
                agingApplyBtn.addEventListener('click', () => {
                    state.computed.agingMinDays = Math.max(0, Number(agingMinDays?.value) || 0);
                    state.computed.agingSearch = String(agingSearch?.value || '');
                    renderAll();
                    showToast('Aging filters applied.');
                });
            }
            if (agingClearBtn) {
                agingClearBtn.addEventListener('click', () => {
                    state.computed.agingMinDays = 0;
                    state.computed.agingSearch = '';
                    if (agingMinDays) agingMinDays.value = '';
                    if (agingSearch) agingSearch.value = '';
                    renderAll();
                    showToast('Aging filters cleared.');
                });
            }

            if (collectorApplyBtn) {
                collectorApplyBtn.addEventListener('click', () => {
                    state.computed.collectorSearch = String(collectorSearch?.value || '');
                    renderAll();
                    showToast('Collector filters applied.');
                });
            }
            if (collectorClearBtn) {
                collectorClearBtn.addEventListener('click', () => {
                    state.computed.collectorSearch = '';
                    if (collectorSearch) collectorSearch.value = '';
                    renderAll();
                    showToast('Collector filters cleared.');
                });
            }

            if (txnSearch) {
                let timer = null;
                txnSearch.addEventListener('input', () => {
                    window.clearTimeout(timer);
                    timer = window.setTimeout(() => {
                        state.txn.search = String(txnSearch.value || '');
                        state.txn.page = 1;
                        renderAll();
                    }, 120);
                });
            }

            if (txnType) {
                txnType.addEventListener('change', () => {
                    state.txn.type = String(txnType.value || 'payments');
                    state.txn.page = 1;
                    renderAll();
                });
            }

            if (txnPageSize) {
                txnPageSize.addEventListener('change', () => {
                    state.txn.pageSize = Math.max(1, Number(txnPageSize.value) || 25);
                    state.txn.page = 1;
                    renderAll();
                });
            }

            if (txnPrev) {
                txnPrev.addEventListener('click', () => {
                    state.txn.page = Math.max(1, state.txn.page - 1);
                    renderTransactionsTable(state.computed.txnsFiltered || []);
                });
            }
            if (txnNext) {
                txnNext.addEventListener('click', () => {
                    state.txn.page += 1;
                    renderTransactionsTable(state.computed.txnsFiltered || []);
                });
            }

            // Theme toggle updates charts.
            const obs = new MutationObserver(() => {
                renderAll();
            });
            obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        }

        // Initial preset
        if (reportsRange && reportsRange.value) {
            const preset = computePresetRange(reportsRange.value);
            if (reportsFrom) reportsFrom.value = preset.from ? formatDateISO(preset.from) : '';
            if (reportsTo) reportsTo.value = preset.to ? formatDateISO(preset.to) : '';
        }
        if (txnPageSize) {
            state.txn.pageSize = Math.max(1, Number(txnPageSize.value) || 25);
        }
        if (txnType) {
            state.txn.type = String(txnType.value || 'payments');
        }

        bindEvents();
        setActiveTab('summary');
        loadData();
    });
})();
