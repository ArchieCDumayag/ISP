document.addEventListener('DOMContentLoaded', () => {
    const API_ROOT = '/api/referrals';
    const state = {
        items: [],
        metrics: {},
        loading: false
    };

    const els = {
        refresh: document.getElementById('refreshReferralsBtn'),
        search: document.getElementById('referralSearchInput'),
        statusFilter: document.getElementById('referralStatusFilter'),
        sourceFilter: document.getElementById('referralSourceFilter'),
        tableBody: document.getElementById('referralTableBody'),
        summary: document.getElementById('referralSummary'),
        metricTotal: document.getElementById('metricReferralTotal'),
        metricSuccessful: document.getElementById('metricReferralSuccessful'),
        metricWaiting: document.getElementById('metricReferralWaiting'),
        metricDiscount: document.getElementById('metricReferralDiscount')
    };

    const currencyFormatter = new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const countFormatter = new Intl.NumberFormat('en-PH');
    const dateFormatter = new Intl.DateTimeFormat('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
    const monthFormatter = new Intl.DateTimeFormat('en-PH', {
        month: 'short',
        year: 'numeric'
    });

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const normalizeText = (value) => String(value || '').trim().toLowerCase();
    const formatCurrency = (value) => currencyFormatter.format(Number(value) || 0);
    const formatCount = (value) => countFormatter.format(Number(value) || 0);
    const parseDate = (value) => {
        const text = String(value || '').trim();
        if (!text) return null;
        const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
            const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            return Number.isNaN(date.getTime()) ? null : date;
        }
        const date = new Date(text);
        return Number.isNaN(date.getTime()) ? null : date;
    };
    const formatDate = (value, fallback = '-') => {
        const date = parseDate(value);
        return date ? dateFormatter.format(date) : fallback;
    };
    const formatMonth = (value, fallback = '-') => {
        const text = String(value || '').trim();
        const match = text.match(/^(\d{4})-(\d{2})$/);
        if (match) {
            const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
            return Number.isNaN(date.getTime()) ? fallback : monthFormatter.format(date);
        }
        return formatDate(value, fallback);
    };

    const showToast = (message, type = 'info') => {
        if (typeof window.appToast === 'function') {
            window.appToast(message, { type });
            return;
        }
        window.alert(message);
    };

    async function fetchJSON(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'include',
            cache: 'no-store',
            ...options
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401) {
            try {
                sessionStorage.setItem('next', 'referrals.html');
            } catch {
                // Keep redirect behavior even when storage is blocked.
            }
            window.location.href = 'login.html';
            throw new Error('Please log in again.');
        }
        if (!response.ok) {
            throw new Error(payload?.error || payload?.message || `Request failed: ${response.status}`);
        }
        return payload;
    }

    const sourceMeta = (sourceType = '') => {
        const normalized = normalizeText(sourceType) || 'external';
        if (normalized === 'customer') return { label: 'Customer', className: 'is-customer' };
        if (normalized === 'agent') return { label: 'Agent', className: 'is-agent' };
        return { label: 'External', className: 'is-external' };
    };

    const statusMeta = (status = '') => {
        const normalized = normalizeText(status) || 'pending';
        if (normalized === 'successful') return { label: 'Successful', className: 'is-successful' };
        if (normalized === 'waiting-payment') return { label: 'Waiting payment', className: 'is-waiting-payment' };
        return { label: 'Pending', className: 'is-pending' };
    };

    const getFilteredItems = () => {
        const query = normalizeText(els.search?.value);
        const status = normalizeText(els.statusFilter?.value);
        const source = normalizeText(els.sourceFilter?.value);
        return state.items.filter((item) => {
            if (status && normalizeText(item.status) !== status) return false;
            if (source && normalizeText(item.sourceType) !== source) return false;
            if (!query) return true;
            const haystack = [
                item.referrerAccountNumber,
                item.referrerName,
                item.referrerId,
                item.referredAccountNumber,
                item.referredName,
                item.referredPlanName,
                item.statusLabel
            ].map(normalizeText).join(' ');
            return haystack.includes(query);
        });
    };

    const renderMetrics = (metrics = {}) => {
        if (els.metricTotal) els.metricTotal.textContent = formatCount(metrics.total);
        if (els.metricSuccessful) els.metricSuccessful.textContent = formatCount(metrics.successful);
        if (els.metricWaiting) els.metricWaiting.textContent = formatCount(metrics.waitingPayment);
        if (els.metricDiscount) els.metricDiscount.textContent = formatCurrency(metrics.discountValue);
    };

    const renderActions = (item = {}) => {
        const referredAccount = String(item.referredAccountNumber || '').trim();
        const referrerAccount = String(item.referrerAccountNumber || '').trim();
        const referredHref = referredAccount
            ? `payment-breakdown.html?account=${encodeURIComponent(referredAccount)}`
            : '#';
        const referrerHref = referrerAccount
            ? `payment-breakdown.html?account=${encodeURIComponent(referrerAccount)}`
            : '#';
        return `
            <div class="referral-actions">
                <a class="btn btn-sm btn-outline-secondary${referredAccount ? '' : ' disabled'}" href="${referredHref}" aria-disabled="${referredAccount ? 'false' : 'true'}">
                    <i class="ti ti-user" aria-hidden="true"></i>
                    Referred
                </a>
                <a class="btn btn-sm btn-outline-primary${referrerAccount ? '' : ' disabled'}" href="${referrerHref}" aria-disabled="${referrerAccount ? 'false' : 'true'}">
                    <i class="ti ti-gift" aria-hidden="true"></i>
                    Discount
                </a>
            </div>
        `;
    };

    const renderRows = () => {
        if (!els.tableBody) return;
        const items = getFilteredItems();
        if (!items.length) {
            els.tableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="referral-empty">${state.loading ? 'Loading referrals...' : 'No referrals found.'}</td>
                </tr>
            `;
            if (els.summary) els.summary.textContent = state.loading ? 'Loading...' : 'No records match the current filters.';
            return;
        }

        els.tableBody.innerHTML = items.map((item) => {
            const source = sourceMeta(item.sourceType);
            const status = statusMeta(item.status);
            const discountAmount = item.discountEligible ? Number(item.discountAmount) || 0 : 0;
            const discountMeta = item.discountEligible
                ? 'Applies to referrer bill'
                : (normalizeText(item.sourceType) === 'agent' ? 'Agent referral' : 'Not eligible yet');
            return `
                <tr>
                    <td>
                        <span class="referral-person">
                            <strong>${escapeHtml(item.referrerName || 'Unknown referrer')}</strong>
                            <small>${escapeHtml(item.referrerAccountNumber || item.referrerId || '-')}</small>
                        </span>
                    </td>
                    <td>
                        <span class="referral-person">
                            <strong>${escapeHtml(item.referredName || 'Unnamed customer')}</strong>
                            <small>${escapeHtml(item.referredAccountNumber || '-')} &middot; ${escapeHtml(item.referredPlanName || '-')}</small>
                        </span>
                    </td>
                    <td><span class="referral-source ${source.className}">${source.label}</span></td>
                    <td>
                        <span class="referral-date-cell">
                            <strong>${escapeHtml(formatMonth(item.eligibleMonth))}</strong>
                            <small>${escapeHtml(formatDate(item.referredActivationDate, 'No activation'))}</small>
                        </span>
                    </td>
                    <td>${escapeHtml(formatDate(item.firstBillAt))}</td>
                    <td>
                        <span class="referral-date-cell">
                            <strong>${escapeHtml(formatDate(item.successAt))}</strong>
                            <small>${item.paymentAmount ? escapeHtml(formatCurrency(item.paymentAmount)) : '-'}</small>
                        </span>
                    </td>
                    <td class="is-num">
                        <span class="referral-discount-cell">
                            <strong>${escapeHtml(formatCurrency(discountAmount))}</strong>
                            <small>${escapeHtml(discountMeta)}</small>
                        </span>
                    </td>
                    <td><span class="referral-status ${status.className}">${status.label}</span></td>
                    <td>${renderActions(item)}</td>
                </tr>
            `;
        }).join('');

        const successful = items.filter((item) => normalizeText(item.status) === 'successful').length;
        const waiting = items.filter((item) => normalizeText(item.status) === 'waiting-payment').length;
        if (els.summary) {
            els.summary.textContent = `${formatCount(items.length)} shown. ${formatCount(successful)} successful. ${formatCount(waiting)} waiting payment.`;
        }
    };

    const setLoading = (loading) => {
        state.loading = Boolean(loading);
        if (els.refresh) {
            els.refresh.disabled = state.loading;
            els.refresh.innerHTML = state.loading
                ? '<i class="ti ti-loader-2" aria-hidden="true"></i> Loading'
                : '<i class="ti ti-refresh" aria-hidden="true"></i> Refresh';
        }
    };

    async function loadReferrals() {
        setLoading(true);
        renderRows();
        try {
            const payload = await fetchJSON(API_ROOT);
            state.items = Array.isArray(payload.items) ? payload.items : [];
            state.metrics = payload.metrics || {};
            renderMetrics(state.metrics);
            renderRows();
        } catch (error) {
            console.error('Failed to load referrals:', error);
            showToast(error.message || 'Failed to load referrals.', 'error');
            state.items = [];
            state.metrics = {};
            renderMetrics(state.metrics);
            renderRows();
        } finally {
            setLoading(false);
        }
    }

    els.refresh?.addEventListener('click', () => {
        void loadReferrals();
    });
    [els.search, els.statusFilter, els.sourceFilter].forEach((el) => {
        el?.addEventListener('input', renderRows);
        el?.addEventListener('change', renderRows);
    });

    void loadReferrals();
});
