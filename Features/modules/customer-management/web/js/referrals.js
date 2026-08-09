document.addEventListener('DOMContentLoaded', () => {
    const API_ROOT = '/api/referrals';
    const state = {
        items: [],
        metrics: {},
        customers: [],
        agents: [],
        loading: false,
        saving: false,
        page: 1,
        pageSize: 10,
        editingReferralId: '',
        statusAction: null
    };

    const els = {
        create: document.getElementById('createReferralBtn'),
        refresh: document.getElementById('refreshReferralsBtn'),
        search: document.getElementById('referralSearchInput'),
        statusFilter: document.getElementById('referralStatusFilter'),
        sourceFilter: document.getElementById('referralSourceFilter'),
        clearFilters: document.getElementById('referralClearFilters'),
        tableBody: document.getElementById('referralTableBody'),
        summary: document.getElementById('referralSummary'),
        pagination: document.getElementById('referralPagination'),
        prevPage: document.getElementById('referralPrevPage'),
        nextPage: document.getElementById('referralNextPage'),
        pageIndicator: document.getElementById('referralPageIndicator'),
        metricTotal: document.getElementById('metricReferralTotal'),
        metricEligible: document.getElementById('metricReferralSuccessful'),
        metricPending: document.getElementById('metricReferralWaiting'),
        metricDiscount: document.getElementById('metricReferralDiscount'),
        createModal: document.getElementById('referralCreateModal'),
        createClose: document.getElementById('closeReferralCreateModal'),
        createCancel: document.getElementById('cancelReferralCreate'),
        createForm: document.getElementById('referralCreateForm'),
        createTitle: document.getElementById('referralCreateTitle'),
        createSave: document.getElementById('saveReferralCreate'),
        referredCustomer: document.getElementById('referralReferredCustomer'),
        createSourceType: document.getElementById('referralCreateSourceType'),
        createCustomerField: document.getElementById('referralCreateCustomerField'),
        createCustomer: document.getElementById('referralCreateCustomer'),
        createAgentField: document.getElementById('referralCreateAgentField'),
        createAgent: document.getElementById('referralCreateAgent'),
        createReason: document.getElementById('referralCreateReason'),
        statusModal: document.getElementById('referralStatusModal'),
        statusClose: document.getElementById('closeReferralStatusModal'),
        statusCancel: document.getElementById('cancelReferralStatus'),
        statusForm: document.getElementById('referralStatusForm'),
        statusTitle: document.getElementById('referralStatusTitle'),
        statusMessage: document.getElementById('referralStatusMessage'),
        statusScheduleField: document.getElementById('referralStatusScheduleField'),
        statusApplyFromMonth: document.getElementById('referralStatusApplyFromMonth'),
        statusReason: document.getElementById('referralStatusReason'),
        statusSave: document.getElementById('saveReferralStatus'),
        detailsModal: document.getElementById('referralDetailsModal'),
        detailsClose: document.getElementById('closeReferralDetailsModal'),
        detailsCancel: document.getElementById('cancelReferralDetails'),
        detailReferrer: document.getElementById('referralDetailReferrer'),
        detailClient: document.getElementById('referralDetailClient'),
        detailSource: document.getElementById('referralDetailSource'),
        detailStatus: document.getElementById('referralDetailStatus'),
        detailDiscount: document.getElementById('referralDetailDiscount'),
        detailApplyMonth: document.getElementById('referralDetailApplyMonth'),
        detailApproval: document.getElementById('referralDetailApproval'),
        detailReason: document.getElementById('referralDetailReason')
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
        const match = String(value || '').trim().match(/^(\d{4})-(\d{2})$/);
        if (!match) return formatDate(value, fallback);
        const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
        return Number.isNaN(date.getTime()) ? fallback : monthFormatter.format(date);
    };
    const getCurrentMonthKey = () => {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Manila',
            year: 'numeric',
            month: '2-digit'
        }).formatToParts(new Date());
        const year = parts.find((part) => part.type === 'year')?.value || '';
        const month = parts.find((part) => part.type === 'month')?.value || '';
        return year && month ? `${year}-${month}` : '';
    };
    const showToast = (message, type = 'info') => {
        if (typeof window.appToast === 'function') {
            window.appToast(message, { type });
            return;
        }
        window.alert(message);
    };

    async function fetchJSON(url, options = {}) {
        const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401) {
            try { sessionStorage.setItem('next', 'referrals.html'); } catch { /* Continue redirect. */ }
            window.location.href = 'login.html';
            throw new Error('Please log in again.');
        }
        if (!response.ok) throw new Error(payload?.error || payload?.message || `Request failed: ${response.status}`);
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
        const labels = {
            eligible: 'Queued',
            applied: 'Applied',
            approved: 'Approved',
            reversed: 'Reversed',
            cancelled: 'Cancelled',
            pending: 'Pending'
        };
        return { label: labels[normalized] || 'Pending', className: `is-${normalized}` };
    };
    const customerLabel = (customer = {}) => {
        const name = String(customer.name || customer.accountNumber || 'Customer').trim();
        const plan = String(customer.planName || '').trim();
        return [name, customer.accountNumber, plan].filter(Boolean).join(' · ');
    };
    const agentLabel = (agent = {}) => [agent.name || agent.username || agent.id, agent.role].filter(Boolean).join(' · ');
    const fillSelect = (select, options, placeholder) => {
        if (!select) return;
        select.innerHTML = [
            `<option value="">${escapeHtml(placeholder)}</option>`,
            ...options
        ].join('');
    };
    const populateCreateOptions = () => {
        const referredAccount = String(els.referredCustomer?.value || '').trim();
        fillSelect(
            els.referredCustomer,
            state.customers.map((customer) => `<option value="${escapeHtml(customer.accountNumber)}">${escapeHtml(customerLabel(customer))}</option>`),
            'Select referred customer'
        );
        if (referredAccount) els.referredCustomer.value = referredAccount;
        fillSelect(
            els.createCustomer,
            state.customers
                .filter((customer) => customer.accountNumber !== String(els.referredCustomer?.value || '').trim())
                .map((customer) => `<option value="${escapeHtml(customer.accountNumber)}">${escapeHtml(customerLabel(customer))}</option>`),
            'Select referrer customer'
        );
        fillSelect(
            els.createAgent,
            state.agents.map((agent) => `<option value="${escapeHtml(agent.id)}">${escapeHtml(agentLabel(agent))}</option>`),
            'Select referral agent'
        );
    };
    const updateCreateSourceFields = () => {
        const isAgent = normalizeText(els.createSourceType?.value) === 'agent';
        if (els.createCustomerField) els.createCustomerField.hidden = isAgent;
        if (els.createAgentField) els.createAgentField.hidden = !isAgent;
        if (els.createCustomer) els.createCustomer.required = !isAgent;
        if (els.createAgent) els.createAgent.required = isAgent;
    };

    const getFilteredItems = () => {
        const query = normalizeText(els.search?.value);
        const status = normalizeText(els.statusFilter?.value);
        const source = normalizeText(els.sourceFilter?.value);
        return state.items.filter((item) => {
            if (status && normalizeText(item.status) !== status) return false;
            if (source && normalizeText(item.sourceType) !== source) return false;
            if (!query) return true;
            return [
                item.referrerAccountNumber,
                item.referrerName,
                item.referrerId,
                item.referredAccountNumber,
                item.referredName,
                item.referredPlanName,
                item.statusLabel,
                item.approvalReason
            ].map(normalizeText).join(' ').includes(query);
        });
    };
    const renderMetrics = (metrics = {}) => {
        if (els.metricTotal) els.metricTotal.textContent = formatCount(metrics.total);
        if (els.metricEligible) els.metricEligible.textContent = formatCount(metrics.queued ?? metrics.eligible);
        if (els.metricPending) els.metricPending.textContent = formatCount(metrics.pending);
        if (els.metricDiscount) els.metricDiscount.textContent = formatCurrency(metrics.discountValue);
    };
    const renderActions = (item = {}) => {
        const id = escapeHtml(item.id);
        const referredAccount = String(item.referredAccountNumber || '').trim();
        const referrerAccount = String(item.referrerAccountNumber || '').trim();
        const status = normalizeText(item.status);
        const hasApplicationHistory = Array.isArray(item.applications) && item.applications.length > 0;
        const hasActiveApplication = Array.isArray(item.activeApplications) && item.activeApplications.length > 0;
        return `
            <div class="referral-actions">
                <button type="button" class="btn btn-icon btn-outline-secondary btn-sm referral-action-btn" data-referral-view="${id}" title="View details" aria-label="View referral details">
                    <i class="ti ti-eye" aria-hidden="true"></i><span>View</span>
                </button>
                ${!hasApplicationHistory ? `<button type="button" class="btn btn-icon btn-outline-secondary btn-sm referral-action-btn" data-referral-edit="${id}" title="Edit referral" aria-label="Edit referral"><i class="ti ti-edit" aria-hidden="true"></i><span>Edit</span></button>` : ''}
                ${item.approvalStatus !== 'approved' ? `<button type="button" class="btn btn-icon btn-success btn-sm referral-action-btn" data-referral-action="approved" data-referral-id="${id}" title="Approve referral" aria-label="Approve referral"><i class="ti ti-circle-check" aria-hidden="true"></i><span>Approve</span></button>` : ''}
                ${item.sourceType === 'customer' && item.approvalStatus === 'approved' && !hasActiveApplication ? `<button type="button" class="btn btn-icon btn-outline-primary btn-sm referral-action-btn" data-referral-action="schedule" data-referral-id="${id}" title="Set apply month" aria-label="Set apply month"><i class="ti ti-calendar" aria-hidden="true"></i><span>Apply Month</span></button>` : ''}
                ${referredAccount ? `<a class="btn btn-icon btn-outline-secondary btn-sm referral-action-btn" href="payment-breakdown.html?account=${encodeURIComponent(referredAccount)}" title="Open referred account" aria-label="Open referred account"><i class="ti ti-user" aria-hidden="true"></i><span>Referred</span></a>` : ''}
                ${referrerAccount ? `<a class="btn btn-icon btn-outline-primary btn-sm referral-action-btn" href="payment-breakdown.html?account=${encodeURIComponent(referrerAccount)}" title="Open referrer billing" aria-label="Open referrer billing"><i class="ti ti-gift" aria-hidden="true"></i><span>Billing</span></a>` : ''}
                ${status !== 'cancelled' && status !== 'applied' ? `<button type="button" class="btn btn-icon btn-outline-danger btn-sm referral-action-btn" data-referral-action="cancelled" data-referral-id="${id}" title="Cancel referral" aria-label="Cancel referral"><i class="ti ti-circle-x" aria-hidden="true"></i><span>Cancel</span></button>` : ''}
            </div>
        `;
    };
    const renderRows = () => {
        if (!els.tableBody) return;
        const items = getFilteredItems();
        if (!items.length) {
            els.tableBody.innerHTML = `<tr><td colspan="6" class="referral-empty">${state.loading ? 'Loading referrals...' : 'No referrals found.'}</td></tr>`;
            if (els.summary) els.summary.textContent = state.loading ? 'Loading...' : 'No records match the current filters.';
            if (els.pagination) els.pagination.hidden = true;
            return;
        }
        const totalPages = Math.max(1, Math.ceil(items.length / state.pageSize));
        state.page = Math.min(Math.max(1, state.page), totalPages);
        const startIndex = (state.page - 1) * state.pageSize;
        const pageItems = items.slice(startIndex, startIndex + state.pageSize);
        if (els.pagination) els.pagination.hidden = items.length <= state.pageSize;
        if (els.prevPage) els.prevPage.disabled = state.page <= 1;
        if (els.nextPage) els.nextPage.disabled = state.page >= totalPages;
        if (els.pageIndicator) els.pageIndicator.textContent = `Page ${state.page} of ${totalPages}`;

        els.tableBody.innerHTML = pageItems.map((item) => {
            const source = sourceMeta(item.sourceType);
            const status = statusMeta(item.status);
            const activeApplication = Array.isArray(item.activeApplications) ? item.activeApplications[0] : null;
            const discountAmount = item.approvedDiscountAmount || item.discountAmount || activeApplication?.amount || 0;
            const applicationMonth = activeApplication?.billingMonth || item.applyFromMonth || '';
            const applicationLabel = applicationMonth ? formatMonth(applicationMonth) : 'Next available';
            const applicationMeta = activeApplication
                ? 'Applied to customer billing'
                : (item.discountEligible || normalizeText(item.status) === 'reversed'
                    ? 'Queued · two per month, then carry over'
                    : item.statusLabel || 'Not queued');
            const approvalActor = item.approvedBy?.name || item.approvedBy?.username || '';
            const approvalMeta = item.approvedAt
                ? [formatDate(item.approvedAt), approvalActor].filter(Boolean).join(' · ')
                : 'Waiting for Admin approval';
            return `
                <tr>
                    <td data-label="Referrer">
                        <span class="referral-person">
                            <strong title="${escapeHtml(item.referrerName || 'Unknown referrer')}">${escapeHtml(item.referrerName || 'Unknown referrer')}</strong>
                            <span class="referral-person__meta"><span class="referral-source ${source.className}">${source.label}</span><small title="${escapeHtml(item.referrerAccountNumber || item.referrerId || '-')}">${escapeHtml(item.referrerAccountNumber || item.referrerId || '-')}</small></span>
                        </span>
                    </td>
                    <td data-label="Referred Client"><span class="referral-person"><strong title="${escapeHtml(item.referredName || 'Unnamed customer')}">${escapeHtml(item.referredName || 'Unnamed customer')}</strong><small title="${escapeHtml([item.referredAccountNumber, item.referredPlanName].filter(Boolean).join(' · '))}">${escapeHtml([item.referredAccountNumber || '-', item.referredPlanName || '-'].join(' · '))}</small></span></td>
                    <td data-label="Status"><span class="referral-status-cell"><span class="referral-status ${status.className}">${status.label}</span><small title="${escapeHtml(approvalMeta)}">${escapeHtml(approvalMeta)}</small></span></td>
                    <td data-label="Apply Month"><span class="referral-application-cell"><strong>${escapeHtml(applicationLabel)}</strong><small title="${escapeHtml(applicationMeta)}">${escapeHtml(applicationMeta)}</small></span></td>
                    <td class="is-num" data-label="Discount"><span class="referral-discount-cell"><strong>${escapeHtml(formatCurrency(discountAmount))}</strong><small>${item.approvedDiscountAmount ? 'Locked' : 'Proposed'}</small></span></td>
                    <td data-label="Actions">${renderActions(item)}</td>
                </tr>
            `;
        }).join('');
        if (els.summary) {
            const eligible = items.filter((item) => ['eligible', 'reversed'].includes(normalizeText(item.status))).length;
            const applied = items.filter((item) => normalizeText(item.status) === 'applied').length;
            els.summary.textContent = `Showing ${formatCount(startIndex + 1)}-${formatCount(startIndex + pageItems.length)} of ${formatCount(items.length)} · ${formatCount(eligible)} queued · ${formatCount(applied)} applied`;
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
    const setSaving = (saving) => {
        state.saving = Boolean(saving);
        [els.createSave, els.statusSave].forEach((button) => { if (button) button.disabled = state.saving; });
    };
    const setDetailText = (element, value, fallback = 'Not available') => {
        if (element) element.textContent = String(value || fallback);
    };
    const closeDetailsModal = () => {
        if (els.detailsModal) els.detailsModal.hidden = true;
    };
    const openDetailsModal = (item = null) => {
        if (!item || !els.detailsModal) return;
        const source = sourceMeta(item.sourceType);
        const status = statusMeta(item.status);
        const activeApplication = Array.isArray(item.activeApplications) ? item.activeApplications[0] : null;
        const discountAmount = item.approvedDiscountAmount || item.discountAmount || activeApplication?.amount || 0;
        const applicationMonth = activeApplication?.billingMonth || item.applyFromMonth || '';
        const approvalActor = item.approvedBy?.name || item.approvedBy?.username || '';
        const approval = item.approvedAt
            ? [`Approved ${formatDate(item.approvedAt)}`, approvalActor ? `by ${approvalActor}` : ''].filter(Boolean).join(' ')
            : 'Waiting for Admin approval';
        setDetailText(
            els.detailReferrer,
            [item.referrerName || 'Unknown referrer', item.referrerAccountNumber || item.referrerId].filter(Boolean).join(' · ')
        );
        setDetailText(
            els.detailClient,
            [item.referredName || 'Unnamed customer', item.referredAccountNumber, item.referredPlanName].filter(Boolean).join(' · ')
        );
        setDetailText(els.detailSource, source.label);
        setDetailText(els.detailStatus, status.label);
        setDetailText(els.detailDiscount, formatCurrency(discountAmount));
        setDetailText(
            els.detailApplyMonth,
            applicationMonth
                ? `${activeApplication ? 'Applied' : 'Eligible'} from ${formatMonth(applicationMonth)}`
                : 'Next available billing month'
        );
        setDetailText(els.detailApproval, approval);
        setDetailText(els.detailReason, item.approvalReason || item.reason || item.lastReason || 'No reason recorded.');
        els.detailsModal.hidden = false;
        setTimeout(() => els.detailsClose?.focus(), 50);
    };
    const closeCreateModal = () => {
        if (state.saving || !els.createModal) return;
        els.createModal.hidden = true;
        state.editingReferralId = '';
        els.createForm?.reset();
    };
    const openCreateModal = (item = null) => {
        if (!els.createModal) return;
        state.editingReferralId = item?.id || '';
        populateCreateOptions();
        if (item) {
            if (els.referredCustomer) els.referredCustomer.value = item.referredAccountNumber || '';
            populateCreateOptions();
            if (els.createSourceType) els.createSourceType.value = item.sourceType === 'agent' ? 'agent' : 'customer';
            if (els.createCustomer) els.createCustomer.value = item.referrerAccountNumber || '';
            if (els.createAgent) els.createAgent.value = item.referrerId || '';
        }
        updateCreateSourceFields();
        if (els.createTitle) els.createTitle.textContent = item ? 'Edit Referral' : 'Create Referral';
        if (els.createSave) els.createSave.textContent = item ? 'Save and Return to Pending' : 'Create Pending Referral';
        if (els.createReason) els.createReason.value = '';
        els.createModal.hidden = false;
        els.referredCustomer?.focus();
    };
    const closeStatusModal = () => {
        if (state.saving || !els.statusModal) return;
        els.statusModal.hidden = true;
        state.statusAction = null;
        els.statusForm?.reset();
    };
    const openStatusModal = (item, status) => {
        if (!item || !els.statusModal) return;
        const approving = status === 'approved';
        const scheduling = status === 'schedule';
        const showApplyFromMonth = scheduling || (approving && item.sourceType === 'customer');
        state.statusAction = { referralId: item.id, status };
        if (els.statusTitle) {
            els.statusTitle.textContent = approving
                ? 'Approve Referral'
                : (scheduling ? 'Schedule Referral Discount' : 'Cancel Referral');
        }
        if (els.statusMessage) {
            els.statusMessage.textContent = approving
                ? (item.sourceType === 'customer'
                    ? `Approve the referral from ${item.referrerName} to ${item.referredName}. Its discount will be locked and queued from the selected month.`
                    : `Approve the agent referral from ${item.referrerName} to ${item.referredName}.`)
                : (scheduling
                    ? `Choose the earliest billing month for ${item.referredName}'s queued discount.`
                    : `Cancel the referral from ${item.referrerName} to ${item.referredName}.`);
        }
        if (els.statusScheduleField) els.statusScheduleField.hidden = !showApplyFromMonth;
        if (els.statusApplyFromMonth) {
            els.statusApplyFromMonth.min = getCurrentMonthKey();
            els.statusApplyFromMonth.value = scheduling ? String(item.applyFromMonth || '') : '';
        }
        if (els.statusSave) {
            els.statusSave.textContent = approving
                ? (item.sourceType === 'customer' ? 'Approve and Queue' : 'Approve Referral')
                : (scheduling ? 'Save Apply Month' : 'Cancel Referral');
            els.statusSave.className = approving
                ? 'btn btn-success'
                : (scheduling ? 'btn btn-primary' : 'btn btn-danger');
        }
        els.statusModal.hidden = false;
        els.statusReason?.focus();
    };

    async function loadReferrals() {
        setLoading(true);
        renderRows();
        try {
            const [payload, options] = await Promise.all([
                fetchJSON(API_ROOT),
                fetchJSON(`${API_ROOT}/options`)
            ]);
            state.items = Array.isArray(payload.items) ? payload.items : [];
            state.metrics = payload.metrics || {};
            state.customers = Array.isArray(options.customers) ? options.customers : [];
            state.agents = Array.isArray(options.agents) ? options.agents : [];
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

    els.createForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (state.saving) return;
        const sourceType = normalizeText(els.createSourceType?.value);
        const body = {
            referredAccountNumber: String(els.referredCustomer?.value || '').trim(),
            sourceType,
            referrerAccountNumber: sourceType === 'customer' ? String(els.createCustomer?.value || '').trim() : '',
            referrerId: sourceType === 'agent' ? String(els.createAgent?.value || '').trim() : '',
            reason: String(els.createReason?.value || '').trim()
        };
        setSaving(true);
        try {
            const editing = Boolean(state.editingReferralId);
            const endpoint = editing ? `${API_ROOT}/${encodeURIComponent(state.editingReferralId)}` : API_ROOT;
            await fetchJSON(endpoint, {
                method: editing ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            els.createModal.hidden = true;
            state.editingReferralId = '';
            els.createForm.reset();
            showToast(
                editing
                    ? 'Referral updated and returned to Pending for approval.'
                    : 'Pending referral created. Approve it after verification.',
                'success'
            );
            await loadReferrals();
        } catch (error) {
            showToast(error.message || 'Failed to create referral.', 'error');
        } finally {
            setSaving(false);
        }
    });
    els.statusForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (state.saving || !state.statusAction) return;
        setSaving(true);
        try {
            const scheduling = state.statusAction.status === 'schedule';
            const endpoint = `${API_ROOT}/${encodeURIComponent(state.statusAction.referralId)}/${scheduling ? 'schedule' : 'status'}`;
            await fetchJSON(endpoint, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: scheduling ? undefined : state.statusAction.status,
                    applyFromMonth: String(els.statusApplyFromMonth?.value || '').trim(),
                    reason: String(els.statusReason?.value || '').trim()
                })
            });
            const message = scheduling
                ? 'Referral Apply From Month updated.'
                : (state.statusAction.status === 'approved' ? 'Referral approved.' : 'Referral cancelled.');
            els.statusModal.hidden = true;
            state.statusAction = null;
            els.statusForm.reset();
            showToast(message, 'success');
            await loadReferrals();
        } catch (error) {
            showToast(error.message || 'Failed to update referral.', 'error');
        } finally {
            setSaving(false);
        }
    });

    els.tableBody?.addEventListener('click', (event) => {
        const viewButton = event.target.closest('[data-referral-view]');
        if (viewButton) {
            const item = state.items.find((entry) => entry.id === viewButton.dataset.referralView) || null;
            if (item) openDetailsModal(item);
            return;
        }
        const editButton = event.target.closest('[data-referral-edit]');
        if (editButton && !state.saving) {
            const item = state.items.find((entry) => entry.id === editButton.dataset.referralEdit) || null;
            if (item) openCreateModal(item);
            return;
        }
        const actionButton = event.target.closest('[data-referral-action]');
        if (!actionButton || state.saving) return;
        const item = state.items.find((entry) => entry.id === actionButton.dataset.referralId) || null;
        if (item) openStatusModal(item, actionButton.dataset.referralAction);
    });
    els.create?.addEventListener('click', () => openCreateModal());
    els.refresh?.addEventListener('click', () => void loadReferrals());
    els.clearFilters?.addEventListener('click', () => {
        if (els.search) els.search.value = '';
        if (els.statusFilter) els.statusFilter.value = '';
        if (els.sourceFilter) els.sourceFilter.value = '';
        state.page = 1;
        renderRows();
        els.search?.focus();
    });
    els.prevPage?.addEventListener('click', () => {
        state.page = Math.max(1, state.page - 1);
        renderRows();
    });
    els.nextPage?.addEventListener('click', () => {
        state.page += 1;
        renderRows();
    });
    els.createSourceType?.addEventListener('change', updateCreateSourceFields);
    els.referredCustomer?.addEventListener('change', populateCreateOptions);
    [els.createClose, els.createCancel].forEach((button) => button?.addEventListener('click', closeCreateModal));
    [els.statusClose, els.statusCancel].forEach((button) => button?.addEventListener('click', closeStatusModal));
    [els.detailsClose, els.detailsCancel].forEach((button) => button?.addEventListener('click', closeDetailsModal));
    [els.search, els.statusFilter, els.sourceFilter].forEach((element) => {
        const applyFilters = () => {
            state.page = 1;
            renderRows();
        };
        element?.addEventListener('input', applyFilters);
        element?.addEventListener('change', applyFilters);
    });
    [els.createModal, els.statusModal].forEach((modal) => modal?.addEventListener('click', (event) => {
        if (event.target !== modal) return;
        if (modal === els.createModal) closeCreateModal();
        else closeStatusModal();
    }));
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!els.statusModal?.hidden) closeStatusModal();
        else if (!els.createModal?.hidden) closeCreateModal();
    });

    void loadReferrals();
});
