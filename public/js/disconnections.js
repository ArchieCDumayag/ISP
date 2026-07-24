document.addEventListener('DOMContentLoaded', () => {
    const API_ROOT = '/api/disconnections';
    const state = {
        items: [],
        loading: false,
        selected: null
    };

    const els = {
        refresh: document.getElementById('refreshDisconnectionsBtn'),
        search: document.getElementById('disconnectionSearchInput'),
        statusFilter: document.getElementById('statusFilter'),
        policyFilter: document.getElementById('policyFilter'),
        tableBody: document.getElementById('disconnectionTableBody'),
        summary: document.getElementById('disconnectionSummary'),
        metricPending: document.getElementById('metricPending'),
        metricDisconnected: document.getElementById('metricDisconnected'),
        metricKeptActive: document.getElementById('metricKeptActive'),
        metricOverAmount: document.getElementById('metricOverAmount'),
        modal: document.getElementById('disconnectModal'),
        form: document.getElementById('disconnectForm'),
        accountInput: document.getElementById('disconnectAccountNumber'),
        modalSubtitle: document.getElementById('disconnectModalSubtitle'),
        snapshot: document.getElementById('disconnectSnapshot'),
        notes: document.getElementById('disconnectNotes'),
        confirm: document.getElementById('confirmDisconnectBtn')
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

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const normalizeText = (value) => String(value || '').trim().toLowerCase();
    const formatCurrency = (value) => currencyFormatter.format(Number(value) || 0);
    const formatCount = (value) => countFormatter.format(Number(value) || 0);
    const formatDate = (value, fallback = '-') => {
        if (!value) return fallback;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return fallback;
        return dateFormatter.format(date);
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
                sessionStorage.setItem('next', 'disconnections.html');
            } catch {
                // Ignore storage failures and still send the user to login.
            }
            window.location.href = 'login.html';
            throw new Error('Please log in again.');
        }
        if (!response.ok) {
            throw new Error(payload?.error || payload?.message || `Request failed: ${response.status}`);
        }
        return payload;
    }

    const statusMeta = (status = '') => {
        const normalized = normalizeText(status) || 'pending';
        if (normalized === 'disconnected') return { label: 'Disconnected', className: 'is-disconnected' };
        if (normalized === 'kept-active') return { label: 'Kept active', className: 'is-kept-active' };
        return { label: 'Needs decision', className: 'is-pending' };
    };

    const policyMeta = (policy = '', status = '') => {
        const normalizedStatus = normalizeText(status);
        if (normalizedStatus === 'pending') {
            return { label: 'Choose on disconnect', className: 'is-pending' };
        }
        if (normalizedStatus === 'kept-active') {
            return { label: 'Not disconnected', className: 'is-neutral' };
        }
        const normalized = normalizeText(policy);
        if (normalized === 'continue') return { label: 'Continue billing', className: 'is-continue' };
        return { label: 'Stop next month', className: 'is-stop' };
    };

    const getFilteredItems = () => {
        const query = normalizeText(els.search?.value);
        const status = normalizeText(els.statusFilter?.value);
        const policy = normalizeText(els.policyFilter?.value);
        return state.items.filter((item) => {
            if (status && normalizeText(item.status) !== status) return false;
            if (policy && (normalizeText(item.status) !== 'disconnected' || normalizeText(item.billingPolicy) !== policy)) return false;
            if (!query) return true;
            const haystack = [
                item.accountNumber,
                item.name,
                item.area,
                item.planName,
                item.pppoeUsername,
                item.mobile
            ].map(normalizeText).join(' ');
            return haystack.includes(query);
        });
    };

    const renderMetrics = (metrics = {}) => {
        if (els.metricPending) els.metricPending.textContent = formatCount(metrics.pending);
        if (els.metricDisconnected) els.metricDisconnected.textContent = formatCount(metrics.disconnected);
        if (els.metricKeptActive) els.metricKeptActive.textContent = formatCount(metrics.keptActive);
        if (els.metricOverAmount) els.metricOverAmount.textContent = formatCurrency(metrics.totalOverAmount);
    };

    const renderActions = (item) => {
        const account = escapeHtml(item.accountNumber);
        const breakdownHref = `payment-breakdown.html?account=${encodeURIComponent(item.accountNumber)}`;
        const status = normalizeText(item.status);
        if (status === 'disconnected') {
            const nextPolicy = normalizeText(item.billingPolicy) === 'continue' ? 'stop' : 'continue';
            const nextLabel = nextPolicy === 'continue' ? 'Continue Billing' : 'Stop Billing';
            const nextIcon = nextPolicy === 'continue' ? 'ti-repeat' : 'ti-calendar-off';
            return `
                <div class="disconnection-actions">
                    <a class="btn btn-sm btn-outline-secondary" href="${breakdownHref}">
                        <i class="ti ti-list-details" aria-hidden="true"></i>
                        Breakdown
                    </a>
                    <button type="button" class="btn btn-sm btn-outline-primary" data-action="policy" data-policy="${nextPolicy}" data-account="${account}">
                        <i class="ti ${nextIcon}" aria-hidden="true"></i>
                        ${nextLabel}
                    </button>
                </div>
            `;
        }
        return `
            <div class="disconnection-actions">
                <button type="button" class="btn btn-sm btn-outline-secondary" data-action="keep-active" data-account="${account}">
                    <i class="ti ti-user-check" aria-hidden="true"></i>
                    Keep Active
                </button>
                <button type="button" class="btn btn-sm btn-danger" data-action="disconnect" data-account="${account}">
                    <i class="ti ti-plug-off" aria-hidden="true"></i>
                    Disconnect
                </button>
            </div>
        `;
    };

    const renderRows = () => {
        if (!els.tableBody) return;
        const items = getFilteredItems();
        if (!items.length) {
            els.tableBody.innerHTML = `
                <tr>
                    <td colspan="10" class="disconnection-empty">${state.loading ? 'Loading disconnections...' : 'No accounts found.'}</td>
                </tr>
            `;
            if (els.summary) els.summary.textContent = state.loading ? 'Loading...' : 'No records match the current filters.';
            return;
        }

        els.tableBody.innerHTML = items.map((item) => {
            const status = statusMeta(item.status);
            const policy = policyMeta(item.billingPolicy, item.status);
            const warning = item.pppoeWarning ? `<small>${escapeHtml(item.pppoeWarning)}</small>` : '';
            return `
                <tr>
                    <td>
                        <span class="disconnection-account">
                            <strong>${escapeHtml(item.accountNumber)}</strong>
                            <small>${escapeHtml(item.area || 'No area')}</small>
                        </span>
                    </td>
                    <td>
                        <span class="disconnection-subscriber">
                            <strong>${escapeHtml(item.name)}</strong>
                            <small>${escapeHtml(item.mobile || '-')}</small>
                        </span>
                    </td>
                    <td>
                        <span class="disconnection-plan">
                            <strong>${escapeHtml(item.planName || '-')}</strong>
                            <small>${escapeHtml(item.planCategory || 'postpaid')} monthly</small>
                        </span>
                    </td>
                    <td class="is-num">${formatCurrency(item.balance)}</td>
                    <td class="is-num">${formatCurrency(item.creditLimit)}</td>
                    <td class="is-num">${formatCurrency(item.overAmount)}</td>
                    <td><span class="disconnection-status ${status.className}">${status.label}</span></td>
                    <td><span class="disconnection-policy ${policy.className}">${policy.label}</span></td>
                    <td>
                        <span class="disconnection-pppoe">
                            <strong>${escapeHtml(item.pppoeUsername || '-')}</strong>
                            ${warning}
                        </span>
                    </td>
                    <td>${renderActions(item)}</td>
                </tr>
            `;
        }).join('');

        const pending = items.filter((item) => normalizeText(item.status) === 'pending').length;
        const disconnected = items.filter((item) => normalizeText(item.status) === 'disconnected').length;
        if (els.summary) {
            els.summary.textContent = `${formatCount(items.length)} shown. ${formatCount(pending)} needs decision. ${formatCount(disconnected)} disconnected.`;
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

    async function loadDisconnections() {
        setLoading(true);
        renderRows();
        try {
            const payload = await fetchJSON(API_ROOT);
            state.items = Array.isArray(payload.items) ? payload.items : [];
            renderMetrics(payload.metrics || {});
            renderRows();
        } catch (error) {
            console.error('Failed to load disconnections:', error);
            showToast(error.message || 'Failed to load disconnections.', 'error');
            state.items = [];
            renderMetrics({});
            renderRows();
        } finally {
            setLoading(false);
        }
    }

    const findItem = (accountNumber = '') => state.items.find((item) => (
        String(item.accountNumber || '') === String(accountNumber || '')
    )) || null;

    const closeModal = () => {
        if (!els.modal) return;
        els.modal.classList.remove('show');
        els.modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        state.selected = null;
    };

    const openDisconnectModal = (item) => {
        if (!item || !els.modal) return;
        state.selected = item;
        if (els.accountInput) els.accountInput.value = item.accountNumber;
        if (els.modalSubtitle) {
            els.modalSubtitle.textContent = `${item.name} (${item.accountNumber})`;
        }
        if (els.snapshot) {
            els.snapshot.innerHTML = `
                <span class="disconnect-snapshot__item">
                    <span>Ending Balance</span>
                    <strong>${formatCurrency(item.balance)}</strong>
                </span>
                <span class="disconnect-snapshot__item">
                    <span>Credit Limit</span>
                    <strong>${formatCurrency(item.creditLimit)}</strong>
                </span>
                <span class="disconnect-snapshot__item">
                    <span>Over</span>
                    <strong>${formatCurrency(item.overAmount)}</strong>
                </span>
            `;
        }
        if (els.notes) els.notes.value = item.notes || '';
        const policy = normalizeText(item.billingPolicy) === 'continue' ? 'continue' : 'stop';
        const radio = els.form?.querySelector(`input[name="billingPolicy"][value="${policy}"]`);
        if (radio) radio.checked = true;
        els.modal.classList.add('show');
        els.modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
    };

    async function keepActive(accountNumber) {
        const item = findItem(accountNumber);
        if (!item) return;
        const confirmed = typeof window.appConfirm === 'function'
            ? await window.appConfirm(`Keep ${item.name} active?`, {
                title: 'Keep Active',
                okText: 'Keep Active',
                cancelText: 'Cancel'
            })
            : window.confirm(`Keep ${item.name} active?`);
        if (!confirmed) return;
        await fetchJSON(`${API_ROOT}/${encodeURIComponent(accountNumber)}/keep-active`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: '' })
        });
        showToast('Customer kept active.', 'success');
        await loadDisconnections();
    }

    async function updateBillingPolicy(accountNumber, billingPolicy) {
        const item = findItem(accountNumber);
        if (!item) return;
        const label = billingPolicy === 'continue' ? 'continue billing' : 'stop billing next month';
        const confirmed = typeof window.appConfirm === 'function'
            ? await window.appConfirm(`Set ${item.name} to ${label}?`, {
                title: 'Update Billing',
                okText: 'Update',
                cancelText: 'Cancel'
            })
            : window.confirm(`Set ${item.name} to ${label}?`);
        if (!confirmed) return;
        await fetchJSON(`${API_ROOT}/${encodeURIComponent(accountNumber)}/billing-policy`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ billingPolicy })
        });
        showToast('Billing policy updated.', 'success');
        await loadDisconnections();
    }

    async function submitDisconnect(event) {
        event.preventDefault();
        const accountNumber = String(els.accountInput?.value || '').trim();
        if (!accountNumber) return;
        const billingPolicy = els.form?.querySelector('input[name="billingPolicy"]:checked')?.value || 'stop';
        const notes = els.notes?.value || '';
        if (els.confirm) {
            els.confirm.disabled = true;
            els.confirm.innerHTML = '<i class="ti ti-loader-2" aria-hidden="true"></i> Disconnecting';
        }
        try {
            const payload = await fetchJSON(`${API_ROOT}/${encodeURIComponent(accountNumber)}/disconnect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ billingPolicy, notes })
            });
            closeModal();
            showToast(payload.warning || 'Customer disconnected.', payload.warning ? 'warning' : 'success');
            await loadDisconnections();
        } catch (error) {
            showToast(error.message || 'Failed to disconnect customer.', 'error');
        } finally {
            if (els.confirm) {
                els.confirm.disabled = false;
                els.confirm.innerHTML = '<i class="ti ti-plug-off" aria-hidden="true"></i> Disconnect';
            }
        }
    }

    els.refresh?.addEventListener('click', () => {
        void loadDisconnections();
    });
    [els.search, els.statusFilter, els.policyFilter].forEach((el) => {
        el?.addEventListener('input', renderRows);
        el?.addEventListener('change', renderRows);
    });
    els.tableBody?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-action][data-account]');
        if (!button) return;
        const accountNumber = button.dataset.account || '';
        const action = button.dataset.action || '';
        if (action === 'disconnect') {
            openDisconnectModal(findItem(accountNumber));
        } else if (action === 'keep-active') {
            void keepActive(accountNumber);
        } else if (action === 'policy') {
            void updateBillingPolicy(accountNumber, button.dataset.policy || 'stop');
        }
    });
    els.form?.addEventListener('submit', submitDisconnect);
    document.querySelectorAll('[data-close-disconnect]').forEach((button) => {
        button.addEventListener('click', closeModal);
    });
    els.modal?.addEventListener('click', (event) => {
        if (event.target === els.modal) closeModal();
    });
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && els.modal?.classList.contains('show')) {
            closeModal();
        }
    });

    void loadDisconnections();
});
