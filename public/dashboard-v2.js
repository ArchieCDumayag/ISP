document.addEventListener('DOMContentLoaded', () => {
    const elements = {
        activeCustomers: document.getElementById('dashboardV2ActiveCustomers'),
        activeMeta: document.getElementById('dashboardV2ActiveMeta'),
        outstanding: document.getElementById('dashboardV2Outstanding'),
        outstandingMeta: document.getElementById('dashboardV2OutstandingMeta'),
        collectionsToday: document.getElementById('dashboardV2CollectionsToday'),
        collectionsMeta: document.getElementById('dashboardV2CollectionsMeta'),
        pendingGcash: document.getElementById('dashboardV2PendingGcash'),
        pendingGcashMeta: document.getElementById('dashboardV2PendingGcashMeta'),
        collectorApprovals: document.getElementById('dashboardV2CollectorApprovals'),
        collectorApprovalsMeta: document.getElementById('dashboardV2CollectorApprovalsMeta'),
        pendingRemittance: document.getElementById('dashboardV2PendingRemittance'),
        pendingRemittanceMeta: document.getElementById('dashboardV2PendingRemittanceMeta'),
        forDisconnection: document.getElementById('dashboardV2ForDisconnection'),
        forDisconnectionMeta: document.getElementById('dashboardV2ForDisconnectionMeta'),
        openTickets: document.getElementById('dashboardV2OpenTickets'),
        openTicketsMeta: document.getElementById('dashboardV2OpenTicketsMeta'),
        jobsToday: document.getElementById('dashboardV2JobsToday'),
        jobsTodayMeta: document.getElementById('dashboardV2JobsTodayMeta'),
        areaFilter: document.getElementById('dashboardV2AreaFilter'),
        scopeMeta: document.getElementById('dashboardV2ScopeMeta'),
        refresh: document.getElementById('dashboardV2Refresh'),
        alert: document.getElementById('dashboardV2Alert'),
        actionCount: document.getElementById('dashboardV2ActionCount'),
        actionQueue: document.getElementById('dashboardV2ActionQueue'),
        gcashFreshness: document.getElementById('dashboardV2GcashFreshness'),
        gcashReminder: document.getElementById('dashboardV2GcashReminder'),
        gcashLatest: document.getElementById('dashboardV2GcashLatest'),
        gcashStatementRange: document.getElementById('dashboardV2GcashStatementRange'),
        pendingGcashList: document.getElementById('dashboardV2PendingGcashList'),
        draftCount: document.getElementById('dashboardV2DraftCount'),
        disconnectionCount: document.getElementById('dashboardV2DisconnectionCount'),
        scheduleCount: document.getElementById('dashboardV2ScheduleCount'),
        approvalCount: document.getElementById('dashboardV2ApprovalCount'),
        remittanceCount: document.getElementById('dashboardV2RemittanceCount'),
        ticketCount: document.getElementById('dashboardV2TicketCount'),
        jobCount: document.getElementById('dashboardV2JobCount'),
        todayJobCount: document.getElementById('dashboardV2TodayJobCount'),
        recentCustomers: document.getElementById('dashboardV2RecentCustomers'),
        recentPayments: document.getElementById('dashboardV2RecentPayments'),
        updated: document.getElementById('dashboardV2Updated')
    };

    const locale = 'en-PH';
    const timeZone = 'Asia/Manila';
    const currencyFormatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const countFormatter = new Intl.NumberFormat(locale);
    const dateFormatter = new Intl.DateTimeFormat(locale, {
        timeZone,
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
    const shortDateFormatter = new Intl.DateTimeFormat(locale, {
        timeZone,
        month: 'short',
        day: 'numeric'
    });
    const timeFormatter = new Intl.DateTimeFormat(locale, {
        timeZone,
        hour: 'numeric',
        minute: '2-digit'
    });
    const dateKeyFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const INEFFECTIVE_PAYMENT_STATUSES = new Set([
        'pending_gcash_verification',
        'pending-gcash-verification',
        'pending gcash verification',
        'pending_approval',
        'pending-approval',
        'pending approval',
        'rejected',
        'cancelled',
        'canceled',
        'void',
        'voided'
    ]);
    const TERMINAL_JOB_STATUSES = new Set(['completed', 'cancelled', 'done', 'closed', 'resolved', 'rejected']);
    const TERMINAL_TICKET_STATUSES = new Set(['resolved', 'cancelled', 'closed', 'done', 'completed']);

    const state = {
        customers: [],
        records: [],
        jobs: [],
        tickets: [],
        drafts: [],
        disconnections: [],
        pendingGcashPayments: [],
        gcashStatus: null,
        collectorApprovals: [],
        remittances: [],
        schedules: [],
        draftTotal: 0,
        unavailable: new Set(),
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
    const pluralize = (value, singular, plural = `${singular}s`) => (
        `${formatCount(value)} ${Number(value) === 1 ? singular : plural}`
    );
    const normalizeText = (value) => String(value || '').trim();
    const normalizeLower = (value) => normalizeText(value).toLowerCase();
    const parseDate = (value) => {
        if (!value) return null;
        const parsed = value instanceof Date ? value : new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const toManilaDateKey = (value) => {
        const date = parseDate(value);
        if (!date) return '';
        const parts = dateKeyFormatter.formatToParts(date);
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        return values.year && values.month && values.day
            ? `${values.year}-${values.month}-${values.day}`
            : '';
    };
    const normalizeDateKey = (value) => {
        const raw = normalizeText(value);
        const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : toManilaDateKey(raw);
    };
    const todayKey = () => toManilaDateKey(new Date());
    const isToday = (value) => normalizeDateKey(value) === todayKey();
    const formatDateTime = (value) => {
        const date = parseDate(value);
        return date ? `${dateFormatter.format(date)} at ${timeFormatter.format(date)}` : 'Date unavailable';
    };
    const formatDateOnly = (value) => {
        const date = parseDate(value);
        return date ? dateFormatter.format(date) : 'Date unavailable';
    };
    const formatWaitingAge = (value) => {
        const date = parseDate(value);
        if (!date) return 'Age unavailable';
        const difference = Date.now() - date.getTime();
        if (difference < 0) return `Due ${shortDateFormatter.format(date)}`;
        const hours = Math.floor(difference / 3600000);
        if (hours < 1) return 'Just now';
        if (hours < 24) return `${hours}h waiting`;
        const days = Math.floor(hours / 24);
        return `${days}d waiting`;
    };
    const formatDueLabel = (value) => {
        const key = normalizeDateKey(value);
        if (!key) return 'No schedule';
        if (key < todayKey()) return `Overdue · ${formatDateOnly(value)}`;
        if (key === todayKey()) return 'Due today';
        return `Due ${formatDateOnly(value)}`;
    };

    const getAccountNumber = (record = {}) => normalizeText(
        record.accountNumber
        || record.account_number
        || record.customerAccountNumber
        || record.draftAccountNumber
        || record.approvedCustomerAccountNumber
    );
    const getCustomerName = (record = {}) => {
        const fullName = `${record.firstName || record.first_name || ''} ${record.lastName || record.last_name || ''}`.trim();
        return normalizeText(
            record.customerName
            || record.name
            || fullName
            || record.payer
        ) || `Account ${getAccountNumber(record) || '-'}`;
    };
    const getArea = (record = {}) => normalizeText(
        record.area
        || record.areaName
        || record.area_name
        || record.customerArea
        || record.coverageArea
        || record.cluster
        || record.zone
        || record.serviceArea
        || record.draftData?.area
    );
    const normalizeSubscriberStatus = (record = {}) => {
        if (normalizeLower(record.disconnection?.status) === 'disconnected') return 'disconnected';
        const raw = normalizeLower(record.subscriberStatus || record.customerStatus || record.status);
        if (raw === 'force-active') return 'active';
        if (raw === 'force-inactive') return 'inactive';
        return raw || 'active';
    };
    const getEndingBalance = (record = {}) => {
        const value = Number(record.billingSummary?.endingBalance ?? record.endingBalance ?? record.balance);
        return Number.isFinite(value) ? value : 0;
    };
    const getCustomerCreatedAt = (record = {}) => parseDate(
        record.createdAt
        || record.created_at
        || record.activationDate
        || record.activation_date
        || record.installationDate
    );
    const getJobSchedule = (job = {}) => parseDate(
        job.schedule
        || job.appointmentStart
        || job.appointmentEnd
        || job.slaDueAt
    );
    const isTerminalJob = (job = {}) => TERMINAL_JOB_STATUSES.has(
        normalizeLower(job.workflowStatus || job.status)
    );
    const isTerminalTicket = (ticket = {}) => TERMINAL_TICKET_STATUSES.has(normalizeLower(ticket.status));
    const isEffectivePaymentEntryStatus = (entry = {}) => !INEFFECTIVE_PAYMENT_STATUSES.has(
        normalizeLower(entry.status || entry.paymentStatus || entry.payment_status)
    );
    const isCollectedPayment = (entry = {}) => {
        if (!isEffectivePaymentEntryStatus(entry)) return false;
        const direction = normalizeLower(entry.direction || entry.nature);
        const kind = normalizeLower(entry.kind || entry.type);
        const hasPaymentSource = Boolean(entry.paymentMethod || entry.payment_method || entry.method || entry.channel);
        return direction === 'credit' && (kind === 'payment' || (!kind && hasPaymentSource));
    };
    const normalizePaymentMethod = (entry = {}) => {
        const raw = normalizeText(
            entry.paymentMethod
            || entry.payment_method
            || entry.method
            || entry.channel
        );
        const lower = raw.toLowerCase();
        if (lower.includes('gcash') || lower.includes('g-cash')) return 'GCash';
        if (!lower || lower === 'cash' || lower.includes('cash payment') || lower.includes('cash collection')) return 'Cash';
        return raw;
    };

    const fetchJson = async (url) => {
        const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.error || `Request failed (${response.status}).`);
        }
        return payload;
    };

    const getSelectedArea = () => normalizeText(elements.areaFilter?.value);
    const buildAreaScope = () => {
        const selected = getSelectedArea().toLowerCase();
        const accounts = new Set();
        if (selected) {
            [...state.records, ...state.customers].forEach((record) => {
                if (getArea(record).toLowerCase() !== selected) return;
                const accountNumber = getAccountNumber(record);
                if (accountNumber) accounts.add(accountNumber);
            });
        }
        return { selected, accounts };
    };
    const rowMatchesSelectedArea = (row = {}, scope = buildAreaScope()) => {
        const { selected, accounts } = scope;
        if (!selected) return true;
        const rowArea = getArea(row).toLowerCase();
        if (rowArea) return rowArea === selected;
        const accountNumber = getAccountNumber(row);
        return Boolean(accountNumber && accounts.has(accountNumber));
    };
    const filterForSelectedArea = (rows = [], scope = buildAreaScope()) => (
        (Array.isArray(rows) ? rows : []).filter((row) => rowMatchesSelectedArea(row, scope))
    );
    const populateAreaFilter = () => {
        if (!elements.areaFilter) return;
        const current = getSelectedArea();
        const sources = [
            ...state.records,
            ...state.customers,
            ...state.drafts,
            ...state.disconnections,
            ...state.collectorApprovals,
            ...state.schedules
        ];
        const areas = Array.from(new Set(sources.map(getArea).filter(Boolean)))
            .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
        elements.areaFilter.innerHTML = '<option value="">All areas</option>';
        areas.forEach((area) => elements.areaFilter.add(new Option(area, area)));
        elements.areaFilter.value = areas.includes(current) ? current : '';
    };

    const getPaymentRows = (records = []) => {
        const rows = [];
        records.forEach((record) => {
            const customer = getCustomerName(record);
            const accountNumber = getAccountNumber(record);
            (Array.isArray(record.history) ? record.history : []).forEach((entry) => {
                if (!isCollectedPayment(entry)) return;
                const source = normalizePaymentMethod(entry);
                if (!['Cash', 'GCash'].includes(source)) return;
                const postedAt = parseDate(entry.recordedAt || entry.recorded_at || entry.date);
                const paymentDate = parseDate(
                    entry.paymentReceivedAt
                    || entry.gcashReceivedAt
                    || entry.date
                    || entry.recordedAt
                );
                if (!postedAt && !paymentDate) return;
                const amount = Math.abs(Number(entry.amount) || 0);
                if (amount <= 0) return;
                rows.push({
                    accountNumber,
                    customer,
                    amount,
                    source,
                    reference: normalizeText(entry.reference || entry.orNumber || entry.or_number),
                    date: paymentDate || postedAt,
                    postedAt: postedAt || paymentDate
                });
            });
        });
        return rows.sort((left, right) => right.postedAt - left.postedAt);
    };

    const normalizePendingGcashRows = (rows = []) => rows.map((payment) => ({
        ...payment,
        customerName: getCustomerName(payment),
        sortDate: parseDate(payment.recordedAt || payment.paymentDate),
        paymentDateKey: normalizeDateKey(payment.paymentDate || payment.recordedAt)
    })).sort((left, right) => (right.sortDate || 0) - (left.sortDate || 0));

    const getScopedDashboardData = () => {
        const areaScope = buildAreaScope();
        const records = filterForSelectedArea(state.records, areaScope);
        const customers = filterForSelectedArea(state.customers, areaScope);
        const jobs = filterForSelectedArea(state.jobs, areaScope).filter((job) => !isTerminalJob(job));
        const tickets = filterForSelectedArea(state.tickets, areaScope).filter((ticket) => (
            !isTerminalTicket(ticket) && !ticket.archivedAt && !ticket.archived_at
        ));
        const drafts = filterForSelectedArea(state.drafts, areaScope).filter((draft) => normalizeLower(draft.rawStatus || draft.status) === 'pending');
        const disconnections = filterForSelectedArea(state.disconnections, areaScope).filter((item) => normalizeLower(item.status) === 'pending');
        const pendingGcash = normalizePendingGcashRows(
            filterForSelectedArea(state.pendingGcashPayments, areaScope)
        );
        const approvals = filterForSelectedArea(state.collectorApprovals, areaScope);
        const schedules = filterForSelectedArea(state.schedules, areaScope);
        const remittances = state.remittances.filter((record) => (
            normalizeLower(record.status || 'pending') === 'pending'
            && !record.archivedAt
            && !record.deletedAt
        ));
        const payments = getPaymentRows(records);
        return {
            records,
            customers,
            jobs,
            tickets,
            drafts,
            disconnections,
            pendingGcash,
            approvals,
            schedules,
            remittances,
            payments
        };
    };

    const setCount = (element, value, unavailable = false, atLeast = false) => {
        if (element) element.textContent = unavailable
            ? '—'
            : `${formatCount(value)}${atLeast ? '+' : ''}`;
    };
    const sourceUnavailable = (...keys) => keys.some((key) => state.unavailable.has(key));
    const isRemittanceReady = (record = {}) => {
        const summary = record.paymentSummary || {};
        return Number(summary.pending) === 0 && Number(summary.approved) > 0;
    };

    const renderSummary = (data) => {
        const recordsUnavailable = sourceUnavailable('records');
        const gcashUnavailable = sourceUnavailable('pendingGcashPayments');
        const approvalsUnavailable = sourceUnavailable('collectorApprovals');
        const remittanceUnavailable = sourceUnavailable('remittances');
        const disconnectionUnavailable = sourceUnavailable('disconnections');
        const ticketsUnavailable = sourceUnavailable('tickets');
        const jobsUnavailable = sourceUnavailable('jobs');

        const activeCount = data.records.filter((record) => normalizeSubscriberStatus(record) === 'active').length;
        const outstandingAccounts = data.records.filter((record) => getEndingBalance(record) > .005);
        const outstandingTotal = outstandingAccounts.reduce((sum, record) => sum + getEndingBalance(record), 0);
        const todaysPayments = data.payments.filter((payment) => isToday(payment.postedAt));
        const todaysTotal = todaysPayments.reduce((sum, payment) => sum + payment.amount, 0);
        const cashTotal = todaysPayments
            .filter((payment) => payment.source === 'Cash')
            .reduce((sum, payment) => sum + payment.amount, 0);
        const gcashTotal = todaysPayments
            .filter((payment) => payment.source === 'GCash')
            .reduce((sum, payment) => sum + payment.amount, 0);
        const approvalAmount = data.approvals.reduce((sum, item) => sum + Math.abs(Number(item.amount) || 0), 0);
        const approvalsMayBeCapped = state.collectorApprovals.length >= 200;
        const remittanceAmount = data.remittances.reduce((sum, item) => (
            sum + Math.max(Number(item.totalAmount ?? item.paymentSummary?.totalAmount) || 0, 0)
        ), 0);
        const readyRemittances = data.remittances.filter(isRemittanceReady).length;
        const overAmount = data.disconnections.reduce((sum, item) => sum + Math.max(Number(item.overAmount) || 0, 0), 0);
        const jobsToday = data.jobs.filter((job) => isToday(getJobSchedule(job))).length;

        setCount(elements.activeCustomers, activeCount, recordsUnavailable);
        elements.activeMeta.textContent = recordsUnavailable
            ? 'Billing account data unavailable'
            : `${pluralize(data.records.length, 'account')} in scope`;
        elements.outstanding.textContent = recordsUnavailable ? '—' : formatCurrency(outstandingTotal);
        elements.outstandingMeta.textContent = recordsUnavailable
            ? 'Balance data unavailable'
            : `${pluralize(outstandingAccounts.length, 'account')} with balance`;
        elements.collectionsToday.textContent = recordsUnavailable ? '—' : formatCurrency(todaysTotal);
        elements.collectionsMeta.textContent = recordsUnavailable
            ? 'Payment data unavailable'
            : `Cash ${formatCurrency(cashTotal)} · GCash ${formatCurrency(gcashTotal)} · ${pluralize(todaysPayments.length, 'payment')}`;

        setCount(elements.pendingGcash, data.pendingGcash.length, gcashUnavailable);
        elements.pendingGcashMeta.textContent = gcashUnavailable
            ? 'Pending GCash data unavailable'
            : `${pluralize(data.pendingGcash.length, 'manual payment')} waiting for official proof`;
        setCount(elements.collectorApprovals, data.approvals.length, approvalsUnavailable, approvalsMayBeCapped);
        elements.collectorApprovalsMeta.textContent = approvalsUnavailable
            ? 'Collector approval data unavailable'
            : `${approvalsMayBeCapped ? 'At least ' : ''}${formatCurrency(approvalAmount)} awaiting Admin review${approvalsMayBeCapped ? ' in the first 200 submissions' : ''}`;
        setCount(elements.pendingRemittance, data.remittances.length, remittanceUnavailable);
        elements.pendingRemittanceMeta.textContent = remittanceUnavailable
            ? 'Remittance data unavailable'
            : `${formatCount(readyRemittances)} ready · ${formatCurrency(remittanceAmount)} · Branch-wide`;
        setCount(elements.forDisconnection, data.disconnections.length, disconnectionUnavailable);
        elements.forDisconnectionMeta.textContent = disconnectionUnavailable
            ? 'Disconnection queue unavailable'
            : `${formatCurrency(overAmount)} above credit limits`;
        setCount(elements.openTickets, data.tickets.length, ticketsUnavailable);
        elements.openTicketsMeta.textContent = ticketsUnavailable
            ? 'Ticket data unavailable'
            : `${pluralize(data.tickets.length, 'support item')} still open`;
        setCount(elements.jobsToday, jobsToday, jobsUnavailable);
        elements.jobsTodayMeta.textContent = jobsUnavailable
            ? 'Job data unavailable'
            : `${pluralize(data.jobs.length, 'open job')} in scope`;
    };

    const getActionSortTime = (item = {}) => item.date instanceof Date
        ? item.date.getTime()
        : Number.MAX_SAFE_INTEGER;
    const buildActionItems = (data) => {
        const items = [];
        data.pendingGcash.forEach((payment) => items.push({
            priority: 0,
            type: 'GCash',
            badgeClass: 'bg-azure-lt text-azure',
            avatarClass: 'bg-azure-lt text-azure',
            icon: 'ti-device-mobile-dollar',
            title: payment.customerName,
            meta: `${getAccountNumber(payment) || 'No account'} · ${payment.enteredReference || 'No reference'} · ${formatCurrency(payment.amount)}`,
            date: payment.sortDate,
            age: formatWaitingAge(payment.sortDate),
            href: 'gcash-transaction.html'
        }));
        data.disconnections.forEach((item) => {
            const date = parseDate(item.hitCreditLimitAt || item.updatedAt || item.decidedAt);
            items.push({
                priority: 0,
                type: 'Disconnect',
                badgeClass: 'bg-red-lt text-red',
                avatarClass: 'bg-red-lt text-red',
                icon: 'ti-plug-off',
                title: getCustomerName(item),
                meta: `${getAccountNumber(item) || 'No account'} · ${formatCurrency(item.overAmount)} above limit`,
                date,
                age: formatWaitingAge(date),
                href: 'disconnections.html'
            });
        });
        data.approvals.forEach((item) => {
            const date = parseDate(item.recordedAt || item.date);
            items.push({
                priority: 1,
                type: 'Approve',
                badgeClass: 'bg-yellow-lt text-yellow',
                avatarClass: 'bg-yellow-lt text-yellow',
                icon: 'ti-user-check',
                title: getCustomerName(item),
                meta: `${item.collectorName || 'Collector'} · ${formatCurrency(item.amount)} · ${item.paymentMethod || 'Cash'}`,
                date,
                age: formatWaitingAge(date),
                href: 'collectors.html'
            });
        });
        data.remittances.forEach((item) => {
            const date = parseDate(item.submittedAt || item.updatedAt || item.collectionDate);
            const ready = isRemittanceReady(item);
            items.push({
                priority: ready ? 1 : 2,
                type: ready ? 'Remit' : 'Pending',
                badgeClass: ready ? 'bg-orange-lt text-orange' : 'bg-yellow-lt text-yellow',
                avatarClass: ready ? 'bg-orange-lt text-orange' : 'bg-yellow-lt text-yellow',
                icon: 'ti-cash-banknote',
                title: item.collectorName || 'Collector remittance',
                meta: `Branch-wide · ${formatCurrency(item.totalAmount ?? item.paymentSummary?.totalAmount)} · ${ready ? 'Ready to remit' : `${pluralize(item.paymentSummary?.pending || 0, 'payment')} awaiting approval`}`,
                date,
                age: formatWaitingAge(date),
                href: 'collectors.html'
            });
        });
        data.drafts.forEach((draft) => {
            const date = parseDate(draft.submittedAt);
            items.push({
                priority: 2,
                type: 'Draft',
                badgeClass: 'bg-blue-lt text-blue',
                avatarClass: 'bg-blue-lt text-blue',
                icon: 'ti-user-plus',
                title: getCustomerName(draft),
                meta: `${draft.areaName || 'No area'} · ${draft.planName || 'No plan'} · ${draft.submittedBy?.name || 'Technician intake'}`,
                date,
                age: formatWaitingAge(date),
                href: 'customer-draft-queue.html'
            });
        });
        data.schedules.forEach((schedule) => {
            const date = parseDate(schedule.rescheduledDate || schedule.createdAt);
            const scheduleKey = normalizeDateKey(schedule.rescheduledDate);
            items.push({
                priority: scheduleKey && scheduleKey < todayKey() ? 0 : (scheduleKey === todayKey() ? 2 : 4),
                type: scheduleKey && scheduleKey < todayKey() ? 'Overdue' : 'Schedule',
                badgeClass: scheduleKey && scheduleKey < todayKey()
                    ? 'bg-red-lt text-red'
                    : 'bg-blue-lt text-blue',
                avatarClass: scheduleKey && scheduleKey < todayKey()
                    ? 'bg-red-lt text-red'
                    : 'bg-blue-lt text-blue',
                icon: 'ti-calendar-event',
                title: getCustomerName(schedule),
                meta: `${schedule.collectorName || 'Collector'} · ${schedule.result || 'Follow-up'}`,
                date,
                age: formatDueLabel(schedule.rescheduledDate),
                href: 'collectors.html'
            });
        });
        data.jobs.forEach((job) => {
            const date = getJobSchedule(job);
            const scheduleKey = normalizeDateKey(date);
            const urgent = ['urgent', 'emergency'].includes(normalizeLower(job.priority));
            const overdue = Boolean(scheduleKey && scheduleKey < todayKey());
            items.push({
                priority: overdue ? 0 : (urgent || scheduleKey === todayKey() ? 2 : 4),
                type: overdue ? 'Overdue job' : (urgent ? 'Urgent job' : 'Job'),
                badgeClass: overdue
                    ? 'bg-red-lt text-red'
                    : (urgent ? 'bg-orange-lt text-orange' : 'bg-purple-lt text-purple'),
                avatarClass: overdue
                    ? 'bg-red-lt text-red'
                    : (urgent ? 'bg-orange-lt text-orange' : 'bg-purple-lt text-purple'),
                icon: 'ti-tool',
                title: job.customerName || job.type || job.jobNumber || 'Open job',
                meta: `${job.jobNumber || 'Job'} · ${normalizeText(job.workflowStatus || job.status).replace(/_/g, ' ') || 'open'}`,
                date,
                age: formatDueLabel(date),
                href: 'technicians.html'
            });
        });
        data.tickets.forEach((ticket) => {
            const date = parseDate(ticket.updatedAt || ticket.createdAt);
            const escalated = normalizeLower(ticket.status) === 'escalated';
            items.push({
                priority: escalated ? 1 : 5,
                type: escalated ? 'Escalated' : 'Ticket',
                badgeClass: escalated ? 'bg-red-lt text-red' : 'bg-purple-lt text-purple',
                avatarClass: escalated ? 'bg-red-lt text-red' : 'bg-purple-lt text-purple',
                icon: 'ti-ticket',
                title: ticket.customerName || ticket.subject || ticket.ticketNumber || 'Open ticket',
                meta: `${ticket.ticketNumber || 'Ticket'} · ${normalizeText(ticket.status).replace(/-/g, ' ') || 'open'}`,
                date,
                age: formatWaitingAge(date),
                href: 'tickets.html'
            });
        });
        return items.sort((left, right) => (
            left.priority - right.priority
            || getActionSortTime(left) - getActionSortTime(right)
            || left.title.localeCompare(right.title)
        ));
    };

    const renderActions = (data) => {
        const items = buildActionItems(data);
        const actionSources = [
            'pendingGcashPayments',
            'disconnections',
            'collectorApprovals',
            'remittances',
            'drafts',
            'schedules',
            'jobs',
            'tickets'
        ];
        const partial = sourceUnavailable(...actionSources);
        const mayBeCapped = state.draftTotal > state.drafts.length
            || state.collectorApprovals.length >= 200;
        elements.actionCount.textContent = partial || mayBeCapped
            ? `Partial · ${formatCount(items.length)}${mayBeCapped ? '+' : ''}`
            : `${formatCount(items.length)} pending`;
        elements.actionCount.className = partial
            ? 'badge bg-yellow-lt text-yellow'
            : (items.length ? 'badge bg-red-lt text-red' : 'badge bg-green-lt text-green');

        if (!items.length) {
            elements.actionQueue.innerHTML = partial
                ? '<div class="list-group-item text-secondary">Some action queues are unavailable. Refresh to try again.</div>'
                : '<div class="list-group-item text-secondary">No pending operational actions.</div>';
            return;
        }
        elements.actionQueue.innerHTML = items.slice(0, 12).map((item) => `
            <a class="list-group-item list-group-item-action dashboard-v2-action-item" href="${escapeHtml(item.href)}">
                <span class="avatar ${escapeHtml(item.avatarClass)}"><i class="ti ${escapeHtml(item.icon)}" aria-hidden="true"></i></span>
                <div class="dashboard-v2-item-main">
                    <div class="dashboard-v2-item-title">${escapeHtml(item.title)}</div>
                    <div class="dashboard-v2-item-meta">${escapeHtml(item.meta)}</div>
                </div>
                <div class="dashboard-v2-item-side">
                    <span class="badge ${escapeHtml(item.badgeClass)}">${escapeHtml(item.type)}</span>
                    <small>${escapeHtml(item.age)}</small>
                </div>
            </a>`).join('');
    };

    const renderPendingGcash = (pendingGcash) => {
        if (sourceUnavailable('pendingGcashPayments')) {
            elements.pendingGcashList.innerHTML = '<div class="list-group-item text-secondary">Pending GCash data is unavailable.</div>';
            return;
        }
        if (!pendingGcash.length) {
            elements.pendingGcashList.innerHTML = '<div class="list-group-item text-secondary">No manual GCash payments are waiting for proof.</div>';
            return;
        }
        elements.pendingGcashList.innerHTML = pendingGcash.slice(0, 5).map((payment) => `
            <a class="list-group-item list-group-item-action dashboard-v2-gcash-item" href="gcash-transaction.html">
                <div class="dashboard-v2-item-main">
                    <div class="dashboard-v2-item-title">${escapeHtml(payment.customerName)}</div>
                    <div class="dashboard-v2-item-meta">${escapeHtml(payment.enteredReference || 'No reference')} · ${escapeHtml(formatCurrency(payment.amount))} · ${escapeHtml(formatWaitingAge(payment.sortDate))}</div>
                </div>
                <span class="badge bg-azure-lt text-azure">Pending</span>
            </a>`).join('');
    };

    const renderGcashPdfStatus = (pendingGcash) => {
        if (sourceUnavailable('gcashStatus')) {
            elements.gcashFreshness.textContent = 'PDF status unavailable';
            elements.gcashFreshness.className = 'badge bg-yellow-lt text-yellow';
            elements.gcashReminder.className = 'dashboard-v2-gcash-reminder is-warning';
            elements.gcashReminder.innerHTML = `
                <span class="avatar bg-yellow-lt text-yellow"><i class="ti ti-alert-triangle" aria-hidden="true"></i></span>
                <div><strong>Unable to check the latest PDF</strong><p class="mb-0 text-secondary">Open GCash Transactions before approving pending payments.</p></div>`;
            elements.gcashLatest.textContent = 'Unavailable';
            elements.gcashStatementRange.textContent = 'Unavailable';
            return;
        }

        const latest = state.gcashStatus?.latestBatch || null;
        if (!latest) {
            elements.gcashFreshness.textContent = 'Upload required';
            elements.gcashFreshness.className = 'badge bg-red-lt text-red';
            elements.gcashReminder.className = 'dashboard-v2-gcash-reminder is-danger';
            elements.gcashReminder.innerHTML = `
                <span class="avatar bg-red-lt text-red"><i class="ti ti-file-alert" aria-hidden="true"></i></span>
                <div><strong>Upload the latest official GCash PDF</strong><p class="mb-0 text-secondary">No statement import is recorded for this branch.</p></div>`;
            elements.gcashLatest.textContent = 'No PDF imported';
            elements.gcashStatementRange.textContent = 'No statement coverage';
            return;
        }

        const latestPendingDateKey = pendingGcash.reduce((latestKey, payment) => (
            payment.paymentDateKey > latestKey ? payment.paymentDateKey : latestKey
        ), '');
        const statementToKey = normalizeDateKey(latest.statementTo);
        const statementBehind = Boolean(latestPendingDateKey && (!statementToKey || statementToKey < latestPendingDateKey));
        const importedAt = parseDate(latest.importedAt);
        const metadataIncomplete = !statementToKey || !importedAt;
        const uploadAgeDays = importedAt
            ? Math.floor(Math.max(Date.now() - importedAt.getTime(), 0) / 86400000)
            : null;
        const oldUpload = uploadAgeDays != null && uploadAgeDays > 7;
        const pendingUnavailable = sourceUnavailable('pendingGcashPayments');

        let badgeText = 'Current';
        let badgeClass = 'badge bg-green-lt text-green';
        let reminderClass = 'dashboard-v2-gcash-reminder is-current';
        let title = pendingGcash.length
            ? 'Official PDF covers the pending queue'
            : 'Latest official PDF is available';
        let detail = pendingGcash.length
            ? `Statement coverage reaches every pending payment date in this view.`
            : 'Upload a newer PDF when new GCash payments arrive.';

        if (statementBehind) {
            badgeText = 'PDF behind';
            badgeClass = 'badge bg-red-lt text-red';
            reminderClass = 'dashboard-v2-gcash-reminder is-danger';
            title = 'Upload a newer official GCash PDF';
            detail = `The statement ends ${formatDateOnly(latest.statementTo)}, before the newest pending payment (${formatDateOnly(latestPendingDateKey)}).`;
        } else if (pendingUnavailable) {
            badgeText = 'Partial check';
            badgeClass = 'badge bg-yellow-lt text-yellow';
            reminderClass = 'dashboard-v2-gcash-reminder is-warning';
            title = 'Confirm PDF coverage in GCash Transactions';
            detail = 'The PDF was found, but the pending-payment list is unavailable.';
        } else if (metadataIncomplete) {
            badgeText = 'Review PDF';
            badgeClass = 'badge bg-yellow-lt text-yellow';
            reminderClass = 'dashboard-v2-gcash-reminder is-warning';
            title = 'Confirm the latest official GCash PDF';
            detail = !statementToKey
                ? 'The latest import has no statement coverage date.'
                : 'The latest import has no reliable upload timestamp.';
        } else if (oldUpload) {
            badgeText = 'Review latest PDF';
            badgeClass = 'badge bg-yellow-lt text-yellow';
            reminderClass = 'dashboard-v2-gcash-reminder is-warning';
            title = 'Confirm this is still the latest PDF';
            detail = `The last recorded upload was ${uploadAgeDays} days ago.`;
        }

        elements.gcashFreshness.textContent = badgeText;
        elements.gcashFreshness.className = badgeClass;
        elements.gcashReminder.className = reminderClass;
        elements.gcashReminder.innerHTML = `
            <span class="avatar ${statementBehind ? 'bg-red-lt text-red' : (oldUpload || pendingUnavailable || metadataIncomplete ? 'bg-yellow-lt text-yellow' : 'bg-green-lt text-green')}"><i class="ti ti-file-type-pdf" aria-hidden="true"></i></span>
            <div><strong>${escapeHtml(title)}</strong><p class="mb-0 text-secondary">${escapeHtml(detail)}</p></div>`;
        elements.gcashLatest.textContent = `${latest.fileName || 'GCash statement'} · ${formatDateTime(latest.importedAt)}`;
        elements.gcashStatementRange.textContent = latest.statementFrom && latest.statementTo
            ? `${formatDateOnly(latest.statementFrom)} – ${formatDateOnly(latest.statementTo)}`
            : (latest.statementTo ? `Through ${formatDateOnly(latest.statementTo)}` : 'Coverage date unavailable');
    };

    const renderWorkflowCounts = (data) => {
        const draftPageCapped = state.draftTotal > state.drafts.length;
        const scopedDraftCount = getSelectedArea() ? data.drafts.length : state.draftTotal;
        setCount(
            elements.draftCount,
            scopedDraftCount,
            sourceUnavailable('drafts'),
            Boolean(getSelectedArea() && draftPageCapped)
        );
        setCount(elements.disconnectionCount, data.disconnections.length, sourceUnavailable('disconnections'));
        setCount(elements.scheduleCount, data.schedules.length, sourceUnavailable('schedules'));
        setCount(
            elements.approvalCount,
            data.approvals.length,
            sourceUnavailable('collectorApprovals'),
            state.collectorApprovals.length >= 200
        );
        setCount(elements.remittanceCount, data.remittances.length, sourceUnavailable('remittances'));
        setCount(elements.ticketCount, data.tickets.length, sourceUnavailable('tickets'));
        setCount(elements.jobCount, data.jobs.length, sourceUnavailable('jobs'));
        setCount(elements.todayJobCount, data.jobs.filter((job) => isToday(getJobSchedule(job))).length, sourceUnavailable('jobs'));
    };

    const customerStatusBadge = (customer) => {
        const status = normalizeSubscriberStatus(customer);
        if (status === 'active') return { label: 'Active', className: 'bg-green-lt text-green' };
        if (status === 'disconnected') return { label: 'Disconnected', className: 'bg-red-lt text-red' };
        if (['inactive', 'disabled'].includes(status)) return { label: 'Inactive', className: 'bg-secondary-lt text-secondary' };
        return { label: status.replace(/[-_]/g, ' ') || 'Customer', className: 'bg-blue-lt text-blue' };
    };

    const renderRecentCustomers = (customers) => {
        if (sourceUnavailable('customers')) {
            elements.recentCustomers.innerHTML = '<div class="list-group-item text-secondary">Customer history is unavailable.</div>';
            return;
        }
        const rows = customers.map((customer) => ({
            customer,
            createdAt: getCustomerCreatedAt(customer)
        })).sort((left, right) => (
            (right.createdAt?.getTime() || 0) - (left.createdAt?.getTime() || 0)
            || getAccountNumber(right.customer).localeCompare(getAccountNumber(left.customer))
        )).slice(0, 5);
        if (!rows.length) {
            elements.recentCustomers.innerHTML = '<div class="list-group-item text-secondary">No customer records found.</div>';
            return;
        }
        elements.recentCustomers.innerHTML = rows.map(({ customer, createdAt }) => {
            const accountNumber = getAccountNumber(customer);
            const badge = customerStatusBadge(customer);
            const href = accountNumber
                ? `customers.html?account=${encodeURIComponent(accountNumber)}&mode=view`
                : 'customers.html';
            return `
                <a class="list-group-item list-group-item-action dashboard-v2-customer-item" href="${escapeHtml(href)}">
                    <span class="avatar bg-blue-lt text-blue"><i class="ti ti-user" aria-hidden="true"></i></span>
                    <div class="dashboard-v2-item-main">
                        <div class="dashboard-v2-item-title">${escapeHtml(getCustomerName(customer))}</div>
                        <div class="dashboard-v2-item-meta">${escapeHtml(accountNumber || 'No account')}${getArea(customer) ? ` · ${escapeHtml(getArea(customer))}` : ''} · ${escapeHtml(createdAt ? formatDateOnly(createdAt) : 'Date unavailable')}</div>
                    </div>
                    <span class="badge dashboard-v2-customer-status ${escapeHtml(badge.className)}">${escapeHtml(badge.label)}</span>
                </a>`;
        }).join('');
    };

    const renderRecentPayments = (payments) => {
        if (sourceUnavailable('records')) {
            elements.recentPayments.innerHTML = '<tr><td colspan="5" class="text-center text-secondary py-4">Payment history is unavailable.</td></tr>';
            return;
        }
        const rows = payments.slice(0, 10);
        if (!rows.length) {
            elements.recentPayments.innerHTML = '<tr><td colspan="5" class="text-center text-secondary py-4">No effective Cash or GCash payments found.</td></tr>';
            return;
        }
        elements.recentPayments.innerHTML = rows.map((payment) => {
            const methodClass = payment.source === 'GCash'
                ? 'bg-azure-lt text-azure'
                : 'bg-green-lt text-green';
            return `
                <tr>
                    <td>
                        <div class="fw-semibold">${escapeHtml(payment.customer)}</div>
                        <div class="text-secondary small">${escapeHtml(payment.accountNumber || 'No account number')}</div>
                    </td>
                    <td><span class="badge ${methodClass}">${escapeHtml(payment.source)}</span></td>
                    <td><span class="dashboard-v2-reference" title="${escapeHtml(payment.reference || 'No reference')}">${escapeHtml(payment.reference || '—')}</span></td>
                    <td><div>${escapeHtml(dateFormatter.format(payment.date))}</div><div class="text-secondary small">${escapeHtml(timeFormatter.format(payment.date))}</div></td>
                    <td class="text-end fw-bold text-green">${escapeHtml(formatCurrency(payment.amount))}</td>
                </tr>`;
        }).join('');
    };

    const renderDashboard = () => {
        const data = getScopedDashboardData();
        const area = getSelectedArea();
        elements.scopeMeta.textContent = area
            ? `${area}: action queues, collections, customers, and field work. PDF and remittance status remain branch-wide.`
            : 'Action queues, collections, customers, and field work in one view.';
        renderSummary(data);
        renderActions(data);
        renderPendingGcash(data.pendingGcash);
        renderGcashPdfStatus(normalizePendingGcashRows(state.pendingGcashPayments));
        renderWorkflowCounts(data);
        renderRecentCustomers(data.customers);
        renderRecentPayments(data.payments);
    };

    const setAlert = (errors = []) => {
        const normalized = errors.filter(Boolean);
        elements.alert.hidden = normalized.length === 0;
        elements.alert.textContent = normalized.length
            ? `Some dashboard sections could not load. ${normalized.join(' ')}`
            : '';
    };
    const setRefreshBusy = (busy) => {
        if (!elements.refresh) return;
        elements.refresh.disabled = busy;
        elements.refresh.innerHTML = busy
            ? '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Loading...'
            : '<i class="ti ti-refresh" aria-hidden="true"></i> Refresh';
    };
    const resetStateData = () => {
        state.customers = [];
        state.records = [];
        state.jobs = [];
        state.tickets = [];
        state.drafts = [];
        state.disconnections = [];
        state.pendingGcashPayments = [];
        state.gcashStatus = null;
        state.collectorApprovals = [];
        state.remittances = [];
        state.schedules = [];
        state.draftTotal = 0;
        state.unavailable = new Set();
    };

    const loadDashboard = async () => {
        if (state.loading) return;
        state.loading = true;
        setRefreshBusy(true);
        setAlert([]);
        resetStateData();

        const sources = [
            {
                key: 'customers',
                label: 'Customers',
                request: fetchJson('/api/customers'),
                apply: (payload) => { state.customers = Array.isArray(payload.customers) ? payload.customers : []; }
            },
            {
                key: 'records',
                label: 'Billing',
                request: fetchJson('/api/payment-records'),
                apply: (payload) => { state.records = Array.isArray(payload.records) ? payload.records : []; }
            },
            {
                key: 'jobs',
                label: 'Jobs',
                request: fetchJson('/api/jobs'),
                apply: (payload) => { state.jobs = Array.isArray(payload.jobs) ? payload.jobs : []; }
            },
            {
                key: 'tickets',
                label: 'Tickets',
                request: fetchJson('/api/tickets?includeArchived=0'),
                apply: (payload) => { state.tickets = Array.isArray(payload.tickets) ? payload.tickets : []; }
            },
            {
                key: 'drafts',
                label: 'Customer drafts',
                request: fetchJson('/api/customer-drafts?status=pending&limit=200&offset=0'),
                apply: (payload) => {
                    state.drafts = Array.isArray(payload.items) ? payload.items : [];
                    const total = Number(payload.pagination?.total);
                    state.draftTotal = Number.isFinite(total) && total >= state.drafts.length
                        ? total
                        : state.drafts.length;
                }
            },
            {
                key: 'disconnections',
                label: 'Disconnections',
                request: fetchJson('/api/disconnections'),
                apply: (payload) => { state.disconnections = Array.isArray(payload.items) ? payload.items : []; }
            },
            {
                key: 'pendingGcashPayments',
                label: 'Pending GCash',
                request: fetchJson('/api/payments/gcash-pending'),
                apply: (payload) => { state.pendingGcashPayments = Array.isArray(payload.payments) ? payload.payments : []; }
            },
            {
                key: 'gcashStatus',
                label: 'GCash PDF status',
                request: fetchJson('/api/payment-confirmations/gcash-history/status'),
                apply: (payload) => { state.gcashStatus = payload; }
            },
            {
                key: 'collectorApprovals',
                label: 'Collector approvals',
                request: fetchJson('/api/collector/payments/approvals'),
                apply: (payload) => { state.collectorApprovals = Array.isArray(payload.records) ? payload.records : []; }
            },
            {
                key: 'remittances',
                label: 'Remittances',
                request: fetchJson('/api/collector/payments/remittances'),
                apply: (payload) => { state.remittances = Array.isArray(payload.records) ? payload.records : []; }
            },
            {
                key: 'schedules',
                label: 'Collector schedules',
                request: fetchJson('/api/collector/payments/reschedules?status=active&limit=1000'),
                apply: (payload) => { state.schedules = Array.isArray(payload.records) ? payload.records : []; }
            }
        ];

        try {
            const results = await Promise.allSettled(sources.map((source) => source.request));
            const errors = [];
            results.forEach((result, index) => {
                const source = sources[index];
                if (result.status === 'fulfilled') {
                    try {
                        source.apply(result.value || {});
                    } catch (error) {
                        state.unavailable.add(source.key);
                        errors.push(`${source.label}: ${error?.message || 'invalid response.'}`);
                    }
                    return;
                }
                state.unavailable.add(source.key);
                errors.push(`${source.label}: ${result.reason?.message || 'unavailable.'}`);
            });
            populateAreaFilter();
            renderDashboard();
            setAlert(errors);
            const now = new Date();
            elements.updated.textContent = `${state.unavailable.size ? 'Partially updated' : 'Updated'} ${dateFormatter.format(now)} at ${timeFormatter.format(now)}`;
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

    loadDashboard();
});
