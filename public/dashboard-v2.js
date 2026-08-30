document.addEventListener('DOMContentLoaded', () => {
    const elements = {
        activeCustomers: document.getElementById('dashboardV2ActiveCustomers'),
        activeMeta: document.getElementById('dashboardV2ActiveMeta'),
        outstanding: document.getElementById('dashboardV2Outstanding'),
        outstandingMeta: document.getElementById('dashboardV2OutstandingMeta'),
        collectionsToday: document.getElementById('dashboardV2CollectionsToday'),
        collectionsMeta: document.getElementById('dashboardV2CollectionsMeta'),
        openWork: document.getElementById('dashboardV2OpenWork'),
        openWorkMeta: document.getElementById('dashboardV2OpenWorkMeta'),
        areaFilter: document.getElementById('dashboardV2AreaFilter'),
        scopeMeta: document.getElementById('dashboardV2ScopeMeta'),
        refresh: document.getElementById('dashboardV2Refresh'),
        alert: document.getElementById('dashboardV2Alert'),
        trendMeta: document.getElementById('dashboardV2TrendMeta'),
        collectionRate: document.getElementById('dashboardV2CollectionRate'),
        chart: document.getElementById('dashboardV2CollectionChart'),
        chartEmpty: document.getElementById('dashboardV2ChartEmpty'),
        workQueue: document.getElementById('dashboardV2WorkQueue'),
        recentPayments: document.getElementById('dashboardV2RecentPayments'),
        attentionList: document.getElementById('dashboardV2AttentionList'),
        updated: document.getElementById('dashboardV2Updated')
    };

    const locale = 'en-PH';
    const currencyFormatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const compactCurrencyFormatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'PHP',
        notation: 'compact',
        maximumFractionDigits: 1
    });
    const countFormatter = new Intl.NumberFormat(locale);
    const dateFormatter = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' });
    const timeFormatter = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
    const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'short' });

    const state = {
        records: [],
        jobs: [],
        tickets: [],
        chart: null,
        loading: false
    };

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const formatCurrency = (value) => currencyFormatter.format(Number(value) || 0);
    const formatCount = (value) => countFormatter.format(Number(value) || 0);
    const parseDate = (value) => {
        if (!value) return null;
        const parsed = value instanceof Date ? value : new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const isSameDay = (left, right) => (
        left instanceof Date
        && right instanceof Date
        && left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate()
    );
    const getAccountNumber = (record = {}) => String(record.accountNumber || '').trim();
    const getCustomerName = (record = {}) => {
        const fullName = `${record.firstName || ''} ${record.lastName || ''}`.trim();
        return fullName || String(record.name || record.customerName || '').trim() || `Account ${getAccountNumber(record) || '-'}`;
    };
    const getArea = (record = {}) => String(
        record.area
        || record.areaName
        || record.coverageArea
        || record.cluster
        || record.zone
        || record.serviceArea
        || ''
    ).trim();
    const normalizeSubscriberStatus = (record = {}) => {
        const raw = String(record.subscriberStatus || record.customerStatus || record.status || '').trim().toLowerCase();
        if (raw === 'force-active') return 'active';
        if (raw === 'force-inactive') return 'inactive';
        return ['active', 'inactive', 'disabled'].includes(raw) ? raw : 'active';
    };
    const getEndingBalance = (record = {}) => {
        const value = Number(record.billingSummary?.endingBalance ?? record.endingBalance ?? record.balance);
        return Number.isFinite(value) ? value : 0;
    };
    const isCollectedPayment = (entry = {}) => {
        const direction = String(entry.direction || '').trim().toLowerCase();
        const kind = String(entry.kind || '').trim().toLowerCase();
        const hasPaymentSource = Boolean(entry.paymentMethod || entry.payment_method || entry.method || entry.channel);
        return direction === 'credit' && (kind === 'payment' || (!kind && hasPaymentSource));
    };
    const paymentSource = (entry = {}) => String(
        entry.paymentMethod
        || entry.payment_method
        || entry.method
        || entry.channel
        || 'Cash'
    ).trim();

    const fetchJson = async (url) => {
        const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.error || `Request failed (${response.status}).`);
        }
        return payload;
    };

    const getSelectedArea = () => String(elements.areaFilter?.value || '').trim();

    const populateAreaFilter = () => {
        if (!elements.areaFilter) return;
        const current = getSelectedArea();
        const areas = Array.from(new Set(state.records.map(getArea).filter(Boolean)))
            .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
        elements.areaFilter.innerHTML = '<option value="">All areas</option>';
        areas.forEach((area) => elements.areaFilter.add(new Option(area, area)));
        elements.areaFilter.value = areas.includes(current) ? current : '';
    };

    const filteredRecords = () => {
        const area = getSelectedArea().toLowerCase();
        if (!area) return state.records;
        return state.records.filter((record) => getArea(record).toLowerCase() === area);
    };

    const isTerminalJob = (job = {}) => new Set(['completed', 'cancelled', 'done', 'closed', 'resolved'])
        .has(String(job.workflowStatus || job.status || '').trim().toLowerCase());
    const isTerminalTicket = (ticket = {}) => new Set(['resolved', 'cancelled', 'closed', 'done', 'completed'])
        .has(String(ticket.status || '').trim().toLowerCase());

    const filteredWork = (records) => {
        const area = getSelectedArea();
        const accounts = new Set(records.map(getAccountNumber).filter(Boolean));
        const jobs = state.jobs.filter((job) => {
            if (isTerminalJob(job)) return false;
            if (!area) return true;
            return accounts.has(String(job.customerAccountNumber || job.accountNumber || '').trim());
        });
        const tickets = state.tickets.filter((ticket) => {
            if (isTerminalTicket(ticket) || ticket.archivedAt || ticket.archived_at) return false;
            if (!area) return true;
            return accounts.has(String(ticket.accountNumber || '').trim());
        });
        return { jobs, tickets };
    };

    const getPaymentRows = (records) => {
        const rows = [];
        records.forEach((record) => {
            const customer = getCustomerName(record);
            const accountNumber = getAccountNumber(record);
            (Array.isArray(record.history) ? record.history : []).forEach((entry) => {
                if (!isCollectedPayment(entry)) return;
                const date = parseDate(entry.recordedAt || entry.date);
                if (!date) return;
                rows.push({
                    accountNumber,
                    customer,
                    amount: Math.abs(Number(entry.amount) || 0),
                    source: paymentSource(entry),
                    date
                });
            });
        });
        return rows.sort((left, right) => right.date - left.date);
    };

    const buildSixMonthSeries = (records) => {
        const now = new Date();
        const months = Array.from({ length: 6 }, (_, index) => {
            const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
            return {
                key: `${date.getFullYear()}-${date.getMonth()}`,
                label: monthFormatter.format(date),
                fullLabel: `${monthFormatter.format(date)} ${date.getFullYear()}`,
                billed: 0,
                collected: 0
            };
        });
        const byKey = new Map(months.map((month) => [month.key, month]));

        records.forEach((record) => {
            (Array.isArray(record.history) ? record.history : []).forEach((entry) => {
                const date = parseDate(entry.recordedAt || entry.date);
                if (!date) return;
                const month = byKey.get(`${date.getFullYear()}-${date.getMonth()}`);
                if (!month) return;
                const amount = Math.abs(Number(entry.amount) || 0);
                const direction = String(entry.direction || '').trim().toLowerCase();
                if (direction === 'debit') month.billed += amount;
                if (isCollectedPayment(entry)) month.collected += amount;
            });
        });

        return months;
    };

    const renderKpis = (records, payments, work) => {
        const activeCount = records.filter((record) => normalizeSubscriberStatus(record) === 'active').length;
        const outstandingAccounts = records.filter((record) => getEndingBalance(record) > 0.005);
        const outstandingTotal = outstandingAccounts.reduce((sum, record) => sum + getEndingBalance(record), 0);
        const today = new Date();
        const todaysPayments = payments.filter((payment) => isSameDay(payment.date, today));
        const todaysTotal = todaysPayments.reduce((sum, payment) => sum + payment.amount, 0);
        const openWorkTotal = work.jobs.length + work.tickets.length;

        elements.activeCustomers.textContent = formatCount(activeCount);
        elements.activeMeta.textContent = `${formatCount(records.length)} total account${records.length === 1 ? '' : 's'} in scope`;
        elements.outstanding.textContent = formatCurrency(outstandingTotal);
        elements.outstandingMeta.textContent = `${formatCount(outstandingAccounts.length)} account${outstandingAccounts.length === 1 ? '' : 's'} with balance`;
        elements.collectionsToday.textContent = formatCurrency(todaysTotal);
        elements.collectionsMeta.textContent = `${formatCount(todaysPayments.length)} posted payment${todaysPayments.length === 1 ? '' : 's'} today`;
        elements.openWork.textContent = formatCount(openWorkTotal);
        elements.openWorkMeta.textContent = `${formatCount(work.jobs.length)} jobs · ${formatCount(work.tickets.length)} tickets`;
    };

    const renderTrend = (records) => {
        const series = buildSixMonthSeries(records);
        const current = series[series.length - 1] || { billed: 0, collected: 0, fullLabel: '' };
        const rate = current.billed > 0 ? (current.collected / current.billed) * 100 : 0;
        elements.trendMeta.textContent = `${current.fullLabel}: ${formatCurrency(current.billed)} billed · ${formatCurrency(current.collected)} collected`;
        elements.collectionRate.textContent = `${rate.toFixed(1)}% collected`;
        elements.collectionRate.className = rate >= 95
            ? 'badge bg-green-lt text-green'
            : rate >= 80
                ? 'badge bg-orange-lt text-orange'
                : 'badge bg-red-lt text-red';

        if (state.chart) {
            state.chart.destroy();
            state.chart = null;
        }
        const hasData = series.some((month) => month.billed > 0 || month.collected > 0);
        const chartAvailable = typeof Chart !== 'undefined';
        elements.chartEmpty.textContent = chartAvailable
            ? 'No billing or collection activity yet.'
            : 'The chart library is unavailable.';
        elements.chartEmpty.hidden = hasData && chartAvailable;
        elements.chart.hidden = !hasData || !chartAvailable;
        if (!hasData || !chartAvailable) return;

        const bodyStyles = getComputedStyle(document.body);
        const textColor = bodyStyles.color || '#1d273b';
        const darkTheme = document.documentElement.getAttribute('data-bs-theme') === 'dark'
            || document.documentElement.classList.contains('theme-dark')
            || document.body.classList.contains('theme-dark');
        const gridColor = darkTheme
            ? 'rgba(255, 255, 255, .09)'
            : 'rgba(98, 105, 118, .14)';
        state.chart = new Chart(elements.chart, {
            type: 'bar',
            data: {
                labels: series.map((month) => month.label),
                datasets: [
                    {
                        label: 'Billed',
                        data: series.map((month) => month.billed),
                        backgroundColor: 'rgba(32, 107, 196, .22)',
                        borderColor: '#206bc4',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Collected',
                        data: series.map((month) => month.collected),
                        backgroundColor: 'rgba(47, 179, 68, .72)',
                        borderColor: '#2fb344',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        align: 'end',
                        labels: { color: textColor, usePointStyle: true, pointStyle: 'rectRounded' }
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => series[items[0]?.dataIndex]?.fullLabel || '',
                            label: (context) => `${context.dataset.label}: ${formatCurrency(context.raw)}`
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: textColor } },
                    y: {
                        beginAtZero: true,
                        grid: { color: gridColor },
                        ticks: { color: textColor, callback: (value) => compactCurrencyFormatter.format(Number(value) || 0) }
                    }
                }
            }
        });
    };

    const workPriority = (item) => {
        if (item.overdue) return 0;
        if (item.urgent) return 1;
        if (item.type === 'ticket') return 2;
        return 3;
    };

    const renderWork = (work) => {
        const now = Date.now();
        const jobItems = work.jobs.map((job) => {
            const due = parseDate(job.slaDueAt || job.appointmentEnd || job.schedule);
            const priority = String(job.priority || '').trim().toLowerCase();
            return {
                type: 'job',
                title: job.customerName || job.type || job.jobNumber || 'Open job',
                reference: job.jobNumber || `Job ${job.id || ''}`.trim(),
                status: String(job.workflowStatus || job.status || 'open').replace(/_/g, ' '),
                date: due || parseDate(job.createdAt),
                overdue: Boolean(due && due.getTime() < now),
                urgent: ['urgent', 'emergency'].includes(priority),
                href: 'technicians.html'
            };
        });
        const ticketItems = work.tickets.map((ticket) => ({
            type: 'ticket',
            title: ticket.customerName || ticket.subject || ticket.ticketNumber || 'Open ticket',
            reference: ticket.ticketNumber || `Ticket ${ticket.id || ''}`.trim(),
            status: String(ticket.status || 'open').replace(/_/g, ' '),
            date: parseDate(ticket.updatedAt || ticket.createdAt),
            overdue: false,
            urgent: false,
            href: 'tickets.html'
        }));
        const items = [...jobItems, ...ticketItems]
            .sort((left, right) => workPriority(left) - workPriority(right) || (right.date || 0) - (left.date || 0))
            .slice(0, 7);

        if (!items.length) {
            elements.workQueue.innerHTML = '<div class="list-group-item text-secondary">No open jobs or tickets.</div>';
            return;
        }

        elements.workQueue.innerHTML = items.map((item) => {
            const badge = item.overdue
                ? '<span class="badge bg-red-lt text-red">Overdue</span>'
                : item.urgent
                    ? '<span class="badge bg-orange-lt text-orange">Urgent</span>'
                    : item.type === 'ticket'
                        ? '<span class="badge bg-azure-lt text-azure">Ticket</span>'
                        : '<span class="badge bg-blue-lt text-blue">Job</span>';
            const dateLabel = item.date ? dateFormatter.format(item.date) : 'No schedule';
            return `
                <a class="list-group-item list-group-item-action dashboard-v2-work-item" href="${item.href}">
                    <div class="dashboard-v2-item-main">
                        <div class="dashboard-v2-item-title">${escapeHtml(item.title)}</div>
                        <div class="dashboard-v2-item-meta">${escapeHtml(item.reference)} · ${escapeHtml(item.status)} · ${escapeHtml(dateLabel)}</div>
                    </div>
                    ${badge}
                </a>`;
        }).join('');
    };

    const renderRecentPayments = (payments) => {
        const rows = payments.slice(0, 7);
        if (!rows.length) {
            elements.recentPayments.innerHTML = '<tr><td colspan="4" class="text-center text-secondary py-4">No posted payments found.</td></tr>';
            return;
        }
        elements.recentPayments.innerHTML = rows.map((payment) => `
            <tr>
                <td>
                    <div class="fw-semibold">${escapeHtml(payment.customer)}</div>
                    <div class="text-secondary small">${escapeHtml(payment.accountNumber || 'No account number')}</div>
                </td>
                <td><span class="badge bg-green-lt text-green">${escapeHtml(payment.source)}</span></td>
                <td><div>${escapeHtml(dateFormatter.format(payment.date))}</div><div class="text-secondary small">${escapeHtml(timeFormatter.format(payment.date))}</div></td>
                <td class="text-end fw-bold text-green">${escapeHtml(formatCurrency(payment.amount))}</td>
            </tr>`).join('');
    };

    const renderAttention = (records) => {
        const items = records
            .map((record) => ({
                customer: getCustomerName(record),
                accountNumber: getAccountNumber(record),
                area: getArea(record),
                balance: getEndingBalance(record)
            }))
            .filter((item) => item.balance > 0.005)
            .sort((left, right) => right.balance - left.balance)
            .slice(0, 6);

        if (!items.length) {
            elements.attentionList.innerHTML = '<div class="list-group-item text-secondary">No outstanding customer balances.</div>';
            return;
        }
        elements.attentionList.innerHTML = items.map((item) => `
            <div class="list-group-item dashboard-v2-attention-item">
                <div class="dashboard-v2-item-main">
                    <div class="dashboard-v2-item-title">${escapeHtml(item.customer)}</div>
                    <div class="dashboard-v2-item-meta">${escapeHtml(item.accountNumber || 'No account number')}${item.area ? ` · ${escapeHtml(item.area)}` : ''}</div>
                </div>
                <span class="dashboard-v2-item-amount text-red">${escapeHtml(formatCurrency(item.balance))}</span>
            </div>`).join('');
    };

    const renderDashboard = () => {
        const records = filteredRecords();
        const payments = getPaymentRows(records);
        const work = filteredWork(records);
        const area = getSelectedArea();
        elements.scopeMeta.textContent = area
            ? `${area}: essential billing and field operations in one compact view.`
            : 'Essential billing and field operations in one compact view.';
        renderKpis(records, payments, work);
        renderTrend(records);
        renderWork(work);
        renderRecentPayments(payments);
        renderAttention(records);
    };

    const setAlert = (messages = []) => {
        const normalized = messages.filter(Boolean);
        elements.alert.hidden = normalized.length === 0;
        elements.alert.textContent = normalized.join(' ');
    };

    const setRefreshBusy = (busy) => {
        if (!elements.refresh) return;
        elements.refresh.disabled = busy;
        elements.refresh.innerHTML = busy
            ? '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Loading...'
            : '<i class="ti ti-refresh" aria-hidden="true"></i> Refresh';
    };

    const loadDashboard = async () => {
        if (state.loading) return;
        state.loading = true;
        setRefreshBusy(true);
        setAlert([]);
        try {
            const results = await Promise.allSettled([
                fetchJson('/api/payment-records'),
                fetchJson('/api/jobs'),
                fetchJson('/api/tickets?includeArchived=0')
            ]);
            const errors = [];
            if (results[0].status === 'fulfilled') {
                state.records = Array.isArray(results[0].value.records) ? results[0].value.records : [];
            } else {
                state.records = [];
                errors.push(`Billing data: ${results[0].reason?.message || 'unavailable.'}`);
            }
            if (results[1].status === 'fulfilled') {
                state.jobs = Array.isArray(results[1].value.jobs) ? results[1].value.jobs : [];
            } else {
                state.jobs = [];
                errors.push(`Jobs: ${results[1].reason?.message || 'unavailable.'}`);
            }
            if (results[2].status === 'fulfilled') {
                state.tickets = Array.isArray(results[2].value.tickets) ? results[2].value.tickets : [];
            } else {
                state.tickets = [];
                errors.push(`Tickets: ${results[2].reason?.message || 'unavailable.'}`);
            }
            populateAreaFilter();
            renderDashboard();
            setAlert(errors);
            elements.updated.textContent = `Updated ${dateFormatter.format(new Date())} at ${timeFormatter.format(new Date())}`;
        } catch (error) {
            setAlert([error?.message || 'Unable to render Dashboard V2.']);
            elements.updated.textContent = 'Dashboard refresh failed.';
        } finally {
            state.loading = false;
            setRefreshBusy(false);
        }
    };

    elements.areaFilter?.addEventListener('change', renderDashboard);
    elements.refresh?.addEventListener('click', loadDashboard);
    window.addEventListener('themechange', () => renderTrend(filteredRecords()));

    loadDashboard();
});
