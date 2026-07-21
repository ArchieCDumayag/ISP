document.addEventListener('DOMContentLoaded', () => {
    const locale = 'en-PH';
    const dashCustomersEl = document.getElementById('dash-customers');
    const dashRevenueEl = document.getElementById('dash-revenue');
    const dashPlansEl = document.getElementById('dash-plans');
    const paymentsTableBody = document.getElementById('paymentHistoryBody');
    const lineChartCanvas = document.getElementById('trendMonthlyChart');
    const channelsChartCanvas = document.getElementById('trendChannelsChart');
    const dailyChartCanvas = document.getElementById('trendDailyChart');
    const balancePieChartCanvas = document.getElementById('trendBalancePieChart');
    const statusPieChartCanvas = document.getElementById('trendStatusPieChart');
    const channelSourceBarChartCanvas = document.getElementById('trendChannelSourceBarChart');
    const trendSourceChartMetaEl = document.getElementById('trendSourceChartMeta');
    const trendSourceMonthFilter = document.getElementById('trendSourceMonthFilter');
    const balanceTotalValueEl = document.getElementById('trendBalanceTotalValue');
    const balanceBreakdownEl = document.getElementById('trendBalanceBreakdown');
    const balanceInsightEl = document.getElementById('trendBalanceInsight');
    const balanceDetailEl = document.getElementById('trendBalanceDetail');
    const balanceDetailEyebrowEl = document.getElementById('trendBalanceDetailEyebrow');
    const balanceDetailTitleEl = document.getElementById('trendBalanceDetailTitle');
    const balanceDetailMetaEl = document.getElementById('trendBalanceDetailMeta');
    const balanceDetailListEl = document.getElementById('trendBalanceDetailList');
    const balanceDetailCloseBtn = document.getElementById('trendBalanceDetailCloseBtn');
    const statusTotalValueEl = document.getElementById('trendStatusTotalValue');
    const statusBreakdownEl = document.getElementById('trendStatusBreakdown');
    const statusInsightEl = document.getElementById('trendStatusInsight');
    const sourceTotalValueEl = document.getElementById('trendSourceTotalValue');
    const sourceBreakdownEl = document.getElementById('trendSourceBreakdown');
    const sourceInsightEl = document.getElementById('trendSourceInsight');
    const trendTotalBilledEl = document.getElementById('trendTotalBilled');
    const trendBilledMetaEl = document.getElementById('trendBilledMeta');
    const trendTotalCollectedEl = document.getElementById('trendTotalCollected');
    const trendCollectedMetaEl = document.getElementById('trendCollectedMeta');
    const trendCollectionRateEl = document.getElementById('trendCollectionRate');
    const trendCollectionBadgeEl = document.getElementById('trendCollectionBadge');
    const trendPayingSubsEl = document.getElementById('trendPayingSubs');
    const trendSubsMetaEl = document.getElementById('trendSubsMeta');
    const trendOutstandingEl = document.getElementById('trendOutstanding');
    const trendOutstandingMetaEl = document.getElementById('trendOutstandingMeta');
    const trendCurrentCollectedEl = document.getElementById('trendCurrentCollected');
    const trendCurrentDeltaEl = document.getElementById('trendCurrentDelta');
    const trendAreaFilter = document.getElementById('trendAreaFilter');
    const trendChartAreaFilter = document.getElementById('trendChartAreaFilter');
    const trendAreaFilters = [trendAreaFilter, trendChartAreaFilter].filter(Boolean);
    const trendScopeMetaEl = document.getElementById('trendScopeMeta');
    const trendDailyChartMetaEl = document.getElementById('trendDailyChartMeta');
    const trendDailyPeakBalanceEl = document.getElementById('trendDailyPeakBalance');
    const trendDailyPeakBalanceMetaEl = document.getElementById('trendDailyPeakBalanceMeta');
    const trendDailyPeakCollectedEl = document.getElementById('trendDailyPeakCollected');
    const trendDailyPeakCollectedMetaEl = document.getElementById('trendDailyPeakCollectedMeta');
    const trendDailySpotlightEl = document.getElementById('trendDailySpotlight');
    const trendDailySpotlightMetaEl = document.getElementById('trendDailySpotlightMeta');

    const pesoFormatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'PHP',
        currencyDisplay: 'symbol',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const countFormatter = new Intl.NumberFormat(locale);

    const dateFormatter = new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });

    const dayLabelFormatter = new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric'
    });

    const monthLabelFormatter = new Intl.DateTimeFormat(locale, { month: 'short' });
    const monthFullLabelFormatter = new Intl.DateTimeFormat(locale, { month: 'long' });

    const trendState = {
        year: new Date().getFullYear(),
        region: 'all',
        sourceMonth: String(new Date().getMonth()),
        sourceCustomers: [],
        sourcePayments: {},
        sourcePlans: { prepaid: [], postpaid: [] },
        payments: {},
        customers: [],
        charts: {
            line: null,
            channels: null,
            daily: null,
            balancePie: null,
            statusPie: null,
            channelSourceBar: null
        },
        series: [],
    };

    const formatCurrency = (amount) => pesoFormatter.format(Number(amount) || 0);
    const formatCount = (value) => countFormatter.format(Number(value) || 0);
    const compactCurrencyFormatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'PHP',
        currencyDisplay: 'narrowSymbol',
        notation: 'compact',
        maximumFractionDigits: 1
    });

    const pad2 = (value) => String(value).padStart(2, '0');

    const formatDateKey = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    };

    const safeDate = (raw) => {
        if (!raw) return null;
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const startOfDay = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    };

    const formatShare = (value, digits = 1) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return '0%';
        return `${numeric.toFixed(digits)}%`;
    };

    const formatInsightShare = (value) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return '0%';
        const rounded = Math.round(numeric * 10) / 10;
        return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
    };

    const formatCompactCurrency = (amount) => compactCurrencyFormatter.format(Number(amount) || 0);
    const parseMonthIndex = (value) => {
        const numeric = Number(value);
        return Number.isInteger(numeric) && numeric >= 0 && numeric < 12 ? numeric : null;
    };
    const formatTrendMonthScope = (year, monthValue) => {
        const selectedYear = Number(year) || new Date().getFullYear();
        const monthIndex = parseMonthIndex(monthValue);
        if (monthIndex === null) return `all months in ${selectedYear}`;
        return `${monthFullLabelFormatter.format(new Date(selectedYear, monthIndex, 1))} ${selectedYear}`;
    };
    const formatCustomerDisplayName = (customer) => {
        const fullName = `${String(customer?.firstName || '').trim()} ${String(customer?.lastName || '').trim()}`.trim();
        return fullName || String(customer?.name || '').trim() || `Account ${String(customer?.accountNumber || '').trim() || 'Unknown'}`;
    };
    const normalizeAreaValue = (value) => String(value || '').trim().toLowerCase();
    const getCustomerArea = (customer) => String(
        customer?.area
        || customer?.coverageArea
        || customer?.cluster
        || ''
    ).trim();
    const getSelectedArea = () => {
        const activeFilter = trendAreaFilters.find((filter) => String(filter?.value || '').trim());
        return String(activeFilter?.value || '').trim();
    };
    const formatAreaScopeLabel = (area) => area || 'All areas';
    const formatPlural = (count, singular, plural = `${singular}s`) => `${formatCount(count)} ${count === 1 ? singular : plural}`;
    const hasTrendSourceData = () => (
        (Array.isArray(trendState.sourceCustomers) && trendState.sourceCustomers.length > 0)
        || Object.keys(trendState.sourcePayments || {}).length > 0
        || (Array.isArray(trendState.series) && trendState.series.length > 0)
    );
    const isDarkThemeActive = () => (
        document.body?.classList.contains('theme-dark')
        || document.documentElement?.classList.contains('theme-dark')
        || document.body?.dataset.theme === 'dark'
        || document.documentElement?.dataset.theme === 'dark'
    );

    const getTrendDailyChartPalette = () => {
        if (isDarkThemeActive()) {
            return {
                backdropStops: ['rgba(15, 23, 42, 0.96)', 'rgba(15, 23, 42, 0.92)', 'rgba(15, 23, 42, 0.88)'],
                frameColor: 'rgba(71, 85, 105, 0.5)',
                balanceStops: ['rgba(96, 165, 250, 0.82)', 'rgba(32, 107, 196, 0.74)', 'rgba(29, 78, 216, 0.62)'],
                balanceHighlightStops: ['rgba(191, 219, 254, 0.9)', 'rgba(64, 137, 232, 0.86)', 'rgba(32, 107, 196, 0.74)'],
                balanceBorder: 'rgba(96, 165, 250, 0.42)',
                balanceHighlightBorder: 'rgba(191, 219, 254, 0.66)',
                collectedStops: ['rgba(134, 239, 172, 0.78)', 'rgba(47, 179, 68, 0.74)', 'rgba(22, 163, 74, 0.62)'],
                collectedHighlightStops: ['rgba(187, 247, 208, 0.9)', 'rgba(74, 222, 128, 0.82)', 'rgba(34, 197, 94, 0.7)'],
                collectedBorder: 'rgba(74, 222, 128, 0.38)',
                collectedHighlightBorder: 'rgba(187, 247, 208, 0.6)',
                legendColor: '#cbd5e1',
                tooltipBackground: 'rgba(7, 12, 24, 0.96)',
                tooltipTitle: '#bfdbfe',
                tooltipBody: '#f8fafc',
                tooltipBorder: 'rgba(148, 163, 184, 0.22)',
                xTickColor: 'rgba(248, 250, 252, 0.78)',
                yGridColor: 'rgba(148, 163, 184, 0.1)',
                yTickColor: 'rgba(226, 232, 240, 0.72)'
            };
        }

        return {
            backdropStops: ['rgba(255, 255, 255, 1)', 'rgba(248, 250, 252, 0.96)', 'rgba(241, 245, 249, 0.92)'],
            frameColor: 'rgba(203, 213, 225, 0.8)',
            balanceStops: ['rgba(96, 165, 250, 0.76)', 'rgba(32, 107, 196, 0.72)', 'rgba(29, 78, 216, 0.58)'],
            balanceHighlightStops: ['rgba(191, 219, 254, 0.9)', 'rgba(64, 137, 232, 0.86)', 'rgba(32, 107, 196, 0.72)'],
            balanceBorder: 'rgba(32, 107, 196, 0.34)',
            balanceHighlightBorder: 'rgba(96, 165, 250, 0.52)',
            collectedStops: ['rgba(134, 239, 172, 0.7)', 'rgba(47, 179, 68, 0.72)', 'rgba(22, 163, 74, 0.56)'],
            collectedHighlightStops: ['rgba(187, 247, 208, 0.86)', 'rgba(74, 222, 128, 0.82)', 'rgba(34, 197, 94, 0.68)'],
            collectedBorder: 'rgba(47, 179, 68, 0.32)',
            collectedHighlightBorder: 'rgba(74, 222, 128, 0.48)',
            legendColor: '#334155',
            tooltipBackground: 'rgba(255, 255, 255, 0.98)',
            tooltipTitle: '#206bc4',
            tooltipBody: '#0f172a',
            tooltipBorder: 'rgba(148, 163, 184, 0.24)',
            xTickColor: 'rgba(51, 65, 85, 0.86)',
            yGridColor: 'rgba(203, 213, 225, 0.58)',
            yTickColor: 'rgba(71, 85, 105, 0.88)'
        };
    };

    const normalizeCustomerStatus = (value, fallback = 'active') => {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'inactive' || raw === 'disabled' || raw === 'active') return raw;
        return fallback;
    };

    function populateTrendAreaOptions(customers) {
        if (!trendAreaFilters.length) return;
        const currentValue = getSelectedArea();
        const uniqueAreas = Array.from(new Set(
            (Array.isArray(customers) ? customers : [])
                .map((customer) => getCustomerArea(customer))
                .filter(Boolean)
        )).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true }));

        const hasCurrentValue = uniqueAreas.includes(currentValue);
        trendAreaFilters.forEach((filter) => {
            filter.innerHTML = '<option value="">All areas</option>';
            uniqueAreas.forEach((area) => {
                filter.add(new Option(area, area));
            });
            filter.value = hasCurrentValue ? currentValue : '';
        });
    }

    function populateTrendSourceMonthOptions() {
        if (!trendSourceMonthFilter) return;
        const currentMonthValue = parseMonthIndex(trendState.sourceMonth);
        trendSourceMonthFilter.innerHTML = '<option value="">All months</option>';
        Array.from({ length: 12 }, (_, monthIndex) => {
            const label = monthFullLabelFormatter.format(new Date(2000, monthIndex, 1));
            trendSourceMonthFilter.add(new Option(label, String(monthIndex)));
        });
        trendSourceMonthFilter.value = currentMonthValue === null ? '' : String(currentMonthValue);
    }

    function syncTrendAreaFilters(value, sourceFilter = null) {
        trendAreaFilters.forEach((filter) => {
            if (!filter || filter === sourceFilter) return;
            filter.value = value;
        });
    }

    function filterCustomersByArea(customers, areaValue) {
        const targetArea = normalizeAreaValue(areaValue);
        if (!targetArea) return Array.isArray(customers) ? customers.slice() : [];
        return (Array.isArray(customers) ? customers : []).filter((customer) => normalizeAreaValue(getCustomerArea(customer)) === targetArea);
    }

    function filterPaymentsByArea(payments, customers, areaValue) {
        const targetArea = normalizeAreaValue(areaValue);
        if (!targetArea) return payments || {};

        const allowedAccounts = new Set(
            (Array.isArray(customers) ? customers : [])
                .map((customer) => String(customer?.accountNumber || '').trim())
                .filter(Boolean)
        );

        return Object.entries(payments || {}).reduce((accumulator, [accountNumber, accountData]) => {
            if (allowedAccounts.has(String(accountNumber || '').trim())) {
                accumulator[accountNumber] = accountData;
            }
            return accumulator;
        }, {});
    }

    function updateTrendScopeCopy(areaValue, customers) {
        const scopeLabel = formatAreaScopeLabel(areaValue);
        const customerCount = Array.isArray(customers) ? customers.length : 0;
        const selectedYear = Number(trendState?.year) || new Date().getFullYear();

        if (trendScopeMetaEl) {
            trendScopeMetaEl.textContent = areaValue
                ? `${scopeLabel} is selected. ${formatPlural(customerCount, 'account')} included in this dashboard view.`
                : 'Switch the area to update the dashboard charts and summaries live.';
        }

        if (trendDailyChartMetaEl) {
            trendDailyChartMetaEl.textContent = `${scopeLabel} - Balance vs collected across 12 months in ${selectedYear}.`;
        }
    }

    function updateTrendSourceCopy(areaValue, monthValue = trendState.sourceMonth) {
        if (!trendSourceChartMetaEl) return;
        const scopeLabel = formatAreaScopeLabel(areaValue);
        trendSourceChartMetaEl.textContent = `${scopeLabel} - Collected payment amounts grouped by cash-in or payment source for ${formatTrendMonthScope(trendState.year, monthValue)}.`;
    }

    function updateTrendDailyLuxurySummaryLegacy(series, highlightIndex) {
        const months = Array.isArray(series) ? series : [];
        const balanceMonths = months.filter((month) => typeof month?.balance === 'number' && month.balance > 0);
        const collectedMonths = months.filter((month) => (Number(month?.collected) || 0) > 0);
        const latestActiveMonth = [...months].reverse().find((month) => {
            const balance = month?.balance;
            return (typeof balance === 'number' && balance > 0) || (Number(month?.collected) || 0) > 0;
        }) || null;
        const spotlightMonth = (Number.isInteger(highlightIndex) && highlightIndex >= 0 && months[highlightIndex])
            ? months[highlightIndex]
            : latestActiveMonth;

        const peakBalanceMonth = balanceMonths.reduce((best, month) => (
            !best || month.balance > best.balance ? month : best
        ), null);
        const peakCollectedMonth = collectedMonths.reduce((best, month) => (
            !best || month.collected > best.collected ? month : best
        ), null);

        if (trendDailyPeakBalanceEl) {
            trendDailyPeakBalanceEl.textContent = peakBalanceMonth
                ? formatCompactCurrency(peakBalanceMonth.balance)
                : formatCompactCurrency(0);
        }
        if (trendDailyPeakBalanceMetaEl) {
            trendDailyPeakBalanceMetaEl.textContent = peakBalanceMonth
                ? `${peakBalanceMonth.fullLabel} · highest remaining balance`
                : 'Waiting for balance movement.';
        }

        if (trendDailyPeakCollectedEl) {
            trendDailyPeakCollectedEl.textContent = peakCollectedMonth
                ? formatCompactCurrency(peakCollectedMonth.collected)
                : formatCompactCurrency(0);
        }
        if (trendDailyPeakCollectedMetaEl) {
            trendDailyPeakCollectedMetaEl.textContent = peakCollectedMonth
                ? `${peakCollectedMonth.fullLabel} · strongest collection month`
                : 'Waiting for collection movement.';
        }

        if (trendDailySpotlightEl) {
            trendDailySpotlightEl.textContent = spotlightMonth ? spotlightMonth.fullLabel : 'No spotlight';
        }
        if (trendDailySpotlightMetaEl) {
            trendDailySpotlightMetaEl.textContent = spotlightMonth
                ? `Balance ${formatCompactCurrency(spotlightMonth.balance)} · Collected ${formatCompactCurrency(spotlightMonth.collected)}`
                : 'Balance and collection details will appear here.';
        }
    }

    function updateTrendDailyLuxurySummary(series, highlightIndex) {
        const months = Array.isArray(series) ? series : [];
        const balanceMonths = months.filter((month) => typeof month?.balance === 'number' && month.balance > 0);
        const collectedMonths = months.filter((month) => (Number(month?.collected) || 0) > 0);
        const latestActiveMonth = [...months].reverse().find((month) => {
            const balance = month?.balance;
            return (typeof balance === 'number' && balance > 0) || (Number(month?.collected) || 0) > 0;
        }) || null;
        const spotlightMonth = (Number.isInteger(highlightIndex) && highlightIndex >= 0 && months[highlightIndex])
            ? months[highlightIndex]
            : latestActiveMonth;

        const peakBalanceMonth = balanceMonths.reduce((best, month) => (
            !best || month.balance > best.balance ? month : best
        ), null);
        const peakCollectedMonth = collectedMonths.reduce((best, month) => (
            !best || month.collected > best.collected ? month : best
        ), null);

        if (trendDailyPeakBalanceEl) {
            trendDailyPeakBalanceEl.textContent = peakBalanceMonth
                ? formatCompactCurrency(peakBalanceMonth.balance)
                : formatCompactCurrency(0);
        }
        if (trendDailyPeakBalanceMetaEl) {
            trendDailyPeakBalanceMetaEl.textContent = peakBalanceMonth
                ? `${peakBalanceMonth.fullLabel} - highest remaining balance`
                : 'Waiting for balance movement.';
        }

        if (trendDailyPeakCollectedEl) {
            trendDailyPeakCollectedEl.textContent = peakCollectedMonth
                ? formatCompactCurrency(peakCollectedMonth.collected)
                : formatCompactCurrency(0);
        }
        if (trendDailyPeakCollectedMetaEl) {
            trendDailyPeakCollectedMetaEl.textContent = peakCollectedMonth
                ? `${peakCollectedMonth.fullLabel} - strongest collection month`
                : 'Waiting for collection movement.';
        }

        if (trendDailySpotlightEl) {
            trendDailySpotlightEl.textContent = spotlightMonth ? spotlightMonth.fullLabel : 'No spotlight';
        }
        if (trendDailySpotlightMetaEl) {
            trendDailySpotlightMetaEl.textContent = spotlightMonth
                ? `Balance ${formatCompactCurrency(spotlightMonth.balance)} - Collected ${formatCompactCurrency(spotlightMonth.collected)}`
                : 'Balance and collection details will appear here.';
        }
    }

    const resolveLedgerEntryDirection = (entry) => {
        const kind = String(entry?.kind || '').trim().toLowerCase();
        const direction = String(entry?.direction || '').trim().toLowerCase();
        if (direction === 'debit' || kind === 'charge') return 'debit';
        if (direction === 'credit' || ['payment', 'rebate', 'discount'].includes(kind)) return 'credit';
        return '';
    };

    const computeBalance = (history = []) => {
        if (!Array.isArray(history)) return 0;
        let balance = 0;
        history.forEach((entry) => {
            const amount = Number(entry?.amount);
            if (!Number.isFinite(amount)) return;
            const ledgerDirection = resolveLedgerEntryDirection(entry);
            if (ledgerDirection === 'debit') balance += amount;
            else if (ledgerDirection === 'credit') balance -= amount;
        });
        return balance;
    };

    const classifyBalanceState = (customer, payments) => {
        const accountNumber = String(customer?.accountNumber || '').trim();
        const history = accountNumber ? payments?.[accountNumber]?.history || [] : [];
        const balance = computeBalance(history);
        if (balance < 0) return 'advance';
        if (balance > 0) return 'unpaid';
        return 'paid';
    };

    const classifyPaymentSource = (entry) => {
        const method = String(entry?.paymentMethod || entry?.method || entry?.channel || '').trim().toLowerCase();
        const recordedRole = String(entry?.recordedBy?.role || '').trim().toLowerCase();
        const recordedId = String(entry?.recordedBy?.id || '').trim().toLowerCase();
        if (entry?.xenditId || recordedId === 'xendit' || method.includes('xendit')) return 'Xendit';
        if (method.includes('gcash')) return 'GCash';
        if (recordedRole === 'collector') return 'Collector';
        return 'Admin';
    };

    const createBreakdownItems = (labels, values, colors) => labels.map((label, index) => ({
        label,
        value: Number(values[index]) || 0,
        color: colors[index] || '#94a3b8'
    }));

    const getBalanceBucketMeta = (bucketKey) => {
        const normalized = String(bucketKey || '').trim().toLowerCase();
        if (normalized === 'advance') {
            return {
                key: 'advance',
                label: 'Advance',
                eyebrow: 'Advance Subscribers',
                empty: 'No subscribers are currently in advance for this filter.',
                amountLabel: 'Advance credit'
            };
        }
        if (normalized === 'unpaid') {
            return {
                key: 'unpaid',
                label: 'Unpaid',
                eyebrow: 'Unpaid Subscribers',
                empty: 'No unpaid subscribers for this filter.',
                amountLabel: 'Outstanding balance'
            };
        }
        return {
            key: 'paid',
            label: 'Paid',
            eyebrow: 'Paid Subscribers',
            empty: 'No paid subscribers for this filter.',
            amountLabel: 'Current balance'
        };
    };

    const buildBalanceBuckets = (customers, payments) => {
        const buckets = {
            paid: [],
            unpaid: [],
            advance: []
        };

        (Array.isArray(customers) ? customers : []).forEach((customer) => {
            const accountNumber = String(customer?.accountNumber || '').trim();
            const history = accountNumber ? payments?.[accountNumber]?.history || [] : [];
            const balance = computeBalance(history);
            const bucketKey = balance < 0 ? 'advance' : balance > 0 ? 'unpaid' : 'paid';
            buckets[bucketKey].push({
                name: formatCustomerDisplayName(customer),
                accountNumber,
                area: getCustomerArea(customer),
                balance
            });
        });

        const sortByName = (left, right) => (
            String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' })
            || String(left?.accountNumber || '').localeCompare(String(right?.accountNumber || ''), undefined, { numeric: true, sensitivity: 'base' })
        );

        buckets.paid.sort(sortByName);
        buckets.unpaid.sort((left, right) => Math.abs(Number(right?.balance) || 0) - Math.abs(Number(left?.balance) || 0) || sortByName(left, right));
        buckets.advance.sort((left, right) => Math.abs(Number(right?.balance) || 0) - Math.abs(Number(left?.balance) || 0) || sortByName(left, right));
        return buckets;
    };

    const hideBalanceBucketDetail = () => {
        trendState.activeBalanceBucket = '';
        renderBalanceBreakdown();
        if (balanceDetailEl) balanceDetailEl.hidden = true;
    };

    const renderBalanceBucketDetail = () => {
        if (!balanceDetailEl || !balanceDetailTitleEl || !balanceDetailMetaEl || !balanceDetailListEl || !balanceDetailEyebrowEl) return;
        const meta = getBalanceBucketMeta(trendState.activeBalanceBucket);
        const entries = trendState.balanceBuckets?.[meta.key] || [];
        const areaLabel = formatAreaScopeLabel(getSelectedArea());

        if (!trendState.activeBalanceBucket) {
            balanceDetailEl.hidden = true;
            return;
        }

        balanceDetailEl.hidden = false;
        balanceDetailEyebrowEl.textContent = meta.eyebrow;
        balanceDetailTitleEl.textContent = `${formatCount(entries.length)} ${entries.length === 1 ? 'subscriber' : 'subscribers'} in ${meta.label}`;
        balanceDetailMetaEl.textContent = `${areaLabel} filter applied. Showing matching subscribers and their ${meta.amountLabel.toLowerCase()}.`;

        if (!entries.length) {
            balanceDetailListEl.innerHTML = `<li class="trend-balance-detail__empty">${escapeHtml(meta.empty)}</li>`;
            return;
        }

        balanceDetailListEl.innerHTML = entries.map((entry) => {
            const amountClass = meta.key === 'advance' ? 'is-advance' : (meta.key === 'unpaid' ? 'is-unpaid' : 'is-paid');
            const amountValue = meta.key === 'paid'
                ? formatCurrency(Number(entry?.balance) || 0)
                : formatCurrency(Math.abs(Number(entry?.balance) || 0));
            const areaSuffix = entry?.area ? ` · ${entry.area}` : '';
            return `
                <li class="trend-balance-detail__item">
                    <div class="trend-balance-detail__main">
                        <span class="trend-balance-detail__name">${escapeHtml(entry?.name || 'Unknown subscriber')}</span>
                        <span class="trend-balance-detail__sub">${escapeHtml((entry?.accountNumber || 'No account number') + (String(entry?.area || '').trim() ? ` - ${String(entry.area).trim()}` : ''))}</span>
                    </div>
                    <strong class="trend-balance-detail__amount ${amountClass}">${escapeHtml(amountValue)}</strong>
                </li>
            `;
        }).join('');
    };

    const toggleBalanceBucketDetail = (bucketKey) => {
        const nextKey = String(bucketKey || '').trim().toLowerCase();
        if (!nextKey) {
            hideBalanceBucketDetail();
            return;
        }
        trendState.activeBalanceBucket = trendState.activeBalanceBucket === nextKey ? '' : nextKey;
        renderBalanceBreakdown();
        renderBalanceBucketDetail();
    };

    const renderChartBreakdown = (container, items, valueFormatter) => {
        if (!container) return;
        const isLuxuryBreakdown = container.classList.contains('trend-chart-breakdown--luxury');
        if (!Array.isArray(items) || !items.length) {
            container.innerHTML = '<li class="trend-chart-breakdown__empty">No breakdown available.</li>';
            return;
        }
        const total = items.reduce((sum, item) => sum + (Number(item?.value) || 0), 0);
        container.innerHTML = items.map((item) => {
            const value = Number(item?.value) || 0;
            const share = total <= 0 ? 0 : (value / total) * 100;
            const bucketKey = String(item?.key || '').trim().toLowerCase();
            const isActionable = Boolean(bucketKey);
            const isActive = isActionable && trendState.activeBalanceBucket === bucketKey;
            const actionAttrs = isActionable
                ? ` data-balance-bucket="${escapeHtml(bucketKey)}" role="button" tabindex="0" aria-label="View ${escapeHtml(item.label)} subscribers"`
                : '';
            if (isLuxuryBreakdown) {
                return `
                    <li class="trend-luxury-metric trend-luxury-metric--source${isActionable ? ' is-actionable' : ''}${isActive ? ' is-active' : ''}" style="--trend-breakdown-color: ${item.color || '#94a3b8'};"${actionAttrs}>
                        <span class="trend-luxury-metric__label">${escapeHtml(item.label)}</span>
                        <strong class="trend-luxury-metric__value">${escapeHtml(valueFormatter(value, item))}</strong>
                        <span class="trend-luxury-metric__meta">${formatShare(share)} of total collected</span>
                    </li>
                `;
            }
            return `
                <li class="trend-chart-breakdown-item${isActionable ? ' is-actionable' : ''}${isActive ? ' is-active' : ''}" style="--trend-breakdown-color: ${item.color || '#94a3b8'};"${actionAttrs}>
                    <span class="trend-chart-breakdown-main">
                        <span class="trend-chart-breakdown-swatch"></span>
                        <span class="trend-chart-breakdown-label">${escapeHtml(item.label)}</span>
                    </span>
                    <span class="trend-chart-breakdown-metrics">
                        <strong class="trend-chart-breakdown-value">${escapeHtml(valueFormatter(value, item))}</strong>
                        <span class="trend-chart-breakdown-share">${formatShare(share)}</span>
                    </span>
                </li>
            `;
        }).join('');
    };

    function renderBalanceBreakdown() {
        renderChartBreakdown(
            balanceBreakdownEl,
            trendState.balanceBreakdownItems,
            (value) => formatSubscriberCount(value)
        );
    }

    const updateChartMeta = ({
        totalEl,
        totalValue,
        totalFormatter = (value) => String(value),
        breakdownEl,
        breakdownItems,
        breakdownValueFormatter = (value) => String(value),
        insightEl,
        insightText = 'No insight available.'
    }) => {
        if (totalEl) totalEl.textContent = totalFormatter(totalValue);
        renderChartBreakdown(breakdownEl, breakdownItems, breakdownValueFormatter);
        if (insightEl) insightEl.textContent = insightText;
    };

    const destroyTrendChart = (chartKey) => {
        if (!trendState.charts[chartKey]) return;
        trendState.charts[chartKey].destroy();
        trendState.charts[chartKey] = null;
    };

    const formatSubscriberCount = (value) => `${formatCount(value)} ${Number(value) === 1 ? 'subscriber' : 'subscribers'}`;
    const formatAccountCount = (value) => `${formatCount(value)} ${Number(value) === 1 ? 'account' : 'accounts'}`;

    async function fetchJSON(url) {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        return response.json();
    }

    async function fetchCustomers() {
        try {
            const data = await fetchJSON('/api/customers');
            return data.customers || [];
        } catch (error) {
            console.error('Customers fetch error:', error);
            return [];
        }
    }

    async function fetchPlans() {
        try {
            const data = await fetchJSON('/api/plans');
            return data.plans || { prepaid: [], postpaid: [] };
        } catch (error) {
            console.error('Plans fetch error:', error);
            return { prepaid: [], postpaid: [] };
        }
    }

    async function fetchPayments() {
        try {
            return await fetchJSON('/api/payments');
        } catch (error) {
            console.error('Payments fetch error:', error);
            return {};
        }
    }

    function updateHeroMetrics(customers, plans, payments) {
        if (dashCustomersEl) {
            dashCustomersEl.textContent = customers.length.toString();
        }

        if (dashPlansEl) {
            const totalPlans = (plans.prepaid?.length || 0) + (plans.postpaid?.length || 0);
            dashPlansEl.textContent = totalPlans.toString();
        }

        if (dashRevenueEl) {
            let totalRevenue = 0;
            Object.values(payments || {}).forEach(account => {
                (account.history || []).forEach(entry => {
                    if ((entry.direction || '').toLowerCase() === 'credit') {
                        totalRevenue += Number(entry.amount) || 0;
                    }
                });
            });
            dashRevenueEl.textContent = formatCurrency(totalRevenue);
        }
    }

    function renderPaymentHistory(payments, customers) {
        if (!paymentsTableBody) return;

        const rows = [];
        Object.entries(payments || {}).forEach(([accountId, account]) => {
            const customer = customers.find(c => c.accountNumber === accountId);
            const customerName = customer
                ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.name || `Account ${accountId}`
                : `Account ${accountId}`;

            (account.history || []).forEach(entry => {
                if ((entry.direction || '').toLowerCase() !== 'credit') return;
                const timestamp = safeDate(entry.recordedAt || entry.date);
                if (!timestamp) return;
                rows.push({
                    date: timestamp,
                    customer: customerName,
                    amount: Number(entry.amount) || 0,
                    status: (entry.status || 'Paid').toUpperCase()
                });
            });
        });

        rows.sort((a, b) => b.date - a.date);
        const latest = rows.slice(0, 10);

        if (latest.length === 0) {
            paymentsTableBody.innerHTML = '<tr><td colspan="4" class="empty-state">No recent payments found.</td></tr>';
            return;
        }

        paymentsTableBody.innerHTML = latest.map(row => `
            <tr>
                <td>${dateFormatter.format(row.date)}</td>
                <td>${row.customer}</td>
                <td>${formatCurrency(row.amount)}</td>
                <td><span class="status-pill status-paid">${row.status}</span></td>
            </tr>
        `).join('');
    }

    function buildMonthlySeries(payments, year) {
        const yearStart = new Date(year, 0, 1);
        const now = new Date();
        const displayMonthLimit = year < now.getFullYear()
            ? 11
            : year > now.getFullYear()
                ? -1
                : now.getMonth();
        const months = Array.from({ length: 12 }, (_, monthIndex) => {
            const date = new Date(year, monthIndex, 1);
            return {
                monthIndex,
                date,
                label: monthLabelFormatter.format(date),
                fullLabel: monthFullLabelFormatter.format(date),
                balance: 0,
                billed: 0,
                collected: 0,
                outstanding: 0,
                collectionRate: 0,
                growth: 0,
                payingSubs: 0,
                _payingAccountIds: new Set()
            };
        });

        const payingAccounts = new Set();

        Object.entries(payments || {}).forEach(([accountId, account]) => {
            let runningBalance = 0;
            const monthlyBalanceDeltas = Array.from({ length: 12 }, () => 0);

            (account.history || []).forEach(entry => {
                const amount = Number(entry.amount) || 0;
                if (!amount) return;
                const timestamp = safeDate(entry.recordedAt || entry.date);
                if (!timestamp) return;

                const ledgerDirection = resolveLedgerEntryDirection(entry);
                if (!ledgerDirection) return;

                const balanceDelta = ledgerDirection === 'debit' ? amount : -amount;

                if (timestamp < yearStart) {
                    runningBalance += balanceDelta;
                    return;
                }

                if (timestamp.getFullYear() !== year) return;

                const monthIndex = timestamp.getMonth();
                const month = months[monthIndex];
                if (!month) return;

                monthlyBalanceDeltas[monthIndex] += balanceDelta;

                if (ledgerDirection === 'debit') {
                    month.billed += amount;
                } else if (ledgerDirection === 'credit') {
                    month.collected += amount;
                    payingAccounts.add(accountId);
                    month._payingAccountIds.add(accountId);
                }
            });

            monthlyBalanceDeltas.forEach((delta, monthIndex) => {
                runningBalance += delta;
                months[monthIndex].balance += Math.max(runningBalance, 0);
            });
        });

        months.forEach((month) => {
            month.outstanding = Math.max(month.billed - month.collected, 0);
            month.collectionRate = month.billed === 0 ? 0 : (month.collected / month.billed) * 100;
            month.payingSubs = month._payingAccountIds.size;
            if (month.monthIndex > displayMonthLimit) {
                month.balance = null;
            }
            delete month._payingAccountIds;
        });

        let previousCollected = null;
        months.forEach((month) => {
            if (previousCollected === null || previousCollected === 0) {
                month.growth = 0;
            } else {
                month.growth = ((month.collected - previousCollected) / previousCollected) * 100;
            }
            previousCollected = month.collected;
        });

        const highlightIndex = months.reduce((acc, month, index) => {
            if ((month.billed > 0 || month.collected > 0)) {
                return index;
            }
            return acc;
        }, -1);

        return { months, highlightIndex, payingAccounts };
    }

    function buildDailySeries(payments, daysBack = 30) {
        const span = Math.max(1, Math.min(90, Number(daysBack) || 30));
        const today = startOfDay(new Date());
        if (!today) return [];

        const start = new Date(today);
        start.setDate(start.getDate() - (span - 1));

        const map = new Map();
        for (let i = 0; i < span; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const key = formatDateKey(d);
            map.set(key, {
                key,
                date: d,
                label: dayLabelFormatter.format(d),
                fullLabel: dateFormatter.format(d),
                billed: 0,
                collected: 0
            });
        }

        Object.values(payments || {}).forEach((account) => {
            (account.history || []).forEach((entry) => {
                const amount = Math.abs(Number(entry.amount) || 0);
                if (!amount) return;

                const timestamp = safeDate(entry.recordedAt || entry.date);
                const day = timestamp ? startOfDay(timestamp) : null;
                if (!day) return;
                if (day < start || day > today) return;

                const key = formatDateKey(day);
                const row = map.get(key);
                if (!row) return;

                const direction = String(entry.direction || '').toLowerCase();
                const kind = String(entry.kind || '').toLowerCase();

                if (direction === 'debit') {
                    row.billed += amount;
                } else if (direction === 'credit' && kind === 'payment') {
                    row.collected += amount;
                }
            });
        });

        return Array.from(map.values());
    }

    function updateTrendKPIs(series, highlightIndex, payingAccounts) {
        const months = Array.isArray(series) ? series : [];
        const selectedMonthIndex = parseMonthIndex(trendState.sourceMonth);
        const targetYear = Number(trendState.year) || new Date().getFullYear();
        const selectedMonth = selectedMonthIndex === null ? null : months[selectedMonthIndex];
        const summaryLabel = formatTrendMonthScope(targetYear, trendState.sourceMonth);

        const billed = selectedMonthIndex === null
            ? months.reduce((sum, month) => sum + (Number(month?.billed) || 0), 0)
            : (Number(selectedMonth?.billed) || 0);
        const collected = selectedMonthIndex === null
            ? months.reduce((sum, month) => sum + (Number(month?.collected) || 0), 0)
            : (Number(selectedMonth?.collected) || 0);
        const outstanding = selectedMonthIndex === null
            ? Math.max(billed - collected, 0)
            : (Number(selectedMonth?.outstanding) || Math.max(billed - collected, 0));
        const monthlyCollectionRate = billed === 0 ? 0 : (collected / billed) * 100;
        const monthlyPayingSubs = selectedMonthIndex === null
            ? (payingAccounts instanceof Set ? payingAccounts.size : 0)
            : (Number(selectedMonth?.payingSubs) || 0);

        if (trendTotalBilledEl) trendTotalBilledEl.textContent = formatCurrency(billed);
        if (trendTotalCollectedEl) trendTotalCollectedEl.textContent = formatCurrency(collected);
        if (trendCollectionRateEl) trendCollectionRateEl.textContent = `${monthlyCollectionRate.toFixed(1)}%`;
        if (trendOutstandingEl) trendOutstandingEl.textContent = formatCurrency(outstanding);
        if (trendPayingSubsEl) trendPayingSubsEl.textContent = monthlyPayingSubs.toString();

        if (trendBilledMetaEl) {
            trendBilledMetaEl.textContent = selectedMonthIndex === null
                ? `Across ${summaryLabel}`
                : `Billed in ${summaryLabel}`;
        }

        if (trendCollectedMetaEl) {
            trendCollectedMetaEl.textContent = selectedMonthIndex === null
                ? `Cleared and posted across ${summaryLabel}`
                : `Cleared and posted in ${summaryLabel}`;
        }

        if (trendSubsMetaEl) {
            trendSubsMetaEl.textContent = selectedMonthIndex === null
                ? `Accounts with posted payments across ${summaryLabel}`
                : `Accounts with posted payments in ${summaryLabel}`;
        }

        if (trendOutstandingMetaEl) {
            trendOutstandingMetaEl.textContent = selectedMonthIndex === null
                ? `Unpaid vs billed across ${summaryLabel}`
                : `Unpaid vs billed in ${summaryLabel}`;
        }

        if (trendCollectionBadgeEl) {
            if (monthlyCollectionRate >= 95) {
                trendCollectionBadgeEl.textContent = 'On target';
                trendCollectionBadgeEl.className = 'status-pill trend-collection-badge status-pill--good';
            } else if (monthlyCollectionRate >= 90) {
                trendCollectionBadgeEl.textContent = 'Monitor';
                trendCollectionBadgeEl.className = 'status-pill trend-collection-badge status-pill--neutral';
            } else {
                trendCollectionBadgeEl.textContent = 'Needs attention';
                trendCollectionBadgeEl.className = 'status-pill trend-collection-badge status-pill--alert';
            }
        }

        if (trendCurrentCollectedEl) {
            const latestMonth = selectedMonthIndex === null
                ? (highlightIndex >= 0 ? months[highlightIndex] : null)
                : selectedMonth;
            trendCurrentCollectedEl.textContent = formatCurrency(latestMonth?.collected || 0);
        }

        if (trendCurrentDeltaEl) {
            trendCurrentDeltaEl.textContent = '--';
            trendCurrentDeltaEl.classList.remove('positive', 'negative');
            const deltaMonthIndex = selectedMonthIndex === null ? highlightIndex : selectedMonthIndex;
            if (deltaMonthIndex > 0) {
                const current = months[deltaMonthIndex];
                const previous = months[deltaMonthIndex - 1];
                const delta = current.collected - previous.collected;
                const percent = previous.collected === 0 ? 0 : (delta / previous.collected) * 100;
                const sign = delta >= 0 ? '+' : '-';
                trendCurrentDeltaEl.textContent = `${sign}${formatCurrency(Math.abs(delta))} (${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%)`;
                trendCurrentDeltaEl.classList.add(delta >= 0 ? 'positive' : 'negative');
            }
        }
    }

    function ensureChartMessage(canvas, message) {
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
    }

    function clearChartMessage(canvas) {
        if (!canvas) return;
        const wrapper = canvas.closest('.chart-wrapper');
        if (!wrapper) return;
        const msg = wrapper.querySelector('.chart-empty-msg');
        if (msg) msg.remove();
        canvas.classList.remove('is-hidden');
    }

    function renderPieChart({
        canvas,
        chartKey,
        labels,
        data,
        colors,
        emptyMessage,
        valueFormatter = (value) => String(value),
        totalLabel = 'Total',
        totalFormatter = (value) => String(value),
        onSliceClick = null
    }) {
        if (!canvas) return;
        if (typeof Chart === 'undefined') {
            ensureChartMessage(canvas, 'Chart library failed to load.');
            return;
        }

        destroyTrendChart(chartKey);

        const numericData = Array.isArray(data) ? data.map((value) => Number(value) || 0) : [];
        const total = numericData.reduce((sum, value) => sum + value, 0);
        if (total <= 0) {
            ensureChartMessage(canvas, emptyMessage);
            return;
        }

        clearChartMessage(canvas);

        trendState.charts[chartKey] = new Chart(canvas, {
            type: 'pie',
            data: {
                labels,
                datasets: [{
                    data: numericData,
                    backgroundColor: colors,
                    borderColor: '#ffffff',
                    borderWidth: 2,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (_event, elements) => {
                    if (typeof onSliceClick !== 'function' || !Array.isArray(elements) || !elements.length) return;
                    const index = Number(elements[0]?.index);
                    if (!Number.isInteger(index) || index < 0) return;
                    onSliceClick({
                        index,
                        label: labels[index] || '',
                        value: numericData[index] || 0
                    });
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => items[0]?.label || '',
                            label: (context) => {
                                const value = Number(context.raw) || 0;
                                const percentage = total === 0 ? 0 : (value / total) * 100;
                                return `Value: ${valueFormatter(value)}`;
                            },
                            afterLabel: (context) => {
                                const value = Number(context.raw) || 0;
                                const percentage = total === 0 ? 0 : (value / total) * 100;
                                return [
                                    `Share: ${formatShare(percentage)}`,
                                    `${totalLabel}: ${totalFormatter(total)}`
                                ];
                            }
                        }
                    }
                }
            }
        });
    }

    function renderBalancePieChart(customers, payments) {
        const counts = { paid: 0, unpaid: 0, advance: 0 };
        const buckets = buildBalanceBuckets(customers, payments);
        trendState.balanceBuckets = buckets;
        (Array.isArray(customers) ? customers : []).forEach((customer) => {
            const state = classifyBalanceState(customer, payments);
            counts[state] += 1;
        });

        const labels = ['Paid', 'Unpaid', 'Advance'];
        const colors = ['#16a34a', '#ef4444', '#f59e0b'];
        const values = [counts.paid, counts.unpaid, counts.advance];
        const bucketKeys = ['paid', 'unpaid', 'advance'];
        const items = createBreakdownItems(labels, values, colors).map((item, index) => ({
            ...item,
            key: bucketKeys[index]
        }));
        trendState.balanceBreakdownItems = items;
        const totalSubscribers = values.reduce((sum, value) => sum + value, 0);
        const unpaidShare = totalSubscribers <= 0 ? 0 : (counts.unpaid / totalSubscribers) * 100;
        const advanceShare = totalSubscribers <= 0 ? 0 : (counts.advance / totalSubscribers) * 100;

        if (trendState.activeBalanceBucket && !bucketKeys.includes(trendState.activeBalanceBucket)) {
            trendState.activeBalanceBucket = '';
        }

        updateChartMeta({
            totalEl: balanceTotalValueEl,
            totalValue: totalSubscribers,
            totalFormatter: (value) => formatCount(value),
            breakdownEl: balanceBreakdownEl,
            breakdownItems: items,
            breakdownValueFormatter: (value) => formatSubscriberCount(value),
            insightEl: balanceInsightEl,
            insightText: totalSubscribers <= 0
                ? 'No subscriber balance data available yet.'
                : counts.unpaid > 0
                    ? `${formatInsightShare(unpaidShare)} of subscribers are unpaid.`
                    : counts.advance > 0
                        ? `${formatInsightShare(advanceShare)} of subscribers are in advance.`
                        : `All ${formatCount(totalSubscribers)} subscribers are currently paid.`
        });

        renderPieChart({
            canvas: balancePieChartCanvas,
            chartKey: 'balancePie',
            labels,
            data: values,
            colors,
            emptyMessage: 'No subscriber balance data available.',
            valueFormatter: (value) => formatSubscriberCount(value),
            totalLabel: 'Total Subscribers',
            totalFormatter: (value) => formatCount(value),
            onSliceClick: ({ index }) => toggleBalanceBucketDetail(bucketKeys[index])
        });

        renderBalanceBucketDetail();
    }

    function renderStatusPieChart(customers) {
        const counts = { active: 0, inactive: 0, disabled: 0 };
        (Array.isArray(customers) ? customers : []).forEach((customer) => {
            const status = normalizeCustomerStatus(customer?.status);
            counts[status] += 1;
        });

        const labels = ['Active', 'Inactive', 'Disabled'];
        const colors = ['#2563eb', '#f59e0b', '#64748b'];
        const values = [counts.active, counts.inactive, counts.disabled];
        const items = createBreakdownItems(labels, values, colors);
        const totalAccounts = values.reduce((sum, value) => sum + value, 0);
        const activeShare = totalAccounts <= 0 ? 0 : (counts.active / totalAccounts) * 100;

        updateChartMeta({
            totalEl: statusTotalValueEl,
            totalValue: totalAccounts,
            totalFormatter: (value) => formatCount(value),
            breakdownEl: statusBreakdownEl,
            breakdownItems: items,
            breakdownValueFormatter: (value) => formatAccountCount(value),
            insightEl: statusInsightEl,
            insightText: totalAccounts <= 0
                ? 'No customer status data available yet.'
                : `${formatInsightShare(activeShare)} of accounts are active.`
        });

        renderPieChart({
            canvas: statusPieChartCanvas,
            chartKey: 'statusPie',
            labels,
            data: values,
            colors,
            emptyMessage: 'No customer status data available.',
            valueFormatter: (value) => formatAccountCount(value),
            totalLabel: 'Total Accounts',
            totalFormatter: (value) => formatCount(value)
        });
    }

    function renderPaymentSourceBarChart(payments, year = trendState.year, selectedMonth = trendState.sourceMonth) {
        const totals = {
            Collector: 0,
            Admin: 0,
            GCash: 0,
            Xendit: 0
        };
        const targetYear = Number(year) || new Date().getFullYear();
        const targetMonth = parseMonthIndex(selectedMonth);
        const sourceScopeLabel = formatTrendMonthScope(targetYear, selectedMonth);
        const areaScopeLabel = formatAreaScopeLabel(getSelectedArea());

        Object.values(payments || {}).forEach((account) => {
            (account?.history || []).forEach((entry) => {
                const amount = Number(entry?.amount) || 0;
                if (amount <= 0) return;
                const direction = String(entry?.direction || '').trim().toLowerCase();
                const kind = String(entry?.kind || '').trim().toLowerCase();
                if (direction !== 'credit') return;
                if (kind && kind !== 'payment') return;
                const timestamp = safeDate(entry?.recordedAt || entry?.date);
                if (!timestamp || timestamp.getFullYear() !== targetYear) return;
                if (targetMonth !== null && timestamp.getMonth() !== targetMonth) return;
                const source = classifyPaymentSource(entry);
                totals[source] += amount;
            });
        });

        const labels = ['Admin', 'Collector', 'GCash', 'Xendit'];
        const colors = ['#2563eb', '#16a34a', '#f59e0b', '#0f766e'];
        const values = [totals.Admin, totals.Collector, totals.GCash, totals.Xendit];
        const sourceChartPalette = isDarkThemeActive()
            ? {
                tooltipBackground: 'rgba(7, 12, 24, 0.96)',
                tooltipTitle: '#f6d28b',
                tooltipBody: '#f8fafc',
                tooltipBorder: 'rgba(148, 163, 184, 0.22)',
                xGridColor: 'rgba(148, 163, 184, 0.16)',
                xTickColor: 'rgba(226, 232, 240, 0.82)',
                yTickColor: '#f8fafc'
            }
            : {
                tooltipBackground: 'rgba(255, 255, 255, 0.98)',
                tooltipTitle: '#9a6700',
                tooltipBody: '#0f172a',
                tooltipBorder: 'rgba(148, 163, 184, 0.24)',
                xGridColor: 'rgba(148, 163, 184, 0.22)',
                xTickColor: '#475569',
                yTickColor: '#334155'
            };
        const items = createBreakdownItems(labels, values, colors);
        const totalCollected = values.reduce((sum, value) => sum + value, 0);
        const topSource = items.reduce((top, item) => item.value > top.value ? item : top, items[0] || { label: 'No source', value: 0 });
        const topShare = totalCollected <= 0 ? 0 : (topSource.value / totalCollected) * 100;
        const noDataMessage = `${areaScopeLabel} has no collected payment data for ${sourceScopeLabel}.`;

        updateChartMeta({
            totalEl: sourceTotalValueEl,
            totalValue: totalCollected,
            totalFormatter: (value) => formatCurrency(value),
            breakdownEl: sourceBreakdownEl,
            breakdownItems: items,
            breakdownValueFormatter: (value) => formatCurrency(value),
            insightEl: sourceInsightEl,
            insightText: totalCollected <= 0
                ? noDataMessage
                : `${topSource.label} accounts for ${formatInsightShare(topShare)} of total collected.`
        });

        if (!channelSourceBarChartCanvas) return;
        if (typeof Chart === 'undefined') {
            ensureChartMessage(channelSourceBarChartCanvas, 'Chart library failed to load.');
            return;
        }

        destroyTrendChart('channelSourceBar');

        if (totalCollected <= 0) {
            ensureChartMessage(channelSourceBarChartCanvas, noDataMessage);
            return;
        }

        clearChartMessage(channelSourceBarChartCanvas);

        trendState.charts.channelSourceBar = new Chart(channelSourceBarChartCanvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Collected Amount',
                    data: values,
                    backgroundColor: colors,
                    borderRadius: 0,
                    borderSkipped: false,
                    maxBarThickness: 28
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        top: 22,
                        right: 12,
                        bottom: 4,
                        left: 4
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: sourceChartPalette.tooltipBackground,
                        titleColor: sourceChartPalette.tooltipTitle,
                        bodyColor: sourceChartPalette.tooltipBody,
                        borderColor: sourceChartPalette.tooltipBorder,
                        borderWidth: 1,
                        callbacks: {
                            title: (items) => items[0]?.label || '',
                            label: (context) => `Collected: ${formatCurrency(Number(context.raw) || 0)}`,
                            afterLabel: (context) => {
                                const value = Number(context.raw) || 0;
                                const share = totalCollected === 0 ? 0 : (value / totalCollected) * 100;
                                return [
                                    `Share: ${formatShare(share)}`,
                                    `Total Collected: ${formatCurrency(totalCollected)}`,
                                    `Area: ${areaScopeLabel}`,
                                    `Period: ${sourceScopeLabel}`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: sourceChartPalette.xGridColor, drawBorder: false },
                        ticks: {
                            color: sourceChartPalette.xTickColor,
                            callback: (value) => formatCompactCurrency(value)
                        }
                    },
                    y: {
                        grid: { display: false },
                        ticks: {
                            color: sourceChartPalette.yTickColor,
                            font: {
                                weight: '600'
                            }
                        }
                    }
                }
            }
        });
    }

    function renderTrendLineChart(series) {
        if (!lineChartCanvas) return;

        if (trendState.charts.line) {
            trendState.charts.line.destroy();
            trendState.charts.line = null;
        }

        const haveData = series.some((month) => {
            const balance = month?.balance;
            return (typeof balance === 'number' && balance > 0) || month.collected > 0;
        });
        if (!haveData) {
            ensureChartMessage(lineChartCanvas, 'No balance or collection activity recorded yet.');
            return;
        }

        clearChartMessage(lineChartCanvas);

        const labels = series.map(month => month.label);
        const balanceData = series.map((month) => (typeof month.balance === 'number' ? month.balance : null));
        const collectedData = series.map(month => month.collected);
        const highlightIndex = series.reduce((acc, month, index) => {
            const balance = month?.balance;
            return ((typeof balance === 'number' && balance > 0) || month.collected > 0) ? index : acc;
        }, -1);

        trendState.charts.line = new Chart(lineChartCanvas, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Balance',
                        data: balanceData,
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.12)',
                        fill: true,
                        tension: 0.35,
                        pointRadius: ctx => ctx.dataIndex === highlightIndex ? 7 : 4,
                        pointHoverRadius: 7,
                        pointBackgroundColor: ctx => ctx.dataIndex === highlightIndex ? '#2563eb' : '#ffffff',
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
                        pointRadius: ctx => ctx.dataIndex === highlightIndex ? 7 : 4,
                        pointHoverRadius: 7,
                        pointBackgroundColor: ctx => ctx.dataIndex === highlightIndex ? '#16a34a' : '#ffffff',
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
                    legend: { position: 'top', align: 'end' },
                    tooltip: {
                        callbacks: {
                            title: items => {
                                const index = items[0]?.dataIndex ?? 0;
                                return series[index]?.fullLabel || items[0]?.label || '';
                            },
                            label: context => `${context.dataset.label}: ${formatCurrency(Number(context.raw) || 0)}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(148, 163, 184, 0.25)', drawBorder: false },
                        ticks: {
                            callback: value => formatCurrency(Number(value) || 0)
                        }
                    }
                }
            }
        });
    }

    function renderTrendDailyChart(series, providedHighlightIndex) {
        if (!dailyChartCanvas) return;
        if (typeof Chart === 'undefined') {
            ensureChartMessage(dailyChartCanvas, 'Chart library failed to load.');
            return;
        }

        if (trendState.charts.daily) {
            trendState.charts.daily.destroy();
            trendState.charts.daily = null;
        }

        const haveData = Array.isArray(series) && series.some((month) => {
            const balance = month?.balance;
            return (typeof balance === 'number' && balance > 0) || (month.collected || 0) > 0;
        });
        if (!haveData) {
            ensureChartMessage(dailyChartCanvas, 'No balance or collection activity across the last 12 months.');
            return;
        }

        clearChartMessage(dailyChartCanvas);

        const labels = series.map((month) => month.label);
        const balanceData = series.map((month) => (typeof month.balance === 'number' ? month.balance : null));
        const collectedData = series.map((month) => month.collected);
        const palette = getTrendDailyChartPalette();
        const highlightIndex = Number.isInteger(providedHighlightIndex)
            ? providedHighlightIndex
            : series.reduce((acc, month, index) => {
                const balance = month?.balance;
                return ((typeof balance === 'number' && balance > 0) || (month.collected || 0) > 0) ? index : acc;
            }, -1);
        const createBarGradient = (chart, colorStops) => {
            const chartArea = chart?.chartArea;
            if (!chartArea) return colorStops[1] || colorStops[0] || '#cbd5e1';
            const gradient = chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            colorStops.forEach((color, index) => {
                const stop = colorStops.length <= 1 ? 1 : (index / (colorStops.length - 1));
                gradient.addColorStop(stop, color);
            });
            return gradient;
        };
        const tablerBackdropPlugin = {
            id: 'tablerBackdrop',
            beforeDraw(chart) {
                const chartArea = chart?.chartArea;
                if (!chartArea) return;
                const { ctx } = chart;
                const { left, top, right, bottom, width, height } = chartArea;
                ctx.save();

                const baseGradient = ctx.createLinearGradient(0, top, 0, bottom);
                baseGradient.addColorStop(0, palette.backdropStops[0]);
                baseGradient.addColorStop(0.45, palette.backdropStops[1]);
                baseGradient.addColorStop(1, palette.backdropStops[2]);
                ctx.fillStyle = baseGradient;
                ctx.fillRect(left, top, width, height);

                ctx.strokeStyle = palette.frameColor;
                ctx.lineWidth = 1;
                ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
                ctx.restore();
            }
        };

        trendState.charts.daily = new Chart(dailyChartCanvas, {
            type: 'bar',
            plugins: [tablerBackdropPlugin],
            data: {
                labels,
                datasets: [
                    {
                        label: 'Balance',
                        data: balanceData,
                        backgroundColor: (context) => createBarGradient(context.chart, context.dataIndex === highlightIndex
                            ? palette.balanceHighlightStops
                            : palette.balanceStops),
                        borderColor: (context) => context.dataIndex === highlightIndex ? palette.balanceHighlightBorder : palette.balanceBorder,
                        borderWidth: 1.25,
                        borderRadius: 0,
                        borderSkipped: false,
                        categoryPercentage: 0.58,
                        barPercentage: 0.84,
                        maxBarThickness: 30
                    },
                    {
                        label: 'Collected',
                        data: collectedData,
                        backgroundColor: (context) => createBarGradient(context.chart, context.dataIndex === highlightIndex
                            ? palette.collectedHighlightStops
                            : palette.collectedStops),
                        borderColor: (context) => context.dataIndex === highlightIndex ? palette.collectedHighlightBorder : palette.collectedBorder,
                        borderWidth: 1.25,
                        borderRadius: 0,
                        borderSkipped: false,
                        categoryPercentage: 0.58,
                        barPercentage: 0.84,
                        maxBarThickness: 30
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 950,
                    easing: 'easeOutQuart'
                },
                layout: {
                    padding: {
                        top: 16,
                        right: 12,
                        bottom: 4,
                        left: 4
                    }
                },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'end',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'rectRounded',
                            color: palette.legendColor,
                            padding: 20,
                            boxWidth: 12,
                            boxHeight: 12,
                            font: {
                                size: 12,
                                weight: '700'
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: palette.tooltipBackground,
                        titleColor: palette.tooltipTitle,
                        bodyColor: palette.tooltipBody,
                        borderColor: palette.tooltipBorder,
                        borderWidth: 1,
                        padding: 14,
                        displayColors: true,
                        callbacks: {
                            title: (items) => {
                                const index = items[0]?.dataIndex ?? 0;
                                return series[index]?.fullLabel || items[0]?.label || '';
                            },
                            label: (context) => `${context.dataset.label}: ${formatCurrency(Number(context.raw) || 0)}`
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: false,
                        grid: { display: false },
                        ticks: {
                            color: palette.xTickColor,
                            maxRotation: 0,
                            autoSkip: false,
                            maxTicksLimit: 12,
                            font: {
                                weight: '600'
                            }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        border: { display: false },
                        grid: {
                            color: palette.yGridColor,
                            drawBorder: false
                        },
                        ticks: {
                            color: palette.yTickColor,
                            callback: (value) => formatCompactCurrency(Number(value) || 0)
                        }
                    }
                }
            }
        });
    }

    function renderTrendChannelsChart(payments, year) {
        if (!channelsChartCanvas) return;

        if (trendState.charts.channels) {
            trendState.charts.channels.destroy();
            trendState.charts.channels = null;
        }

        const channelTotals = new Map();
        Object.values(payments || {}).forEach(account => {
            (account.history || []).forEach(entry => {
                const amount = Number(entry.amount) || 0;
                if (!amount) return;
                const timestamp = safeDate(entry.recordedAt || entry.date);
                if (!timestamp || timestamp.getFullYear() !== year) return;
                if ((entry.direction || '').toLowerCase() !== 'credit') return;

                const channel = (entry.method || entry.channel || 'Unspecified').toString().trim();
                channelTotals.set(channel, (channelTotals.get(channel) || 0) + amount);
            });
        });

        const entries = Array.from(channelTotals.entries()).filter(([, value]) => value > 0);
        if (!entries.length) {
            ensureChartMessage(channelsChartCanvas, 'No payment channel activity recorded.');
            return;
        }

        clearChartMessage(channelsChartCanvas);

        const labels = entries.map(([label]) => label);
        const data = entries.map(([, value]) => value);
        const palette = ['#2563eb', '#16a34a', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#14b8a6'];

        trendState.charts.channels = new Chart(channelsChartCanvas, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: data.map((_, index) => palette[index % palette.length]),
                    borderColor: '#ffffff',
                    borderWidth: 2,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { usePointStyle: true, padding: 18 }
                    },
                    tooltip: {
                        callbacks: {
                            label: context => {
                                const value = Number(context.raw) || 0;
                                const total = data.reduce((sum, v) => sum + v, 0);
                                const percentage = total === 0 ? 0 : (value / total) * 100;
                                return `${context.label}: ${formatCurrency(value)} (${percentage.toFixed(1)}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    function refreshTrend() {
        const { months, highlightIndex, payingAccounts } = buildMonthlySeries(trendState.payments, trendState.year);
        trendState.series = months;

        updateTrendKPIs(months, highlightIndex, payingAccounts);
        updateTrendDailyLuxurySummary(months, highlightIndex);
        renderTrendLineChart(months);
        renderTrendChannelsChart(trendState.payments, trendState.year);

        renderTrendDailyChart(months, highlightIndex);
        renderBalancePieChart(trendState.customers, trendState.payments);
        renderStatusPieChart(trendState.customers);
        updateTrendSourceCopy(getSelectedArea(), trendState.sourceMonth);
        renderPaymentSourceBarChart(trendState.payments, trendState.year, trendState.sourceMonth);
    }

    function applyDashboardAreaFilter() {
        const selectedArea = getSelectedArea();
        const filteredCustomers = filterCustomersByArea(trendState.sourceCustomers, selectedArea);
        const filteredPayments = filterPaymentsByArea(trendState.sourcePayments, filteredCustomers, selectedArea);

        trendState.region = selectedArea || 'all';
        trendState.customers = filteredCustomers;
        trendState.payments = filteredPayments;

        updateTrendScopeCopy(selectedArea, filteredCustomers);
        updateHeroMetrics(filteredCustomers, trendState.sourcePlans, filteredPayments);
        renderPaymentHistory(filteredPayments, filteredCustomers);
        refreshTrend();
    }

    async function updateDashboard() {
        const [customers, plans, payments] = await Promise.all([
            fetchCustomers(),
            fetchPlans(),
            fetchPayments()
        ]);

        trendState.sourceCustomers = Array.isArray(customers) ? customers : [];
        trendState.sourcePlans = plans || { prepaid: [], postpaid: [] };
        trendState.sourcePayments = payments || {};

        populateTrendAreaOptions(trendState.sourceCustomers);
        populateTrendSourceMonthOptions();
        applyDashboardAreaFilter();
    }

    trendAreaFilters.forEach((filter) => {
        filter.addEventListener('change', (event) => {
            const nextValue = String(event?.target?.value || '').trim();
            syncTrendAreaFilters(nextValue, event.target);
            applyDashboardAreaFilter();
        });
    });

    trendSourceMonthFilter?.addEventListener('change', (event) => {
        trendState.sourceMonth = String(event?.target?.value || '').trim();
        refreshTrend();
    });

    balanceBreakdownEl?.addEventListener('click', (event) => {
        const item = event.target.closest('[data-balance-bucket]');
        if (!item) return;
        toggleBalanceBucketDetail(item.getAttribute('data-balance-bucket'));
    });

    balanceBreakdownEl?.addEventListener('keydown', (event) => {
        const item = event.target.closest('[data-balance-bucket]');
        if (!item) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleBalanceBucketDetail(item.getAttribute('data-balance-bucket'));
    });

    balanceDetailCloseBtn?.addEventListener('click', () => {
        hideBalanceBucketDetail();
    });

    window.addEventListener('themechange', () => {
        if (!hasTrendSourceData()) return;
        refreshTrend();
    });

    updateDashboard();
});
