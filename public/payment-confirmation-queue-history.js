document.addEventListener('DOMContentLoaded', () => {
    const accountFilter = document.getElementById('queueHistoryAccountFilter');
    const approvedSwitchBtn = document.getElementById('historyApprovedSwitchBtn');
    const rejectedSwitchBtn = document.getElementById('historyRejectedSwitchBtn');
    const approvedView = document.getElementById('historyApprovedView');
    const rejectedView = document.getElementById('historyRejectedView');
    const approvedBody = document.getElementById('historyApprovedTableBody');
    const rejectedBody = document.getElementById('historyRejectedTableBody');

    const state = {
        loading: false,
        accountNumber: '',
        activeView: 'approved'
    };

    const notify = (message, type = 'info') => {
        if (typeof window.appToast === 'function') {
            window.appToast(message, { type });
            return;
        }
        if (type === 'error') {
            alert(message);
        }
    };

    const escapeHtml = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const formatDateTime = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '-';
        const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
        if (Number.isNaN(parsed.getTime())) return raw;
        return parsed.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatCurrency = (value) => {
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount <= 0) return '-';
        return new Intl.NumberFormat('en-PH', {
            style: 'currency',
            currency: 'PHP',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(amount);
    };

    const setLoading = (loading) => {
        state.loading = loading;
        if (approvedSwitchBtn) approvedSwitchBtn.disabled = loading;
        if (rejectedSwitchBtn) rejectedSwitchBtn.disabled = loading;
    };

    const applyAccountFilterAndFetch = () => {
        state.accountNumber = String(accountFilter?.value || '').trim();
        fetchActiveView();
    };

    const buildQueryString = (status) => {
        const params = new URLSearchParams();
        params.set('status', status);
        params.set('limit', '200');
        params.set('offset', '0');
        if (state.accountNumber) params.set('accountNumber', state.accountNumber);
        return params.toString();
    };

    const fetchHistoryRows = async (status) => {
        const response = await fetch(`/api/payment-confirmations?${buildQueryString(status)}`, {
            credentials: 'include',
            cache: 'no-store'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Failed to load ${status} history.`);
        }
        return Array.isArray(data.items) ? data.items : [];
    };

    const renderEmpty = (target, message) => {
        if (!target) return;
        target.innerHTML = `
            <tr>
                <td colspan="6" class="history-empty">${escapeHtml(message || 'No records found.')}</td>
            </tr>
        `;
    };

    const renderApprovedRows = (rows) => {
        if (!approvedBody) return;
        const items = Array.isArray(rows) ? rows : [];
        if (!items.length) {
            renderEmpty(approvedBody, 'No approved requests found.');
            return;
        }

        approvedBody.innerHTML = items.map((item) => {
            const customerName = String(item.customerName || '').trim() || 'Unknown customer';
            const accountNumber = String(item.accountNumber || '').trim();
            const customerCell = accountNumber
                ? `<div class="history-customer-name">${escapeHtml(customerName)}</div><div class="history-submeta">Acct: ${escapeHtml(accountNumber)}</div>`
                : `<div class="history-customer-name">${escapeHtml(customerName)}</div>`;
            const amount = formatCurrency(Number(item.reviewedAmount ?? item.amount));
            const reference = String(item.reviewedReference || item.reference || '').trim() || '-';
            const proofUrl = String(item.proofUrl || '').trim();
            const proofCell = proofUrl
                ? `<a class="history-proof-thumb-link" href="${escapeHtml(proofUrl)}" target="_blank" rel="noopener">
                        <img class="history-proof-thumb" src="${escapeHtml(proofUrl)}" alt="Approved proof image">
                   </a>`
                : '<span class="history-empty-inline">No image</span>';

            return `
                <tr>
                    <td>${customerCell}</td>
                    <td>${escapeHtml(formatDateTime(item.submittedAt))}</td>
                    <td>${escapeHtml(formatDateTime(item.reviewedAt))}</td>
                    <td class="history-amount-cell">${escapeHtml(amount)}</td>
                    <td class="history-ref-cell">${escapeHtml(reference)}</td>
                    <td>${proofCell}</td>
                </tr>
            `;
        }).join('');
    };

    const renderRejectedRows = (rows) => {
        if (!rejectedBody) return;
        const items = Array.isArray(rows) ? rows : [];
        if (!items.length) {
            renderEmpty(rejectedBody, 'No rejected requests found.');
            return;
        }

        rejectedBody.innerHTML = items.map((item) => {
            const customerName = String(item.customerName || '').trim() || 'Unknown customer';
            const accountNumber = String(item.accountNumber || '').trim();
            const customerCell = accountNumber
                ? `<div class="history-customer-name">${escapeHtml(customerName)}</div><div class="history-submeta">Acct: ${escapeHtml(accountNumber)}</div>`
                : `<div class="history-customer-name">${escapeHtml(customerName)}</div>`;
            const amount = formatCurrency(Number(item.reviewedAmount ?? item.amount));
            const reason = String(item.decisionReason || '').trim() || '-';
            const proofUrl = String(item.proofUrl || '').trim();
            const proofCell = proofUrl
                ? `<a class="history-proof-thumb-link" href="${escapeHtml(proofUrl)}" target="_blank" rel="noopener">
                        <img class="history-proof-thumb" src="${escapeHtml(proofUrl)}" alt="Rejected proof image">
                   </a>`
                : '<span class="history-empty-inline">No image</span>';

            return `
                <tr>
                    <td>${customerCell}</td>
                    <td>${escapeHtml(formatDateTime(item.submittedAt))}</td>
                    <td>${escapeHtml(formatDateTime(item.reviewedAt))}</td>
                    <td class="history-amount-cell">${escapeHtml(amount)}</td>
                    <td><p class="history-reason-cell">${escapeHtml(reason)}</p></td>
                    <td>${proofCell}</td>
                </tr>
            `;
        }).join('');
    };

    const setActiveView = (view, options = {}) => {
        const target = String(view || '').trim().toLowerCase() === 'rejected' ? 'rejected' : 'approved';
        const skipFetch = Boolean(options.skipFetch);
        state.activeView = target;

        if (approvedView) approvedView.style.display = target === 'approved' ? '' : 'none';
        if (rejectedView) rejectedView.style.display = target === 'rejected' ? '' : 'none';
        approvedSwitchBtn?.classList.toggle('active', target === 'approved');
        rejectedSwitchBtn?.classList.toggle('active', target === 'rejected');
        approvedSwitchBtn?.setAttribute('aria-pressed', target === 'approved' ? 'true' : 'false');
        rejectedSwitchBtn?.setAttribute('aria-pressed', target === 'rejected' ? 'true' : 'false');

        if (!skipFetch) {
            fetchActiveView();
        }
    };

    const fetchActiveView = async () => {
        const status = state.activeView === 'rejected' ? 'rejected' : 'approved';
        setLoading(true);
        try {
            const rows = await fetchHistoryRows(status);
            if (status === 'approved') {
                renderApprovedRows(rows);
            } else {
                renderRejectedRows(rows);
            }
        } catch (error) {
            const message = error?.message || 'Unable to load payment queue history.';
            if (status === 'approved') {
                renderEmpty(approvedBody, message);
            } else {
                renderEmpty(rejectedBody, message);
            }
            notify(message, 'error');
        } finally {
            setLoading(false);
        }
    };

    accountFilter?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        applyAccountFilterAndFetch();
    });

    accountFilter?.addEventListener('search', () => {
        applyAccountFilterAndFetch();
    });

    accountFilter?.addEventListener('change', () => {
        applyAccountFilterAndFetch();
    });

    approvedSwitchBtn?.addEventListener('click', () => {
        if (state.activeView === 'approved') return;
        setActiveView('approved');
    });

    rejectedSwitchBtn?.addEventListener('click', () => {
        if (state.activeView === 'rejected') return;
        setActiveView('rejected');
    });

    const initialView = new URLSearchParams(window.location.search).get('view');
    setActiveView(initialView === 'rejected' ? 'rejected' : 'approved', { skipFetch: true });
    fetchActiveView();
});
