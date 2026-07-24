(function () {
    const STORAGE_KEY = 'technicianCustomerDraftToken';
    const authPanel = document.getElementById('techAuthPanel');
    const workspace = document.getElementById('techWorkspace');
    const loginForm = document.getElementById('techLoginForm');
    const loginUsernameInput = document.getElementById('techLoginUsername');
    const loginPasswordInput = document.getElementById('techLoginPassword');
    const loginSubmitBtn = document.getElementById('techLoginSubmitBtn');
    const authError = document.getElementById('techAuthError');
    const displayName = document.getElementById('techDisplayName');
    const branchLabel = document.getElementById('techBranchLabel');
    const logoutBtn = document.getElementById('techLogoutBtn');
    const draftForm = document.getElementById('techDraftForm');
    const draftSubmitBtn = document.getElementById('techDraftSubmitBtn');
    const draftResetBtn = document.getElementById('techDraftResetBtn');
    const historyStatusSelect = document.getElementById('techHistoryStatus');
    const historyTableBody = document.getElementById('techHistoryTableBody');
    const planSelect = document.getElementById('techPlanSelect');
    const planCategorySelect = document.getElementById('techPlanCategory');
    const planAmountInput = document.getElementById('techPlanAmount');
    const areaInput = document.getElementById('techAreaInput');
    const areaOptions = document.getElementById('techAreaOptions');
    const draftBillDateInput = draftForm?.elements?.billDate || null;
    const draftDueDateInput = draftForm?.elements?.dueDate || null;
    const toast = document.getElementById('techToast');
    const heroPendingCount = document.getElementById('techHeroPendingCount');
    const heroApprovedCount = document.getElementById('techHeroApprovedCount');
    const heroRejectedCount = document.getElementById('techHeroRejectedCount');
    const techPppoeForm = document.getElementById('techPppoeForm');
    const techPppoeCustomerSelect = document.getElementById('techPppoeCustomerSelect');
    const techPppoePlan = document.getElementById('techPppoePlan');
    const techPppoeExisting = document.getElementById('techPppoeExisting');
    const techPppoeUsername = document.getElementById('techPppoeUsername');
    const techPppoePassword = document.getElementById('techPppoePassword');
    const techPppoeProfile = document.getElementById('techPppoeProfile');
    const techPppoeRouter = document.getElementById('techPppoeRouter');
    const techPppoeNote = document.getElementById('techPppoeNote');
    const techPppoeRefreshBtn = document.getElementById('techPppoeRefreshBtn');
    const techPppoeGenerateBtn = document.getElementById('techPppoeGenerateBtn');
    const techCustomerSearch = document.getElementById('techCustomerSearch');
    const techCustomerTableBody = document.getElementById('techCustomerTableBody');
    const techCustomerTable = techCustomerTableBody?.closest('table') || null;
    const techCustomerTableHeadRow = techCustomerTable?.querySelector('thead tr') || null;
    const techCustomerCount = document.getElementById('techCustomerCount');
    const techPppoeSection = techPppoeForm?.closest('.workspace-card') || null;

    const state = {
        token: sessionStorage.getItem(STORAGE_KEY) || '',
        technician: null,
        plans: [],
        coverageAreas: [],
        items: [],
        installationCustomers: [],
        customerSearch: '',
        mikrotikEnabled: false
    };

    const showToast = (message) => {
        if (!toast) return;
        toast.textContent = String(message || '').trim();
        toast.classList.add('show');
        clearTimeout(showToast._timer);
        showToast._timer = window.setTimeout(() => toast.classList.remove('show'), 2400);
    };

    const escapeHtml = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const normalizePlanId = (value) => String(value || '').trim().toLowerCase();
    const normalizePlanName = (value) => String(value || '').trim().toLowerCase();
    const normalizeAreaName = (value) => String(value || '').trim().toLowerCase();
    const normalizeAccountNumber = (value) => String(value || '').trim();
    const findPlanMatch = ({ planId = '', planName = '' } = {}) => {
        const normalizedPlanId = normalizePlanId(planId);
        const normalizedPlanName = normalizePlanName(planName);
        return state.plans.find((plan) => {
            const candidateId = normalizePlanId(plan.id);
            if (normalizedPlanId && candidateId && candidateId === normalizedPlanId) {
                return true;
            }
            if (!normalizedPlanName) {
                return false;
            }
            return [
                plan.name,
                plan.label,
                plan.id
            ].some((candidate) => normalizePlanName(candidate) === normalizedPlanName);
        }) || null;
    };
    const resolveCoverageAreaName = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        return state.coverageAreas.find((areaName) => normalizeAreaName(areaName) === normalizeAreaName(raw)) || '';
    };
    const findInstallationCustomer = (accountNumber) => {
        const key = normalizeAccountNumber(accountNumber);
        if (!key) return null;
        return state.installationCustomers.find((customer) => normalizeAccountNumber(customer?.accountNumber) === key) || null;
    };
    const setPppoeSubmitting = (isSubmitting) => {
        if (!techPppoeGenerateBtn) return;
        techPppoeGenerateBtn.disabled = Boolean(isSubmitting);
        techPppoeGenerateBtn.innerHTML = isSubmitting
            ? '<i class="fa-solid fa-spinner fa-spin"></i> Generating...'
            : '<i class="fa-solid fa-network-wired"></i> Generate PPPoE';
        if (techPppoeRefreshBtn) {
            techPppoeRefreshBtn.disabled = Boolean(isSubmitting);
        }
    };
    const clearPppoePreview = ({ keepCustomer = false } = {}) => {
        if (!keepCustomer && techPppoeCustomerSelect) techPppoeCustomerSelect.value = '';
        if (techPppoePlan) techPppoePlan.value = '';
        if (techPppoeExisting) techPppoeExisting.value = '';
        if (techPppoeUsername) techPppoeUsername.value = '';
        if (techPppoePassword) techPppoePassword.value = '';
        if (techPppoeProfile) techPppoeProfile.value = '';
        if (techPppoeRouter) techPppoeRouter.value = '';
        if (techPppoeNote) {
            techPppoeNote.textContent = 'Select a customer or pending draft account, then generate the PPPoE secret in one step.';
        }
    };
    const renderCustomerDirectoryHeader = () => {
        if (!techCustomerTableHeadRow) return;
        techCustomerTableHeadRow.innerHTML = state.mikrotikEnabled
            ? `
                <th>Account #</th>
                <th>Customer Name</th>
                <th>PPPoE Account</th>
                <th>Plan</th>
                <th>Address / Coordinates</th>
                <th>NAP Info</th>
                <th>Optical Info</th>
                <th>Contact</th>
                <th>MikroTik</th>
            `
            : `
                <th>Account #</th>
                <th>Customer Name</th>
                <th>Plan</th>
                <th>Address / Coordinates</th>
                <th>NAP Info</th>
                <th>Optical Info</th>
                <th>Contact</th>
            `;
    };
    const applyMikrotikVisibility = () => {
        if (techPppoeSection) {
            techPppoeSection.hidden = !state.mikrotikEnabled;
        }
        if (techCustomerSearch) {
            techCustomerSearch.placeholder = state.mikrotikEnabled
                ? 'Search by account, name, PPPoE, plan, contact, address, NAP'
                : 'Search by account, name, plan, contact, address, NAP';
        }
        if (!state.mikrotikEnabled) {
            clearPppoePreview();
        }
        renderCustomerDirectoryHeader();
    };
    const renderPppoeSelection = () => {
        const selectedAccount = normalizeAccountNumber(techPppoeCustomerSelect?.value);
        const customer = findInstallationCustomer(selectedAccount);
        if (!customer) {
            clearPppoePreview({ keepCustomer: true });
            return;
        }
        if (techPppoePlan) techPppoePlan.value = String(customer?.planName || '').trim();
        if (techPppoeExisting) techPppoeExisting.value = String(customer?.pppoeUsername || '').trim();
        if (techPppoeUsername) techPppoeUsername.value = String(customer?.pppoeUsername || '').trim();
        if (techPppoePassword) techPppoePassword.value = String(customer?.pppoePassword || '').trim();
        if (techPppoeProfile) techPppoeProfile.value = String(customer?.pppoeProfile || '').trim();
        if (techPppoeRouter) techPppoeRouter.value = String(customer?.napAssignment?.linkedOlt || customer?.napAssignment?.napCode || '').trim();
        if (techPppoeNote) {
            const accountLabel = normalizeAccountNumber(customer?.accountNumber);
            const planLabel = String(customer?.planName || '').trim() || 'no assigned plan';
            const napLabel = String(customer?.napAssignment?.napCode || '').trim();
            const existingLabel = String(customer?.pppoeUsername || '').trim();
            const accountTypeLabel = customer?.isDraft ? 'draft account' : 'account';
            if (existingLabel) {
                techPppoeNote.textContent = `${accountTypeLabel === 'draft account' ? 'Draft account' : 'Account'} ${accountLabel} already has PPPoE ${existingLabel}. Generating again will update the same ${accountTypeLabel} if needed.`;
            } else if (napLabel) {
                techPppoeNote.textContent = `Ready to generate PPPoE for ${accountTypeLabel} ${accountLabel} using plan ${planLabel}. NAP: ${napLabel}.`;
            } else {
                techPppoeNote.textContent = `Ready to generate PPPoE for ${accountTypeLabel} ${accountLabel} using plan ${planLabel}.`;
            }
        }
    };
    const renderPppoeCustomers = (preferredAccount = '') => {
        if (!techPppoeCustomerSelect) return;
        const preferred = normalizeAccountNumber(preferredAccount || techPppoeCustomerSelect.value);
        techPppoeCustomerSelect.innerHTML = '<option value="">Select customer or draft account</option>';
        const customers = [...state.installationCustomers].sort((left, right) => {
            const nameCompare = String(left?.name || '').localeCompare(String(right?.name || ''));
            if (nameCompare !== 0) return nameCompare;
            return normalizeAccountNumber(left?.accountNumber).localeCompare(normalizeAccountNumber(right?.accountNumber));
        });
        customers.forEach((customer) => {
            const accountNumber = normalizeAccountNumber(customer?.accountNumber);
            if (!accountNumber) return;
            const name = String(customer?.name || '').trim() || accountNumber;
            const plan = String(customer?.planName || '').trim();
            const existing = String(customer?.pppoeUsername || '').trim();
            const labelParts = [`${name} (${accountNumber})`];
            if (customer?.isDraft) labelParts.push('Draft');
            if (plan) labelParts.push(plan);
            if (existing) labelParts.push(`PPPoE: ${existing}`);
            techPppoeCustomerSelect.add(new Option(labelParts.join(' | '), accountNumber));
        });
        if (preferred && customers.some((customer) => normalizeAccountNumber(customer?.accountNumber) === preferred)) {
            techPppoeCustomerSelect.value = preferred;
        }
        renderPppoeSelection();
    };
    const getCustomerDirectoryRows = () => {
        const term = String(state.customerSearch || '').trim().toLowerCase();
        const rows = [...state.installationCustomers].sort((left, right) => {
            const nameCompare = String(left?.name || '').localeCompare(String(right?.name || ''));
            if (nameCompare !== 0) return nameCompare;
            return normalizeAccountNumber(left?.accountNumber).localeCompare(normalizeAccountNumber(right?.accountNumber));
        });
        if (!term) return rows;
        return rows.filter((customer) => {
            const searchText = [
                customer?.accountNumber,
                customer?.name,
                customer?.planName,
                customer?.address,
                customer?.coordinates,
                customer?.napInfo,
                customer?.opticalInfo,
                customer?.contactNumber
            ]
                .concat(state.mikrotikEnabled ? [customer?.pppoeAccount || customer?.pppoeUsername, customer?.mikrotikStatus] : [])
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return searchText.includes(term);
        });
    };
    const renderMikrotikStatus = (status) => {
        const normalized = String(status || '').trim().toLowerCase();
        if (normalized === 'online') {
            return '<span class="tech-status-pill tech-status-pill--online">Online</span>';
        }
        if (normalized === 'offline') {
            return '<span class="tech-status-pill tech-status-pill--offline">Offline</span>';
        }
        return '<span class="tech-status-pill tech-status-pill--unknown">Unknown</span>';
    };
    const renderCustomerDirectory = () => {
        if (!techCustomerTableBody) return;
        const rows = getCustomerDirectoryRows();
        if (techCustomerCount) {
            techCustomerCount.textContent = rows.length === 1 ? '1 customer' : `${rows.length} customers`;
        }
        if (!rows.length) {
            techCustomerTableBody.innerHTML = `<tr><td colspan="${state.mikrotikEnabled ? 9 : 7}" class="empty-state">No matching customers found.</td></tr>`;
            return;
        }
        techCustomerTableBody.innerHTML = rows.map((customer) => {
            const address = escapeHtml(customer?.address || '-');
            const coordinates = escapeHtml(customer?.coordinates || customer?.mapPin || '');
            const opticalInfo = escapeHtml(customer?.opticalInfo || customer?.opticalPower || '-');
            const napInfo = escapeHtml(customer?.napInfo || 'Unassigned');
            const pppoeAccount = escapeHtml(customer?.pppoeAccount || customer?.pppoeUsername || '-');
            const planName = escapeHtml(customer?.planName || customer?.plan || '-');
            const contactNumber = escapeHtml(customer?.contactNumber || '-');
            return `
                <tr>
                    <td><strong>${escapeHtml(customer?.accountNumber || '-')}</strong></td>
                    <td>
                        <div>${escapeHtml(customer?.name || '-')}</div>
                        ${customer?.isDraft ? '<div class="history-meta">Pending draft</div>' : ''}
                    </td>
                    ${state.mikrotikEnabled ? `<td>${pppoeAccount}</td>` : ''}
                    <td>${planName}</td>
                    <td>
                        <div>${address}</div>
                        ${coordinates ? `<div class="history-meta">Coords: ${coordinates}</div>` : ''}
                    </td>
                    <td>${napInfo}</td>
                    <td>${opticalInfo}</td>
                    <td>${contactNumber}</td>
                    ${state.mikrotikEnabled ? `<td>${renderMikrotikStatus(customer?.mikrotikStatus)}</td>` : ''}
                </tr>
            `;
        }).join('');
    };
    const getTodayDateInputValue = () => {
        const now = new Date();
        const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 10);
    };
    const parseDateInputValue = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const parsed = new Date(`${raw}T00:00:00`);
        return Number.isFinite(parsed.getTime()) ? parsed : null;
    };
    const formatDateInputValue = (date) => {
        if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    const computeNextPostpaidCycleDate = (value) => {
        const baseDate = parseDateInputValue(value) || parseDateInputValue(getTodayDateInputValue());
        if (!baseDate) return getTodayDateInputValue();
        const year = baseDate.getFullYear();
        const month = baseDate.getMonth();
        const day = baseDate.getDate();
        const shifted = new Date(year, month + 1, 1);
        const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
        shifted.setDate(Math.min(day, lastDay));
        return formatDateInputValue(shifted);
    };
    const normalizeInitialMonthlyDraftDates = () => {
        if (!draftForm) return;
        const activationDate = String(draftForm.elements.activationDate?.value || '').trim() || getTodayDateInputValue();
        const defaultBillDate = computeNextPostpaidCycleDate(activationDate);
        const currentBillDate = String(draftForm.elements.billDate?.value || '').trim();
        const currentDueDate = String(draftForm.elements.dueDate?.value || '').trim();
        if (draftForm.elements.billDate && !currentBillDate) {
            draftForm.elements.billDate.value = defaultBillDate;
        }
        const effectiveBillDate = String(draftForm.elements.billDate?.value || '').trim() || defaultBillDate;
        if (draftForm.elements.dueDate && !currentDueDate) {
            draftForm.elements.dueDate.value = effectiveBillDate;
        }
    };
    const syncDraftDateMinimums = () => {
        if (draftBillDateInput) {
            draftBillDateInput.min = '';
        }
        const dueMin = String(draftBillDateInput?.value || '').trim();
        if (draftDueDateInput) {
            draftDueDateInput.min = dueMin;
        }
        return dueMin;
    };
    const enforceDraftBillDate = () => {
        syncDraftDateMinimums();
        return true;
    };
    const enforceDraftDueDate = () => {
        const dueMin = syncDraftDateMinimums();
        if (!draftDueDateInput) return true;
        if (!draftDueDateInput.value || !dueMin) {
            return true;
        }
        if (draftDueDateInput.value >= dueMin) return true;
        draftDueDateInput.value = dueMin;
        showToast('Due date cannot be earlier than the bill date.');
        return false;
    };

    const setAuthError = (message) => {
        const text = String(message || '').trim();
        if (!authError) return;
        authError.hidden = !text;
        authError.textContent = text;
    };

    const setLoginSubmitting = (isSubmitting) => {
        if (!loginSubmitBtn) return;
        loginSubmitBtn.disabled = Boolean(isSubmitting);
        loginSubmitBtn.innerHTML = isSubmitting
            ? '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...'
            : '<i class="fa-solid fa-right-to-bracket"></i> Sign In';
    };

    const setDraftSubmitting = (isSubmitting) => {
        if (!draftSubmitBtn) return;
        draftSubmitBtn.disabled = Boolean(isSubmitting);
        draftSubmitBtn.innerHTML = isSubmitting
            ? '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...'
            : '<i class="fa-solid fa-paper-plane"></i> Submit for Review';
    };

    const handleLogout = ({ silent = false, message = '' } = {}) => {
        state.token = '';
        state.technician = null;
        state.plans = [];
        state.coverageAreas = [];
        state.items = [];
        state.installationCustomers = [];
        state.customerSearch = '';
        state.mikrotikEnabled = false;
        sessionStorage.removeItem(STORAGE_KEY);
        showWorkspace(false);
        applyMikrotikVisibility();
        renderPlans();
        renderCoverageAreas();
        renderHistory();
        renderPppoeCustomers();
        if (techCustomerSearch) techCustomerSearch.value = '';
        renderCustomerDirectory();
        clearPppoePreview();
        resetDraftForm();
        setAuthError(message);
        if (!silent) {
            showToast('Signed out.');
        }
    };

    const apiFetch = async (url, options = {}) => {
        const headers = { ...(options.headers || {}) };
        if (state.token) {
            headers.Authorization = `Bearer ${state.token}`;
        }
        if (!headers.Accept) {
            headers.Accept = 'application/json';
        }
        const response = await fetch(url, {
            ...options,
            headers,
            cache: 'no-store'
        });
        const text = await response.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = { ok: false, error: text || `Unexpected response (${response.status})` };
        }
        if (!response.ok || data.ok === false) {
            const error = new Error(data.error || data.message || `Request failed (${response.status})`);
            error.status = response.status;
            if (response.status === 401 && state.token && !String(url || '').includes('/auth/login')) {
                handleLogout({
                    silent: true,
                    message: error.message || 'Technician session expired. Please sign in again.'
                });
            }
            throw error;
        }
        return data;
    };

    const formatDateTime = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '-';
        const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
        if (!Number.isFinite(parsed.getTime())) return raw;
        const dateText = parsed.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const timeText = parsed.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        return `${dateText} ${timeText}`;
    };

    const summarizeCounts = (items) => {
        const counts = { pending: 0, approved: 0, rejected: 0 };
        (Array.isArray(items) ? items : []).forEach((item) => {
            const status = String(item.status || '').trim().toLowerCase();
            if (Object.prototype.hasOwnProperty.call(counts, status)) {
                counts[status] += 1;
            }
        });
        heroPendingCount.textContent = String(counts.pending);
        heroApprovedCount.textContent = String(counts.approved);
        heroRejectedCount.textContent = String(counts.rejected);
    };

    const renderPlans = () => {
        if (!planSelect) return;
        const currentValue = planSelect.value;
        planSelect.innerHTML = '<option value="">Select plan</option>';
        state.plans.forEach((plan) => {
            const label = plan.label || plan.name || plan.id || '';
            const value = plan.name || plan.label || plan.id || '';
            if (!value) return;
            const option = new Option(label, value);
            planSelect.add(option);
        });
        if (currentValue && state.plans.some((plan) =>
            normalizePlanName(plan.name || plan.label || plan.id) === normalizePlanName(currentValue)
        )) {
            planSelect.value = currentValue;
        } else {
            planSelect.value = '';
        }
    };

    const renderCoverageAreas = () => {
        if (!areaOptions) return;
        const currentValue = String(areaInput?.value || '').trim();
        areaOptions.innerHTML = '';
        state.coverageAreas.forEach((areaName) => {
            const text = String(areaName || '').trim();
            if (!text) return;
            const option = document.createElement('option');
            option.value = text;
            areaOptions.appendChild(option);
        });
        if (areaInput) {
            areaInput.placeholder = state.coverageAreas.length
                ? 'Select coverage area'
                : 'Type coverage area';
            if (currentValue) {
                areaInput.value = resolveCoverageAreaName(currentValue) || currentValue;
            }
        }
    };

    const syncPlanFields = (force = false) => {
        const selectedPlanName = planSelect?.value || '';
        const matchedPlan = findPlanMatch({ planName: selectedPlanName });
        if (!matchedPlan) return;
        if (planCategorySelect && (force || !planCategorySelect.value)) {
            planCategorySelect.value = String(matchedPlan.category || '').trim().toLowerCase();
        }
        if (planAmountInput && (force || !String(planAmountInput.value || '').trim())) {
            const price = Number(matchedPlan.price);
            if (Number.isFinite(price) && price >= 0) {
                planAmountInput.value = price.toFixed(2);
            }
        }
    };

    const renderHistory = () => {
        if (!historyTableBody) return;
        if (!state.items.length) {
            historyTableBody.innerHTML = '<tr><td colspan="5" class="empty-state">No submissions yet.</td></tr>';
            summarizeCounts([]);
            return;
        }

        historyTableBody.innerHTML = state.items.map((item) => {
            const pppoeTargetAccount = item.status === 'approved'
                ? item.approvedCustomerAccountNumber
                : (item.status === 'pending' ? item.draftAccountNumber : '');
            const decisionMeta = item.status === 'approved' && item.approvedCustomerAccountNumber
                ? `<div class="history-meta">Approved account: ${escapeHtml(item.approvedCustomerAccountNumber)}</div>`
                : (item.status === 'pending' && item.draftAccountNumber
                    ? `<div class="history-meta">Draft account: ${escapeHtml(item.draftAccountNumber)}</div>`
                    : (item.status === 'rejected' && item.decisionReason
                        ? `<div class="history-meta">Reason: ${escapeHtml(item.decisionReason)}</div>`
                        : ''));
            const pppoeAction = state.mikrotikEnabled && pppoeTargetAccount
                ? `<button type="button" class="history-link-btn" data-tech-pppoe-account="${escapeHtml(pppoeTargetAccount)}"><i class="fa-solid fa-network-wired"></i> Generate PPPoE</button>`
                : '';
            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(item.customerName || '-')}</strong>
                        ${item.contactNumber ? `<div class="history-meta">${escapeHtml(item.contactNumber)}</div>` : ''}
                        ${decisionMeta}
                        ${pppoeAction}
                    </td>
                    <td>${escapeHtml(item.planName || '-')}</td>
                    <td>${escapeHtml(item.areaName || '-')}</td>
                    <td>${escapeHtml(formatDateTime(item.submittedAt))}</td>
                    <td><span class="history-status ${escapeHtml(item.status)}">${escapeHtml(item.status || 'pending')}</span></td>
                </tr>
            `;
        }).join('');

        summarizeCounts(state.items);
    };

    const loadHistory = async () => {
        if (!state.token) return;
        const status = String(historyStatusSelect?.value || 'all').trim().toLowerCase() || 'all';
        const data = await apiFetch(`/api/technician/customer-drafts?status=${encodeURIComponent(status)}&limit=100&offset=0`);
        state.items = Array.isArray(data.items) ? data.items : [];
        renderHistory();
    };

    const loadMeta = async () => {
        const data = await apiFetch('/api/technician/customer-drafts/meta');
        state.technician = data.technician || null;
        state.plans = Array.isArray(data.plans) ? data.plans : [];
        state.coverageAreas = Array.isArray(data.coverageAreas) ? data.coverageAreas : [];
        state.mikrotikEnabled = Boolean(data.mikrotikEnabled);
        applyMikrotikVisibility();
        renderPlans();
        renderCoverageAreas();
        renderHistory();
        renderCustomerDirectory();
        if (displayName) {
            displayName.textContent = state.technician?.name || state.technician?.username || 'Technician';
        }
        if (branchLabel) {
            branchLabel.textContent = state.technician?.branchId
                ? `Branch ${state.technician.branchId} ready for submission.`
                : 'Branch ready for submission.';
        }
    };

    const loadInstallationCustomers = async ({ preferredAccount = '' } = {}) => {
        if (!state.token) {
            state.installationCustomers = [];
            renderHistory();
            renderPppoeCustomers();
            renderCustomerDirectory();
            return;
        }
        const data = await apiFetch('/api/technician/installations/customers');
        if (typeof data.mikrotikEnabled === 'boolean') {
            state.mikrotikEnabled = data.mikrotikEnabled;
            applyMikrotikVisibility();
            renderHistory();
        }
        state.installationCustomers = Array.isArray(data.customers) ? data.customers : [];
        renderPppoeCustomers(preferredAccount);
        renderCustomerDirectory();
    };

    const handlePppoeGenerate = async (event) => {
        event.preventDefault();
        const selectedAccount = normalizeAccountNumber(techPppoeCustomerSelect?.value);
        if (!selectedAccount) {
            showToast('Select a customer account first.');
            return;
        }
        if (!state.mikrotikEnabled) {
            showToast('MikroTik integration is disabled.');
            return;
        }
        setPppoeSubmitting(true);
        try {
            const data = await apiFetch('/api/technician/installations/pppoe/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerAccountNumber: selectedAccount })
            });
            const generated = data.generated || {};
            const manualRequired = Boolean(data.manualRequired);
            await loadInstallationCustomers({ preferredAccount: selectedAccount });
            if (techPppoeUsername) techPppoeUsername.value = String(generated.username || '').trim();
            if (techPppoePassword) techPppoePassword.value = String(generated.password || '').trim();
            if (techPppoeProfile) techPppoeProfile.value = String(generated.profile || '').trim();
            if (techPppoeRouter) techPppoeRouter.value = String(generated.routerId || '').trim();
            if (techPppoeExisting && generated.username) techPppoeExisting.value = String(generated.username || '').trim();
            if (techPppoeNote) {
                if (manualRequired) {
                    const warning = String(data.warning || '').trim();
                    techPppoeNote.textContent = `Failed to save PPPoE to MikroTik for account ${selectedAccount}. Manual MikroTik config is required. Username: ${generated.username || '-'}. Password: ${generated.password || '-'}.${warning ? ` Reason: ${warning}` : ''}`;
                } else {
                    const actionLabel = data.action === 'updated' ? 'updated' : 'generated';
                    techPppoeNote.textContent = `PPPoE ${actionLabel} for account ${selectedAccount}. Username: ${generated.username || '-'}.`;
                }
            }
            if (manualRequired) {
                showToast(`Failed to save PPPoE to MikroTik for account ${selectedAccount}. Manual config required.`);
            } else {
                showToast(data.action === 'updated'
                    ? `PPPoE updated for account ${selectedAccount}.`
                    : `PPPoE generated for account ${selectedAccount}.`);
            }
        } catch (error) {
            showToast(error.message || 'Unable to generate PPPoE.');
        } finally {
            setPppoeSubmitting(false);
        }
    };

    const showWorkspace = (show) => {
        if (authPanel) authPanel.hidden = Boolean(show);
        if (workspace) workspace.hidden = !show;
    };

    const resetDraftForm = () => {
        draftForm?.reset();
        if (planSelect) planSelect.value = '';
        if (planCategorySelect) planCategorySelect.value = '';
        if (planAmountInput) planAmountInput.value = '';
        const today = getTodayDateInputValue();
        const nextCycleDate = computeNextPostpaidCycleDate(today);
        if (draftForm?.elements.activationDate) draftForm.elements.activationDate.value = today;
        if (draftForm?.elements.billDate) draftForm.elements.billDate.value = nextCycleDate;
        if (draftForm?.elements.dueDate) draftForm.elements.dueDate.value = nextCycleDate;
        syncDraftDateMinimums();
    };

    const handleLogin = async (event) => {
        event.preventDefault();
        setAuthError('');
        setLoginSubmitting(true);
        try {
            const data = await apiFetch('/api/technician/customer-drafts/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: loginUsernameInput?.value || '',
                    password: loginPasswordInput?.value || ''
                })
            });
            state.token = String(data.token || '').trim();
            sessionStorage.setItem(STORAGE_KEY, state.token);
            await loadMeta();
            await loadHistory();
            await loadInstallationCustomers();
            showWorkspace(true);
            loginPasswordInput.value = '';
            showToast('Technician session ready.');
        } catch (error) {
            setAuthError(error.message || 'Unable to sign in.');
        } finally {
            setLoginSubmitting(false);
        }
    };

    const handleDraftSubmit = async (event) => {
        event.preventDefault();
        if (!draftForm) return;
        setDraftSubmitting(true);
        try {
            if (!enforceDraftBillDate() || !enforceDraftDueDate()) {
                return;
            }
            normalizeInitialMonthlyDraftDates();
            const formData = new FormData(draftForm);
            const payload = Object.fromEntries(formData.entries());
            if (!String(payload.firstName || '').trim() || !String(payload.lastName || '').trim()) {
                throw new Error('First name and last name are required.');
            }
            if (!String(payload.planName || '').trim()) {
                throw new Error('Plan is required.');
            }
            const matchedPlan = findPlanMatch({ planName: payload.planName });
            if (!matchedPlan) {
                throw new Error('Select a valid plan from the system list.');
            }
            payload.planId = String(matchedPlan.id || '').trim();
            payload.planName = String(matchedPlan.name || matchedPlan.label || payload.planName || '').trim();
            payload.planCategory = String(matchedPlan.category || payload.planCategory || '').trim().toLowerCase();
            const matchedPrice = Number(matchedPlan.price);
            if (Number.isFinite(matchedPrice) && matchedPrice >= 0) {
                payload.planAmount = Number(matchedPrice.toFixed(2));
            }
            const matchedAreaName = resolveCoverageAreaName(payload.area);
            if (String(payload.area || '').trim() && state.coverageAreas.length && !matchedAreaName) {
                throw new Error('Area / Cluster must match the coverage area list.');
            }
            if (matchedAreaName) {
                payload.area = matchedAreaName;
                if (areaInput) areaInput.value = matchedAreaName;
            }
            await apiFetch('/api/technician/customer-drafts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            resetDraftForm();
            await loadHistory();
            showToast('Customer draft submitted for admin finalization.');
        } catch (error) {
            showToast(error.message || 'Unable to submit draft.');
        } finally {
            setDraftSubmitting(false);
        }
    };

    const bootstrapExistingSession = async () => {
        if (!state.token) {
            showWorkspace(false);
            applyMikrotikVisibility();
            renderHistory();
            renderCustomerDirectory();
            return;
        }
        try {
            await apiFetch('/api/technician/customer-drafts/auth/me');
            await loadMeta();
            await loadHistory();
            await loadInstallationCustomers();
            showWorkspace(true);
        } catch (error) {
            handleLogout({
                silent: true,
                message: error?.message || 'Technician session expired. Please sign in again.'
            });
        }
    };

    loginForm?.addEventListener('submit', handleLogin);
    draftForm?.addEventListener('submit', handleDraftSubmit);
    logoutBtn?.addEventListener('click', handleLogout);
    draftResetBtn?.addEventListener('click', resetDraftForm);
    historyStatusSelect?.addEventListener('change', () => loadHistory().catch((error) => showToast(error.message || 'Unable to refresh history.')));
    historyTableBody?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-tech-pppoe-account]');
        if (!button) return;
        const accountNumber = normalizeAccountNumber(button.getAttribute('data-tech-pppoe-account'));
        if (!accountNumber) return;
        renderPppoeCustomers(accountNumber);
        techPppoeCustomerSelect?.focus();
        techPppoeForm?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    planSelect?.addEventListener('change', () => syncPlanFields(true));
    planCategorySelect?.addEventListener('change', () => normalizeInitialMonthlyDraftDates());
    draftForm?.elements?.activationDate?.addEventListener('change', () => normalizeInitialMonthlyDraftDates());
    techPppoeCustomerSelect?.addEventListener('change', renderPppoeSelection);
    techPppoeRefreshBtn?.addEventListener('click', () => {
        loadInstallationCustomers({ preferredAccount: techPppoeCustomerSelect?.value || '' })
            .then(() => showToast('Customer account list refreshed.'))
            .catch((error) => showToast(error.message || 'Unable to refresh customer accounts.'));
    });
    techCustomerSearch?.addEventListener('input', (event) => {
        state.customerSearch = String(event.target?.value || '');
        renderCustomerDirectory();
    });
    techPppoeForm?.addEventListener('submit', handlePppoeGenerate);
    areaInput?.addEventListener('change', () => {
        const matchedAreaName = resolveCoverageAreaName(areaInput.value || '');
        if (matchedAreaName) {
            areaInput.value = matchedAreaName;
        }
    });
    draftBillDateInput?.addEventListener('change', () => {
        enforceDraftBillDate();
        enforceDraftDueDate();
    });
    draftDueDateInput?.addEventListener('change', () => {
        enforceDraftDueDate();
    });

    applyMikrotikVisibility();
    renderHistory();
    renderCustomerDirectory();
    bootstrapExistingSession();
    resetDraftForm();
    clearPppoePreview();
})();
