(function () {
    const searchInput = document.getElementById('draftQueueSearch');
    const bulkToolbar = document.getElementById('draftQueueBulkToolbar');
    const selectPageCheckbox = document.getElementById('draftQueueSelectPage');
    const selectedCountLabel = document.getElementById('draftQueueSelectedCount');
    const deleteSelectedBtn = document.getElementById('draftQueueDeleteSelected');
    const statusSelect = document.getElementById('draftQueueStatus');
    const pageSizeSelect = document.getElementById('draftQueuePageSize');
    const tableBody = document.getElementById('draftQueueTableBody');
    const footerSummary = document.getElementById('draftQueueSummary');
    const footerPageInfo = document.getElementById('draftQueuePageInfo');
    const footerPrevBtn = document.getElementById('draftQueuePrev');
    const footerNextBtn = document.getElementById('draftQueueNext');
    const reviewModal = document.getElementById('draftReviewModal');
    const reviewForm = document.getElementById('draftReviewForm');
    const reviewMeta = document.getElementById('draftReviewMeta');
    const reviewStatusMeta = document.getElementById('draftReviewStatusMeta');
    const reviewCloseBtn = document.getElementById('draftReviewCloseBtn');
    const reviewCancelBtn = document.getElementById('draftReviewCancelBtn');
    const approveBtn = document.getElementById('draftApproveBtn');
    const reviewPlanSelect = document.getElementById('draftReviewPlanSelect');
    const reviewPlanCategory = document.getElementById('draftReviewPlanCategory');
    const reviewPlanAmount = document.getElementById('draftReviewPlanAmount');
    const reviewStatusSelect = document.getElementById('draftReviewStatus');
    const reviewContactNumberInput = document.getElementById('draftReviewContactNumber');
    const reviewLoginUsernameInput = document.getElementById('draftReviewLoginUsername');
    const reviewLoginPasswordInput = document.getElementById('draftReviewLoginPassword');
    const reviewLoginPasswordToggleBtn = document.getElementById('draftReviewLoginPasswordToggleBtn');
    const reviewBillDateInput = document.getElementById('draftReviewBillDate');
    const reviewDueOffsetInput = document.getElementById('draftReviewDueOffset');
    const reviewDueDateInput = document.getElementById('draftReviewDueDate');
    const reviewDueDateDisplay = document.getElementById('draftReviewDueDateDisplay');
    const reviewPrepaidExpirationField = document.getElementById('draftReviewPrepaidExpirationField');
    const reviewPrepaidExpirationInput = document.getElementById('draftReviewPrepaidExpirationAt');
    const reviewActivationDateField = document.getElementById('draftReviewActivationDateField');
    const reviewBillDateField = document.getElementById('draftReviewBillDateField');
    const reviewDueOffsetField = document.getElementById('draftReviewDueOffsetField');
    const reviewDueDateField = document.getElementById('draftReviewDueDateField');
    const reviewCreditLimitField = document.getElementById('draftReviewCreditLimitField');
    const reviewOnboardingSummary = document.getElementById('draftReviewOnboardingSummary');
    const reviewNapSelect = document.getElementById('draftReviewNap');
    const reviewNapPortSelect = document.getElementById('draftReviewNapPort');
    const reviewPonSelectionStatus = document.getElementById('draftReviewPonSelectionStatus');
    const reviewPonHelp = document.getElementById('draftReviewPonHelp');
    const reviewOnuSerial = document.getElementById('draftReviewOnuSerial');

    const savedPageSize = Number(localStorage.getItem('draftQueuePageSize'));
    const initialPageSize = Array.from(pageSizeSelect?.options || []).some((option) => Number(option.value) === savedPageSize)
        ? savedPageSize
        : Number(pageSizeSelect?.value || 10);

    const state = {
        items: [],
        itemsById: new Map(),
        plans: [],
        coverageAreas: [],
        ponCandidates: [],
        ponOptionsLoading: false,
        activeId: '',
        queueStatus: String(statusSelect?.value || 'pending').trim().toLowerCase() || 'pending',
        searchTerm: '',
        selectedIds: new Set(),
        pagination: {
            page: 1,
            pageSize: initialPageSize
        }
    };

    if (pageSizeSelect) {
        pageSizeSelect.value = String(state.pagination.pageSize);
    }

    const DEFAULT_DUE_OFFSET = 7;
    let bulkDeleteInProgress = false;

    const escapeHtml = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const normalizePlanId = (value) => String(value || '').trim().toLowerCase();
    const normalizePlanName = (value) => String(value || '').trim().toLowerCase();
    const normalizeAreaName = (value) => String(value || '').trim().toLowerCase();
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
    const normalizePlanCategory = (value) => {
        const normalized = String(value || '').trim().toLowerCase();
        return normalized === 'prepaid' ? 'prepaid' : 'postpaid';
    };
    const normalizePhilippineMobile = (value, fallbackToRaw = true) => {
        const original = String(value || '').trim();
        if (!original) return '';
        const compact = original.replace(/[^\d+]/g, '');
        let local = compact;
        if (local.startsWith('+63')) local = `0${local.slice(3)}`;
        if (local.startsWith('63')) local = `0${local.slice(2)}`;
        if (local.startsWith('9') && local.length === 10) local = `0${local}`;
        const digits = local.replace(/\D+/g, '');
        if (/^09\d{9}$/.test(digits)) return digits;
        return fallbackToRaw ? original : '';
    };
    const normalizeCustomerStatusValue = (value, fallback = 'active') => {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'force-active') return 'active';
        if (raw === 'force-inactive') return 'inactive';
        if (raw === 'active' || raw === 'inactive' || raw === 'disabled') return raw;
        return fallback;
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

    const apiFetch = async (url, options = {}) => {
        const headers = { Accept: 'application/json', ...(options.headers || {}) };
        const response = await fetch(url, {
            ...options,
            credentials: 'include',
            cache: 'no-store',
            headers
        });
        const text = await response.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = { ok: false, error: text || `Unexpected response (${response.status})` };
        }
        if (!response.ok || data.ok === false) {
            throw new Error(data.error || data.message || `Request failed (${response.status})`);
        }
        return data;
    };

    const setModalState = (modal, show) => {
        if (!modal) return;
        modal.classList.toggle('show', Boolean(show));
        modal.setAttribute('aria-hidden', show ? 'false' : 'true');
        document.body.classList.toggle('modal-active', Boolean(document.querySelector('.modal.show')));
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

    const formatDateOnly = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '-';
        const parsed = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
        if (!Number.isFinite(parsed.getTime())) return raw;
        return parsed.toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const copyTextToClipboard = async (value) => {
        const text = String(value || '').trim();
        if (!text) return false;
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch {
                // fallback below
            }
        }
        try {
            const input = document.createElement('textarea');
            input.value = text;
            input.setAttribute('readonly', 'readonly');
            input.style.position = 'fixed';
            input.style.opacity = '0';
            document.body.appendChild(input);
            input.select();
            input.setSelectionRange(0, text.length);
            const copied = document.execCommand('copy');
            document.body.removeChild(input);
            return copied;
        } catch {
            return false;
        }
    };

    const getInitials = (value) => {
        const words = String(value || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2);
        if (!words.length) return '??';
        return words.map((word) => word.charAt(0).toUpperCase()).join('');
    };

    const getCustomerStatusUi = (value) => {
        const normalized = normalizeCustomerStatusValue(value, 'active');
        if (normalized === 'active') {
            return { className: 'bg-success-lt text-success', label: 'Active' };
        }
        if (normalized === 'disabled') {
            return { className: 'bg-warning-lt text-warning', label: 'Disabled' };
        }
        return { className: 'bg-secondary-lt text-secondary', label: 'Inactive' };
    };

    const getQueueStatus = (item = {}) =>
        String(item.rawStatus || item.status || '').trim().toLowerCase() || 'pending';

    const getQueueStatusUi = (item = {}) => {
        const status = getQueueStatus(item);
        if (status === 'in-progress') {
            return { className: 'bg-warning-lt text-warning', label: 'Incomplete' };
        }
        return { className: 'bg-blue-lt text-blue', label: 'Pending review' };
    };

    const getQueueLabel = () => state.queueStatus === 'in-progress'
        ? 'incomplete drafts'
        : 'pending drafts';

    const getDraftAccountNumber = (item) =>
        String(item?.draftAccountNumber || item?.approvedCustomerAccountNumber || '').trim();

    const normalizeCredentialKey = (value) => String(value || '').trim().toLowerCase();

    const buildDraftCustomerName = (draft = {}) => {
        const explicitName = String(draft?.name || '').trim();
        if (explicitName) return explicitName;
        return [
            String(draft?.firstName || '').trim(),
            String(draft?.middleName || '').trim(),
            String(draft?.lastName || '').trim()
        ].filter(Boolean).join(' ');
    };

    const resolveDraftPortalCredentials = (draft = {}, accountNumber = '', previousDraft = null) => {
        const account = String(accountNumber || draft?.accountNumber || draft?.draftAccountNumber || '').trim();
        const fullName = buildDraftCustomerName(draft);
        const previousFullName = previousDraft ? buildDraftCustomerName(previousDraft) : '';
        const defaultUsername = fullName || account;
        const incomingUsername = String(draft?.loginUsername || '').trim();
        const incomingPassword = String(draft?.loginPassword || '').trim();
        const pppoeUsername = String(draft?.pppoeUsername || '').trim();
        const pppoePassword = String(draft?.pppoePassword || '').trim();
        const incomingUsernameKey = normalizeCredentialKey(incomingUsername);
        const incomingPasswordKey = normalizeCredentialKey(incomingPassword);
        const usernameLooksAutoFilled = !incomingUsername
            || incomingUsernameKey === normalizeCredentialKey(account)
            || (pppoeUsername && incomingUsernameKey === normalizeCredentialKey(pppoeUsername))
            || (previousFullName && incomingUsernameKey === normalizeCredentialKey(previousFullName));
        const passwordLooksAutoFilled = !incomingPassword
            || (fullName && incomingPasswordKey === normalizeCredentialKey(fullName))
            || (previousFullName && incomingPasswordKey === normalizeCredentialKey(previousFullName))
            || (pppoePassword && incomingPasswordKey === normalizeCredentialKey(pppoePassword));

        return {
            loginUsername: usernameLooksAutoFilled ? defaultUsername : incomingUsername,
            loginPassword: passwordLooksAutoFilled ? account : incomingPassword
        };
    };

    const getItemId = (item) => String(item?.id || '').trim();

    const buildSearchText = (item) => {
        const draft = item?.draftData || {};
        return [
            item?.draftAccountNumber,
            item?.approvedCustomerAccountNumber,
            item?.customerName,
            draft?.name,
            draft?.firstName,
            draft?.middleName,
            draft?.lastName,
            item?.planName,
            draft?.planName,
            item?.contactNumber,
            draft?.mobile,
            draft?.contactNumber,
            draft?.email,
            draft?.facebookAccount,
            item?.addressText,
            item?.areaName,
            draft?.area,
            draft?.street,
            draft?.barangay,
            draft?.municipality,
            draft?.province,
            draft?.remarks,
            draft?.installationCompletion?.onuSerialNumber,
            draft?.installationCompletion?.ponAssignment?.napCode,
            draft?.installationCompletion?.ponAssignment?.napId,
            draft?.installationCompletion?.ponAssignment?.port
        ]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean)
            .join(' ');
    };

    const getVisibleItems = () => {
        const query = String(state.searchTerm || '').trim().toLowerCase();
        if (!query) return state.items;
        return state.items.filter((item) => buildSearchText(item).includes(query));
    };

    const getPaginationSnapshot = () => {
        const visibleItems = getVisibleItems();
        const total = visibleItems.length;
        const pageSize = state.pagination.pageSize || 9;
        const pageCount = total ? Math.ceil(total / pageSize) : 1;
        state.pagination.page = Math.min(Math.max(state.pagination.page, 1), pageCount);
        const startIndex = total ? (state.pagination.page - 1) * pageSize : 0;
        const pageItems = total ? visibleItems.slice(startIndex, startIndex + pageSize) : [];
        return {
            visibleItems,
            total,
            pageSize,
            pageCount,
            startIndex,
            pageItems
        };
    };

    const syncSelectedIdsWithItems = () => {
        const validIds = new Set(state.items.map((item) => getItemId(item)).filter(Boolean));
        [...state.selectedIds].forEach((itemId) => {
            if (!validIds.has(itemId)) {
                state.selectedIds.delete(itemId);
            }
        });
    };

    const renderBulkToolbar = (pageItems = []) => {
        if (!bulkToolbar || !selectPageCheckbox || !selectedCountLabel || !deleteSelectedBtn) return;
        const pageIds = pageItems.map((item) => getItemId(item)).filter(Boolean);
        const selectedOnPage = pageIds.filter((itemId) => state.selectedIds.has(itemId)).length;
        const selectedCount = state.selectedIds.size;

        bulkToolbar.hidden = state.items.length === 0;
        selectPageCheckbox.disabled = pageIds.length === 0 || bulkDeleteInProgress;
        selectPageCheckbox.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
        selectPageCheckbox.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
        selectedCountLabel.textContent = `${selectedCount} selected`;
        deleteSelectedBtn.disabled = selectedCount === 0 || bulkDeleteInProgress;
        deleteSelectedBtn.innerHTML = bulkDeleteInProgress
            ? '<i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i> Deleting...'
            : '<i class="ti ti-trash" aria-hidden="true"></i> Delete selected';
    };

    const renderFooter = (total, pageCount, startIndex, pageItemsLength) => {
        if (footerSummary) {
            if (!total) {
                footerSummary.textContent = 'Showing 0 of 0 customers';
            } else {
                const start = startIndex + 1;
                const end = startIndex + pageItemsLength;
                footerSummary.textContent = `Showing ${start}-${end} of ${total} customers`;
            }
        }
        if (footerPageInfo) {
            footerPageInfo.textContent = `Page ${state.pagination.page} of ${pageCount}`;
        }
        if (footerPrevBtn) {
            footerPrevBtn.disabled = state.pagination.page <= 1 || total === 0;
        }
        if (footerNextBtn) {
            footerNextBtn.disabled = state.pagination.page >= pageCount || total === 0;
        }
    };

    const formatPlanAmount = (value) => {
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount < 0) return '';
        return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const getOrdinalSuffix = (value) => {
        const day = Number(value);
        if (day > 3 && day < 21) return 'th';
        switch (day % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
        }
    };

    const populatePlanOptions = (selectedValue = '') => {
        if (!reviewPlanSelect) return;
        const currentValue = selectedValue || reviewPlanSelect.value;
        reviewPlanSelect.innerHTML = '<option value="">Select plan</option>';
        state.plans.forEach((plan) => {
            const label = plan.label || plan.name || plan.id || '';
            const value = plan.name || plan.label || plan.id || '';
            if (!value) return;
            reviewPlanSelect.add(new Option(label, value));
        });
        if (currentValue && !Array.from(reviewPlanSelect.options).some((option) => option.value === currentValue)) {
            reviewPlanSelect.add(new Option(currentValue, currentValue));
        }
        reviewPlanSelect.value = currentValue;
    };

    const populateCoverageAreaOptions = () => {
        const areaSelect = reviewForm?.elements?.area;
        if (!areaSelect) return;
        const currentValue = String(areaSelect.dataset.pendingValue || areaSelect.value || '').trim();
        areaSelect.innerHTML = '<option value="">Select area</option>';
        state.coverageAreas.forEach((areaName) => {
            const text = String(areaName || '').trim();
            if (!text) return;
            areaSelect.add(new Option(text, text));
        });
        const matchedAreaName = currentValue
            ? state.coverageAreas.find((areaName) => normalizeAreaName(areaName) === normalizeAreaName(currentValue)) || ''
            : '';
        if (matchedAreaName) {
            areaSelect.value = matchedAreaName;
        } else {
            areaSelect.value = '';
        }
        if (currentValue) {
            areaSelect.dataset.pendingValue = currentValue;
            areaSelect.dataset.hasInvalidValue = matchedAreaName || !state.coverageAreas.length ? 'false' : 'true';
        } else {
            delete areaSelect.dataset.pendingValue;
            delete areaSelect.dataset.hasInvalidValue;
        }
    };

    const syncReviewPlanFields = (force = false) => {
        const selectedPlanName = reviewPlanSelect?.value || '';
        const matchedPlan = findPlanMatch({ planName: selectedPlanName });
        if (!matchedPlan) {
            applyReviewPlanCategoryUI(reviewPlanCategory?.value || 'postpaid');
            return;
        }

        if (reviewPlanCategory && (force || !reviewPlanCategory.value)) {
            reviewPlanCategory.value = normalizePlanCategory(matchedPlan.category);
        }
        if (reviewPlanAmount && (force || !String(reviewPlanAmount.value || '').trim())) {
            const price = Number(matchedPlan.price);
            if (Number.isFinite(price) && price >= 0) {
                reviewPlanAmount.value = price.toFixed(2);
            }
        }
        applyReviewPlanCategoryUI(reviewPlanCategory?.value || matchedPlan.category || 'postpaid');
    };

    const parseDateOnlyValue = (value) => {
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
    const getTodayDateInputValue = () => formatDateInputValue(new Date());
    const computeNextPostpaidCycleDate = (value) => {
        const baseDate = parseDateOnlyValue(value) || parseDateOnlyValue(getTodayDateInputValue());
        if (!baseDate) return getTodayDateInputValue();
        const year = baseDate.getFullYear();
        const month = baseDate.getMonth();
        const day = baseDate.getDate();
        const shifted = new Date(year, month + 1, 1);
        const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
        shifted.setDate(Math.min(day, lastDay));
        return formatDateInputValue(shifted);
    };
    const syncReviewBillDateMin = () => {
        if (!reviewBillDateInput) return;
        reviewBillDateInput.min = '';
    };
    const enforceNonPastReviewBillDateSelection = () => {
        syncReviewBillDateMin();
        return true;
    };

    const toDateTimeLocalInputValue = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
        if (!Number.isFinite(parsed.getTime())) return '';
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        const hours = String(parsed.getHours()).padStart(2, '0');
        const minutes = String(parsed.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    const computeDueDate = (billDateValue, dueOffsetValue) => {
        const billDate = parseDateOnlyValue(billDateValue);
        const offset = Number(dueOffsetValue);
        if (!billDate || !Number.isFinite(offset) || offset < 0) return '';
        const dueDate = new Date(billDate);
        dueDate.setDate(dueDate.getDate() + Math.floor(offset));
        return formatDateInputValue(dueDate);
    };

    const deriveReviewDueOffset = (draft = {}) => {
        const explicit = Number(draft.dueOffset);
        if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit);
        const billDate = parseDateOnlyValue(draft.billDate);
        const dueDate = parseDateOnlyValue(draft.dueDate);
        if (billDate && dueDate) {
            const diff = Math.round((dueDate.getTime() - billDate.getTime()) / (1000 * 60 * 60 * 24));
            if (Number.isFinite(diff) && diff >= 0) return diff;
        }
        return DEFAULT_DUE_OFFSET;
    };

    const recomputeReviewDueDate = () => {
        const dueDate = computeDueDate(reviewBillDateInput?.value || '', reviewDueOffsetInput?.value || '');
        if (reviewDueDateInput) reviewDueDateInput.value = dueDate;
        if (reviewDueDateDisplay) reviewDueDateDisplay.value = dueDate;
    };

    const applyReviewPlanCategoryUI = (category) => {
        const normalized = normalizePlanCategory(category);
        if (reviewPlanCategory) reviewPlanCategory.value = normalized;
        if (reviewPrepaidExpirationField) reviewPrepaidExpirationField.hidden = true;
        if (reviewActivationDateField) reviewActivationDateField.style.display = '';
        if (reviewBillDateField) reviewBillDateField.style.display = '';
        if (reviewDueOffsetField) reviewDueOffsetField.style.display = '';
        if (reviewDueDateField) reviewDueDateField.style.display = '';
        if (reviewCreditLimitField) reviewCreditLimitField.style.display = '';
        if (reviewBillDateInput) reviewBillDateInput.required = true;
        if (reviewDueOffsetInput) reviewDueOffsetInput.required = true;
        if (reviewDueDateInput) reviewDueDateInput.required = true;
        if (reviewPrepaidExpirationInput) {
            reviewPrepaidExpirationInput.required = false;
            reviewPrepaidExpirationInput.value = '';
        }
        if (reviewBillDateInput && !reviewBillDateInput.value) {
            const activationDate = String(reviewForm?.elements?.activationDate?.value || '').trim() || getTodayDateInputValue();
            reviewBillDateInput.value = computeNextPostpaidCycleDate(activationDate);
        }
        syncReviewBillDateMin();
        recomputeReviewDueDate();
    };

    const setReviewPasswordVisibility = (visible) => {
        if (!reviewLoginPasswordInput) return;
        reviewLoginPasswordInput.type = visible ? 'text' : 'password';
        if (reviewLoginPasswordToggleBtn) {
            reviewLoginPasswordToggleBtn.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
            reviewLoginPasswordToggleBtn.setAttribute('title', visible ? 'Hide password' : 'Show password');
            reviewLoginPasswordToggleBtn.innerHTML = visible
                ? '<i class="ti ti-eye-off" aria-hidden="true"></i>'
                : '<i class="ti ti-eye" aria-hidden="true"></i>';
        }
    };

    const getDraftPonAssignment = (draft = {}) => {
        const assignment = draft?.installationCompletion?.ponAssignment;
        return assignment && typeof assignment === 'object' ? assignment : {};
    };

    const getCandidatePort = (napId, port) => {
        const safeNapId = String(napId || '').trim();
        const safePort = String(port || '').trim();
        const candidate = state.ponCandidates.find((entry) => String(entry?.napId || '').trim() === safeNapId);
        return (Array.isArray(candidate?.ports) ? candidate.ports : [])
            .find((entry) => String(entry?.port || '').trim() === safePort) || null;
    };

    const candidatePortIsAvailable = (napId, port) => {
        const entry = getCandidatePort(napId, port);
        return entry?.available === true || String(entry?.status || '').toLowerCase() === 'available';
    };

    const populateReviewPortOptions = (napId, selectedPort = '') => {
        if (!reviewNapPortSelect) return;
        const safeNapId = String(napId || '').trim();
        const safeSelectedPort = String(selectedPort || '').trim();
        const candidate = state.ponCandidates.find((entry) => String(entry?.napId || '').trim() === safeNapId);
        reviewNapPortSelect.innerHTML = '';
        reviewNapPortSelect.add(new Option(candidate ? 'Select available port' : 'No port data', ''));
        const ports = Array.isArray(candidate?.ports) ? candidate.ports : [];
        ports.forEach((portEntry) => {
            const port = String(portEntry?.port || '').trim();
            if (!port) return;
            const isCurrent = safeNapId === String(reviewNapSelect?.dataset?.currentNapId || '')
                && port === String(reviewNapPortSelect.dataset.currentPort || '');
            const available = portEntry?.available === true || String(portEntry?.status || '') === 'available';
            if (!available && !isCurrent) return;
            const statusLabel = isCurrent
                ? (available ? 'technician request, available now' : 'technician request, unavailable now')
                : 'available';
            reviewNapPortSelect.add(new Option(`Port ${port} — ${statusLabel}`, port));
        });
        if (safeSelectedPort && !Array.from(reviewNapPortSelect.options)
            .some((option) => option.value === safeSelectedPort)) {
            reviewNapPortSelect.add(new Option(`Port ${safeSelectedPort} — technician request, availability unknown`, safeSelectedPort));
        }
        reviewNapPortSelect.value = safeSelectedPort;
    };

    const populateReviewNapOptions = (current = {}) => {
        if (!reviewNapSelect) return;
        const currentNapId = String(current?.napId || '').trim();
        const currentPort = String(current?.port || '').trim();
        reviewNapSelect.dataset.currentNapId = currentNapId;
        if (reviewNapPortSelect) reviewNapPortSelect.dataset.currentPort = currentPort;
        reviewNapSelect.innerHTML = '';
        reviewNapSelect.add(new Option('Select NAP', ''));
        state.ponCandidates.forEach((candidate) => {
            const napId = String(candidate?.napId || '').trim();
            if (!napId) return;
            const label = [candidate.napCode || napId, candidate.location, candidate.linkedOlt]
                .map((value) => String(value || '').trim())
                .filter(Boolean)
                .join(' — ');
            reviewNapSelect.add(new Option(label || napId, napId));
        });
        if (currentNapId && !Array.from(reviewNapSelect.options)
            .some((option) => option.value === currentNapId)) {
            reviewNapSelect.add(new Option(currentNapId, currentNapId));
        }
        reviewNapSelect.value = currentNapId;
        populateReviewPortOptions(currentNapId, currentPort);
    };

    const loadReviewPonOptions = async (item, draft = {}) => {
        const assignment = getDraftPonAssignment(draft);
        const fallbackCurrent = {
            napId: draft.selectedNapId || assignment.napId || '',
            port: draft.selectedNapPort || assignment.port || ''
        };
        state.ponOptionsLoading = true;
        if (approveBtn) approveBtn.disabled = true;
        if (reviewPonHelp) {
            reviewPonHelp.className = 'alert alert-info py-2 mt-3 mb-0';
            reviewPonHelp.textContent = 'Loading the latest branch port availability...';
        }
        try {
            const data = await apiFetch(`/api/customer-drafts/${encodeURIComponent(item.id)}/pon-options`);
            if (state.activeId !== String(item.id || '').trim()) return;
            state.ponCandidates = Array.isArray(data.candidates) ? data.candidates : [];
            populateReviewNapOptions(data.current || fallbackCurrent);
            if (reviewPonHelp) {
                const requestedAvailable = candidatePortIsAvailable(
                    reviewNapSelect?.dataset?.currentNapId,
                    reviewNapPortSelect?.dataset?.currentPort
                );
                reviewPonHelp.className = requestedAvailable
                    ? 'alert alert-info py-2 mt-3 mb-0'
                    : 'alert alert-warning py-2 mt-3 mb-0';
                reviewPonHelp.textContent = requestedAvailable
                    ? 'The technician request is available now but is not reserved. Approval performs a final atomic check and assigns it.'
                    : 'The technician request is no longer available. Select another available NAP port before finalizing.';
            }
        } catch (error) {
            if (state.activeId !== String(item.id || '').trim()) return;
            state.ponCandidates = [];
            populateReviewNapOptions(fallbackCurrent);
            if (reviewPonHelp) {
                reviewPonHelp.className = 'alert alert-danger py-2 mt-3 mb-0';
                reviewPonHelp.textContent = error.message || 'Unable to load current NAP availability.';
            }
        } finally {
            state.ponOptionsLoading = false;
            if (approveBtn && getQueueStatus(item) === 'pending') {
                approveBtn.disabled = false;
            }
        }
    };

    const readReviewFormPayload = () => {
        const formData = new FormData(reviewForm);
        const payload = Object.fromEntries(formData.entries());
        const activeDraft = state.itemsById.get(state.activeId)?.draftData || {};
        const fallbackPlanId = String(activeDraft.planId || '').trim();
        const fallbackPlanName = String(activeDraft.planName || '').trim();
        let matchedPlan = findPlanMatch({ planName: payload.planName });
        const samePlanSelection = !String(payload.planName || '').trim()
            || normalizePlanName(payload.planName) === normalizePlanName(fallbackPlanName);
        if (!matchedPlan && fallbackPlanId && samePlanSelection) {
            matchedPlan = findPlanMatch({ planId: fallbackPlanId });
        }
        payload.planId = matchedPlan?.id || (samePlanSelection ? fallbackPlanId : '');
        if (matchedPlan) {
            payload.planName = String(matchedPlan.name || matchedPlan.label || payload.planName || '').trim();
            payload.planCategory = normalizePlanCategory(matchedPlan.category || payload.planCategory);
            const price = Number(matchedPlan.price);
            if (Number.isFinite(price) && price >= 0) {
                payload.planAmount = Number(price.toFixed(2));
            }
        }
        payload.contactNumber = normalizePhilippineMobile(payload.contactNumber);
        if (reviewContactNumberInput) {
            reviewContactNumberInput.value = payload.contactNumber;
        }
        const accountNumber = String(payload.accountNumber || getDraftAccountNumber(state.itemsById.get(state.activeId)) || '').trim();
        const portalCredentials = resolveDraftPortalCredentials(
            { ...activeDraft, ...payload },
            accountNumber,
            activeDraft
        );
        payload.loginUsername = portalCredentials.loginUsername;
        payload.loginPassword = portalCredentials.loginPassword;
        if (reviewLoginUsernameInput) reviewLoginUsernameInput.value = payload.loginUsername;
        if (reviewLoginPasswordInput) reviewLoginPasswordInput.value = payload.loginPassword;
        payload.facebookConfirmed = Boolean(reviewForm.elements.facebookConfirmed?.checked);
        return payload;
    };

    const getDraftAccountMarkup = (item) => {
        const accountNumber = getDraftAccountNumber(item);
        return `
            <span class="account-tag-wrap">
                <span class="badge bg-blue-lt text-blue font-monospace">${escapeHtml(accountNumber || '---------')}</span>
                ${accountNumber ? `
                    <button
                        type="button"
                        class="btn btn-icon btn-ghost-secondary btn-sm account-copy-btn"
                        data-copy-account-number="${escapeHtml(accountNumber)}"
                        aria-label="Copy account number ${escapeHtml(accountNumber)}"
                        title="Copy account number"
                    >
                        <i class="ti ti-copy" aria-hidden="true"></i>
                    </button>
                ` : ''}
            </span>
        `;
    };

    const getBillingCycleDetails = (draft = {}) => {
        const category = String(draft.planCategory || '').trim().toLowerCase();
        if (category === 'prepaid') {
            const expiry = draft.prepaidExpirationAt || draft.dueDate || '';
            return {
                display: 'Monthly prepaid',
                meta: expiry ? `Due: ${formatDateTime(expiry)}` : 'No due date set'
            };
        }
        const billDate = String(draft.billDate || '').trim();
        const dueDate = String(draft.dueDate || '').trim();
        const parsedBillDate = billDate ? new Date(`${billDate}T00:00:00`) : null;
        const hasBillDate = parsedBillDate && Number.isFinite(parsedBillDate.getTime());
        return {
            display: hasBillDate
                ? `Every ${parsedBillDate.getDate()}${getOrdinalSuffix(parsedBillDate.getDate())} of the month`
                : 'Not set',
            meta: dueDate ? `Next due: ${formatDateOnly(dueDate)}` : 'No cycle recorded'
        };
    };

    const getPlanPresentation = (item, draft = {}) => {
        const normalizedCategory = String(draft.planCategory || '').trim().toLowerCase();
        const planName = String(item.planName || draft.planName || '-').trim() || '-';
        const matchedPlan = findPlanMatch({ planId: draft.planId, planName });
        const metaParts = [];
        const amountText = formatPlanAmount(matchedPlan?.price ?? draft.planAmount);
        const priceSuffix = '/ month';
        if (amountText) metaParts.push(amountText);
        if (priceSuffix) metaParts.push(priceSuffix);
        return {
            name: planName,
            pillClass: normalizedCategory === 'prepaid'
                ? 'badge bg-purple-lt text-purple'
                : 'badge bg-green-lt text-green',
            meta: metaParts.join(' · ') || 'Plan details unavailable'
        };
    };

    const renderTable = () => {
        if (!tableBody) return;
        const {
            total,
            pageCount,
            startIndex,
            pageItems
        } = getPaginationSnapshot();

        renderFooter(total, pageCount, startIndex, pageItems.length);
        renderBulkToolbar(pageItems);

        if (!pageItems.length) {
            const queueLabel = getQueueLabel();
            tableBody.innerHTML = state.searchTerm
                ? `<tr><td colspan="9" class="draft-empty text-secondary text-center">No ${escapeHtml(queueLabel)} match your search.</td></tr>`
                : `<tr><td colspan="9" class="draft-empty text-secondary text-center">No ${escapeHtml(queueLabel)} found.</td></tr>`;
            return;
        }

        tableBody.innerHTML = pageItems.map((item) => {
            const itemId = String(item.id || '').trim();
            const draft = item.draftData || {};
            const statusUi = getQueueStatusUi(item);
            const displayName = String(item.customerName || buildDraftCustomerName(draft) || '-').trim() || '-';
            const subscriberMetaParts = [];
            const submittedAtLabel = formatDateTime(item.submittedAt);
            if (submittedAtLabel && submittedAtLabel !== '-') subscriberMetaParts.push(`Submitted ${submittedAtLabel}`);
            const addressText = String(item.addressText || [draft.street, draft.barangay, draft.municipality, draft.province].filter(Boolean).join(', ')).trim();
            const contactMobile = String(item.contactNumber || draft.mobile || '').trim() || 'No mobile number';
            const contactEmail = String(draft.email || '').trim() || 'No email address';
            const remarksText = String(draft.remarks || '').trim() || 'No remarks';
            const ponAssignment = getDraftPonAssignment(draft);
            const ponText = ponAssignment.napCode || ponAssignment.napId
                ? `${ponAssignment.napCode || ponAssignment.napId} / Port ${ponAssignment.port || '-'}`
                : 'No NAP submitted';
            const billingCycle = getBillingCycleDetails(draft);
            const plan = getPlanPresentation(item, draft);
            const isPending = getQueueStatus(item) === 'pending';
            const actionLabel = isPending ? 'Finalize customer' : 'View incomplete draft';
            const actionIcon = isPending ? 'ti-pencil' : 'ti-eye';
            const isSelected = state.selectedIds.has(itemId);
            return `
                <tr data-draft-id="${escapeHtml(itemId)}">
                    <td class="select-col">
                        <label class="draft-select-cell" aria-label="Select customer draft">
                            <input class="form-check-input" type="checkbox" data-draft-select="${escapeHtml(itemId)}" ${isSelected ? 'checked' : ''}>
                        </label>
                    </td>
                    <td class="account-col">
                        ${getDraftAccountMarkup(item)}
                    </td>
                    <td>
                        <div class="subscriber">
                            <span class="avatar avatar-sm bg-primary-lt text-primary">${escapeHtml(getInitials(displayName))}</span>
                            <div>
                                <p class="subscriber-name">${escapeHtml(displayName)}</p>
                                <p class="subscriber-meta">
                                    ${escapeHtml(subscriberMetaParts.join(' · ') || 'Draft submission')} ·
                                    <span
                                        class="badge ${escapeHtml(statusUi.className)}"
                                        title="${escapeHtml(statusUi.label)}"
                                        aria-label="${escapeHtml(statusUi.label)}"
                                    >${escapeHtml(statusUi.label)}</span>
                                </p>
                            </div>
                        </div>
                    </td>
                    <td class="plan-col">
                        <span class="${escapeHtml(plan.pillClass)}">${escapeHtml(plan.name)}</span>
                        <p class="plan-meta">${escapeHtml(plan.meta)}</p>
                    </td>
                    <td>
                        <p class="cycle">${escapeHtml(billingCycle.display)}</p>
                        <p class="cycle">${escapeHtml(billingCycle.meta)}</p>
                    </td>
                    <td>
                        <p class="contact-line"><i class="ti ti-device-mobile" aria-hidden="true"></i> ${escapeHtml(contactMobile)}</p>
                        <p class="contact-line"><i class="ti ti-mail" aria-hidden="true"></i> ${escapeHtml(contactEmail)}</p>
                    </td>
                    <td>
                        <p class="address">${escapeHtml(addressText || item.areaName || 'No address')}</p>
                    </td>
                    <td>
                        <span class="note">${escapeHtml(remarksText)}</span>
                        <p class="text-secondary small mb-0 mt-1">${escapeHtml(ponText)}</p>
                    </td>
                    <td class="actions-col">
                        <div class="draft-row-actions row-actions">
                            <button
                                type="button"
                                class="btn btn-icon btn-outline-primary btn-sm"
                                data-draft-open="${escapeHtml(item.id)}"
                                aria-label="${escapeHtml(actionLabel)}"
                                title="${escapeHtml(actionLabel)}"
                            >
                                <i class="ti ${escapeHtml(actionIcon)}" aria-hidden="true"></i>
                            </button>
                            <button
                                type="button"
                                class="btn btn-icon btn-outline-danger btn-sm"
                                data-draft-delete="${escapeHtml(item.id)}"
                                aria-label="Delete customer draft"
                                title="Delete customer draft"
                            >
                                <i class="ti ti-trash" aria-hidden="true"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    };

    const loadPlans = async () => {
        const data = await apiFetch('/api/plans');
        state.plans = Array.isArray(data.plans) ? data.plans : Array.isArray(data) ? data : [];
        populatePlanOptions();
    };

    const loadCoverageAreas = async () => {
        const payload = await apiFetch('/api/coverage');
        const areaNames = (Array.isArray(payload) ? payload : [])
            .map((area) => area?.name || area?.areaName || area?.area || area?.label)
            .map((name) => String(name || '').trim())
            .filter(Boolean);
        state.coverageAreas = Array.from(new Set(areaNames)).sort((a, b) => a.localeCompare(b));
        populateCoverageAreaOptions();
    };

    const loadQueue = async () => {
        const status = state.queueStatus === 'in-progress' ? 'in-progress' : 'pending';
        const data = await apiFetch(`/api/customer-drafts?status=${encodeURIComponent(status)}&limit=100&offset=0`);
        state.items = Array.isArray(data.items) ? data.items : [];
        state.itemsById = new Map(state.items.map((item) => [String(item.id || ''), item]));
        syncSelectedIdsWithItems();
        state.pagination.page = 1;
        renderTable();
    };

    const closeReviewModal = () => {
        state.activeId = '';
        reviewForm?.reset();
        if (reviewForm?.elements?.area) {
            delete reviewForm.elements.area.dataset.pendingValue;
            delete reviewForm.elements.area.dataset.hasInvalidValue;
            reviewForm.elements.area.value = '';
        }
        reviewStatusMeta.textContent = '';
        reviewStatusMeta.hidden = true;
        if (reviewDueDateDisplay) reviewDueDateDisplay.value = '';
        setReviewPasswordVisibility(false);
        setModalState(reviewModal, false);
    };

    reviewContactNumberInput?.addEventListener('blur', () => {
        reviewContactNumberInput.value = normalizePhilippineMobile(reviewContactNumberInput.value);
    });

    const setReviewMode = (item) => {
        const isPending = getQueueStatus(item) === 'pending';
        Array.from(reviewForm?.elements || []).forEach((element) => {
            if (!('disabled' in element)) return;
            if (element === approveBtn) return;
            element.disabled = !isPending;
        });
        if (approveBtn) approveBtn.hidden = !isPending;
    };

    const openReviewModal = (item) => {
        if (!item || !reviewForm) return;
        state.activeId = String(item.id || '').trim();
        const draft = item.draftData || {};
        populatePlanOptions(draft.planName || '');
        reviewForm.elements.accountNumber.value = getDraftAccountNumber(item) || '';
        reviewForm.elements.firstName.value = draft.firstName || '';
        reviewForm.elements.middleName.value = draft.middleName || '';
        reviewForm.elements.lastName.value = draft.lastName || '';
        reviewForm.elements.status.value = String(draft.status || 'active').trim().toLowerCase() || 'active';
        reviewForm.elements.contactNumber.value = normalizePhilippineMobile(draft.mobile || draft.contactNumber || '');
        reviewForm.elements.email.value = draft.email || '';
        reviewForm.elements.facebookAccount.value = draft.facebookAccount || '';
        reviewForm.elements.facebookConfirmed.checked = draft.facebookConfirmed === true;
        reviewForm.elements.facebookConfirmedAt.value = draft.facebookConfirmedAt || '';
        reviewForm.elements.facebookConfirmedBy.value = draft.facebookConfirmedBy || '';
        reviewForm.elements.clientEventId.value = draft.clientEventId || '';
        reviewForm.elements.street.value = draft.street || '';
        reviewForm.elements.serviceAddress.value = draft.serviceAddress || '';
        reviewForm.elements.barangay.value = draft.barangay || '';
        reviewForm.elements.municipality.value = draft.municipality || '';
        reviewForm.elements.province.value = draft.province || '';
        if (reviewForm.elements.area) {
            reviewForm.elements.area.dataset.pendingValue = draft.area || '';
            populateCoverageAreaOptions();
        }
        reviewForm.elements.mapPin.value = draft.mapPin || '';
        reviewForm.elements.provinceCode.value = draft.provinceCode || '';
        reviewForm.elements.municipalityCode.value = draft.municipalityCode || '';
        reviewForm.elements.barangayCode.value = draft.barangayCode || '';
        reviewForm.elements.gpsAccuracyMeters.value = draft.gpsAccuracyMeters ?? '';
        reviewForm.elements.gpsCapturedAt.value = draft.gpsCapturedAt || '';
        reviewForm.elements.locationSource.value = draft.locationSource || '';
        reviewForm.elements.planName.value = draft.planName || '';
        reviewForm.elements.planCategory.value = normalizePlanCategory(draft.planCategory || 'postpaid');
        reviewForm.elements.planAmount.value = draft.planAmount != null ? draft.planAmount : '';
        reviewForm.elements.activationDate.value = draft.activationDate || '';
        const initialActivationDate = draft.activationDate || getTodayDateInputValue();
        const derivedDueOffset = deriveReviewDueOffset(draft);
        const draftBillDate = String(draft.billDate || '').trim();
        const nextBillDate = draftBillDate || computeNextPostpaidCycleDate(initialActivationDate);
        reviewForm.elements.billDate.value = nextBillDate || getTodayDateInputValue();
        if (reviewBillDateInput) {
            reviewBillDateInput.dataset.originalValue = reviewForm.elements.billDate.value || '';
        }
        reviewForm.elements.dueOffset.value = derivedDueOffset;
        const minimumFirstDueDate = computeDueDate(reviewForm.elements.billDate.value, derivedDueOffset) || reviewForm.elements.billDate.value || '';
        const draftDueDate = String(draft.dueDate || '').trim();
        const nextDueDate = (!draftDueDate || draftDueDate < minimumFirstDueDate) ? minimumFirstDueDate : draftDueDate;
        reviewForm.elements.dueDate.value = nextDueDate || '';
        if (reviewDueDateDisplay) reviewDueDateDisplay.value = nextDueDate || '';
        reviewForm.elements.creditLimit.value = draft.creditLimit != null ? draft.creditLimit : '';
        reviewForm.elements.firstBillProratedAmount.value = draft.firstBillProratedAmount ?? '';
        reviewForm.elements.firstBillAmountReceived.value = draft.firstBillAmountReceived ?? '';
        reviewForm.elements.firstBillPeriodStart.value = draft.firstBillPeriodStart || '';
        reviewForm.elements.firstBillPeriodEnd.value = draft.firstBillPeriodEnd || '';
        reviewForm.elements.referralCustomerAccountNumber.value = draft.referralCustomerAccountNumber || '';
        reviewForm.elements.referralCustomerName.value = draft.referralCustomerName || '';
        reviewForm.elements.referralSourceType.value = draft.referralSourceType || '';
        reviewForm.elements.referredBy.value = draft.referredBy || '';
        reviewForm.elements.prepaidExpirationAt.value = toDateTimeLocalInputValue(draft.prepaidExpirationAt || '');
        const draftAccountNumber = getDraftAccountNumber(item) || '';
        const portalCredentials = resolveDraftPortalCredentials(draft, draftAccountNumber);
        reviewForm.elements.loginUsername.value = portalCredentials.loginUsername;
        reviewForm.elements.loginPassword.value = portalCredentials.loginPassword;
        reviewForm.elements.pppoeMode.value = draft.pppoeMode || '';
        reviewForm.elements.pppoeUsername.value = draft.pppoeUsername || '';
        reviewForm.elements.pppoePassword.value = draft.pppoePassword || '';
        reviewForm.elements.pppoeProfile.value = draft.pppoeProfile || '';
        reviewForm.elements.remarks.value = draft.remarks || '';
        const ponAssignment = getDraftPonAssignment(draft);
        const currentPonSelection = {
            napId: draft.selectedNapId || ponAssignment.napId || '',
            port: draft.selectedNapPort || ponAssignment.port || ''
        };
        state.ponCandidates = [];
        populateReviewNapOptions(currentPonSelection);
        if (reviewPonSelectionStatus) reviewPonSelectionStatus.value = ponAssignment.status === 'requested'
            ? 'Requested — not reserved'
            : (ponAssignment.status === 'draft-held'
                ? 'Legacy held selection'
                : (ponAssignment.status || 'No submitted selection'));
        if (reviewOnuSerial) reviewOnuSerial.value = draft.onuSerialNumber
            || draft.installationCompletion?.onuSerialNumber
            || '';
        if (reviewOnboardingSummary) {
            const onboardingNotes = [];
            const amountDue = Number(draft.firstBillProratedAmount);
            const submittedAmountReceived = Number(draft.firstBillAmountReceived);
            const amountReceived = Number.isFinite(submittedAmountReceived)
                ? submittedAmountReceived
                : (draft.firstBillPaid === true && Number.isFinite(amountDue) ? amountDue : Number.NaN);
            const hasAmountReceived = Number.isFinite(amountReceived) && amountReceived > 0;
            const formatPeso = (value) => `PHP ${Number(value).toLocaleString('en-PH', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            })}`;
            if (!hasAmountReceived) {
                onboardingNotes.push('Technician recorded no prorated first-bill payment.');
            } else if (Number.isFinite(amountDue) && amountReceived < amountDue) {
                onboardingNotes.push(`Technician collected ${formatPeso(amountReceived)} as a partial first-bill payment; ${formatPeso(amountDue - amountReceived)} remains due. Approval records the collected amount.`);
            } else if (Number.isFinite(amountDue) && amountReceived > amountDue) {
                onboardingNotes.push(`Technician collected ${formatPeso(amountReceived)}: ${formatPeso(amountDue)} covers the prorated first bill and ${formatPeso(amountReceived - amountDue)} becomes advance credit on approval.`);
            } else {
                onboardingNotes.push(`Technician collected ${formatPeso(amountReceived)} for the prorated first bill. Approval records the collected amount.`);
            }
            const referrerAccount = String(draft.referralCustomerAccountNumber || '').trim();
            if (referrerAccount) {
                onboardingNotes.push(`Referral: ${String(draft.referralCustomerName || 'Existing customer').trim()} (${referrerAccount}). Approval creates a Pending referral for separate discount approval.`);
            }
            reviewOnboardingSummary.textContent = onboardingNotes.join(' ');
            reviewOnboardingSummary.hidden = onboardingNotes.length === 0;
        }
        syncReviewPlanFields(false);
        applyReviewPlanCategoryUI(reviewForm.elements.planCategory.value || 'postpaid');
        recomputeReviewDueDate();
        setReviewPasswordVisibility(false);

        reviewMeta.textContent = 'Generate a customer profile, assign a plan, and set the first billing cycle.';
        if (getQueueStatus(item) === 'pending') {
            reviewStatusMeta.hidden = true;
            reviewStatusMeta.textContent = '';
        } else {
            reviewStatusMeta.hidden = false;
            reviewStatusMeta.textContent = 'Incomplete intake. The technician can retry the submission to recover this draft, or Admin can delete it.';
        }
        setReviewMode(item);
        setModalState(reviewModal, true);
        if (getQueueStatus(item) === 'pending') {
            loadReviewPonOptions(item, draft);
        } else {
            populateReviewNapOptions(getDraftPonAssignment(draft));
            if (reviewPonHelp) {
                reviewPonHelp.className = 'alert alert-warning py-2 mt-3 mb-0';
                reviewPonHelp.textContent = 'This intake is incomplete and cannot be finalized. Ask the technician to retry, or delete it and submit again.';
            }
        }
    };

    const handleApprove = async (event) => {
        event.preventDefault();
        const item = state.itemsById.get(state.activeId);
        if (!item) return;
        if (state.ponOptionsLoading) {
            notify('Wait for the latest NAP port availability to finish loading.', 'error');
            return;
        }
        if (!String(reviewForm.elements.firstName.value || '').trim() || !String(reviewForm.elements.lastName.value || '').trim()) {
            notify('First name and last name are required.', 'error');
            return;
        }
        if (!String(reviewForm.elements.planName.value || '').trim()) {
            notify('Plan is required.', 'error');
            return;
        }
        const draftPonAssignment = getDraftPonAssignment(item.draftData || {});
        if (item.draftData?.installationCompletion && (
            !String(reviewForm.elements.selectedNapId?.value || '').trim()
            || !String(reviewForm.elements.selectedNapPort?.value || '').trim()
        )) {
            notify('Select the NAP and available port to finalize this installation.', 'error');
            return;
        }
        if (item.draftData?.installationCompletion && state.ponCandidates.length && !candidatePortIsAvailable(
            reviewForm.elements.selectedNapId?.value,
            reviewForm.elements.selectedNapPort?.value
        ) && draftPonAssignment.status !== 'draft-held') {
            notify('That NAP port is unavailable. Select another available port.', 'error');
            return;
        }
        if (reviewForm.elements.area?.dataset.hasInvalidValue === 'true') {
            notify('Area / Cluster must match the coverage area list.', 'error');
            reviewForm.elements.area.focus();
            return;
        }
        if (!enforceNonPastReviewBillDateSelection()) {
            recomputeReviewDueDate();
            return;
        }

        const accountNumber = String(reviewForm.elements.accountNumber.value || getDraftAccountNumber(item) || '').trim();
        const displayName = [
            String(reviewForm.elements.firstName.value || '').trim(),
            String(reviewForm.elements.lastName.value || '').trim()
        ].filter(Boolean).join(' ') || String(item.customerName || '').trim() || 'this customer';
        const confirmed = window.appConfirm
            ? await window.appConfirm(
                `Are you sure you want to finalize ${displayName}${accountNumber ? ` (Account ${accountNumber})` : ''}?`,
                {
                    title: 'Finalize Customer',
                    okText: 'Yes',
                    cancelText: 'No'
                }
            )
            : window.confirm(
                `Are you sure you want to finalize ${displayName}${accountNumber ? ` (Account ${accountNumber})` : ''}?`
            );
        if (!confirmed) return;

        approveBtn.disabled = true;
        approveBtn.innerHTML = '<i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i> Finalizing...';
        try {
            const payload = readReviewFormPayload();
            if (!String(payload.planId || '').trim()) {
                notify('Select a valid plan from the system list.', 'error');
                return;
            }
            const data = await apiFetch(`/api/customer-drafts/${encodeURIComponent(item.id)}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ draftData: payload })
            });
            closeReviewModal();
            await loadQueue();
            notify(`Customer account ${data.customer?.accountNumber || ''} finalized.`, 'success');
        } catch (error) {
            notify(error.message || 'Unable to finalize customer.', 'error');
        } finally {
            approveBtn.disabled = false;
            approveBtn.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Finalize Customer';
        }
    };

    const handleDelete = async (item) => {
        if (!item) return;
        const draftKind = getQueueStatus(item) === 'in-progress' ? 'incomplete draft' : 'pending draft';
        const accountNumber = getDraftAccountNumber(item);
        const displayName = String(item.customerName || item.draftData?.name || '').trim() || 'this customer';
        const confirmed = window.appConfirm
            ? await window.appConfirm(
                `Delete ${displayName}${accountNumber ? ` (Account ${accountNumber})` : ''}? This will remove the ${draftKind}.`,
                {
                    title: 'Delete Customer Draft',
                    okText: 'Delete',
                    cancelText: 'Cancel'
                }
            )
            : window.confirm(
                `Delete ${displayName}${accountNumber ? ` (Account ${accountNumber})` : ''}? This will remove the ${draftKind}.`
            );
        if (!confirmed) return;

        try {
            await apiFetch(`/api/customer-drafts/${encodeURIComponent(item.id)}`, {
                method: 'DELETE'
            });
            state.selectedIds.delete(getItemId(item));
            if (state.activeId === String(item.id || '').trim()) {
                closeReviewModal();
            }
            await loadQueue();
            notify(`${draftKind === 'incomplete draft' ? 'Incomplete' : 'Pending'} customer draft deleted.`, 'success');
        } catch (error) {
            notify(error.message || `Unable to delete the ${draftKind}.`, 'error');
        }
    };

    const handleDeleteSelected = async () => {
        if (bulkDeleteInProgress) return;
        const submissionIds = [...state.selectedIds].filter((itemId) => state.itemsById.has(itemId));
        const queueLabel = getQueueLabel();
        if (!submissionIds.length) {
            notify(`Select at least one ${state.queueStatus === 'in-progress' ? 'incomplete' : 'pending'} draft to delete.`, 'warning');
            renderTable();
            return;
        }

        const confirmed = window.appConfirm
            ? await window.appConfirm(
                `Delete ${submissionIds.length} selected ${queueLabel}? This will remove the selected customer drafts.`,
                {
                    title: 'Delete Selected Drafts',
                    okText: 'Delete',
                    cancelText: 'Cancel'
                }
            )
            : window.confirm(
                `Delete ${submissionIds.length} selected ${queueLabel}? This will remove the selected customer drafts.`
            );
        if (!confirmed) return;

        bulkDeleteInProgress = true;
        renderTable();
        try {
            const response = await apiFetch('/api/customer-drafts/bulk-delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ submissionIds })
            });
            if (state.activeId && submissionIds.includes(state.activeId)) {
                closeReviewModal();
            }
            submissionIds.forEach((itemId) => state.selectedIds.delete(itemId));
            await loadQueue();
            notify(
                response.deletedCount === 1
                    ? `1 ${state.queueStatus === 'in-progress' ? 'incomplete' : 'pending'} customer draft deleted.`
                    : `${response.deletedCount || submissionIds.length} ${state.queueStatus === 'in-progress' ? 'incomplete' : 'pending'} customer drafts deleted.`,
                'success'
            );
        } catch (error) {
            notify(error.message || 'Unable to delete selected customer drafts.', 'error');
        } finally {
            bulkDeleteInProgress = false;
            renderTable();
        }
    };

    tableBody?.addEventListener('change', (event) => {
        const checkbox = event.target.closest('[data-draft-select]');
        if (!checkbox) return;
        const itemId = String(checkbox.getAttribute('data-draft-select') || '').trim();
        if (!itemId) return;
        if (checkbox.checked) {
            state.selectedIds.add(itemId);
        } else {
            state.selectedIds.delete(itemId);
        }
        renderTable();
    });

    tableBody?.addEventListener('click', async (event) => {
        const copyAccountBtn = event.target.closest('[data-copy-account-number]');
        if (copyAccountBtn) {
            event.preventDefault();
            event.stopPropagation();
            const accountNumber = String(copyAccountBtn.dataset.copyAccountNumber || '').trim();
            if (!accountNumber) {
                notify('Account number is not available to copy.', 'warning');
                return;
            }
            const copied = await copyTextToClipboard(accountNumber);
            notify(copied ? 'Account number copied.' : 'Unable to copy account number.', copied ? 'success' : 'error');
            return;
        }

        const selectCheckbox = event.target.closest('[data-draft-select]');
        if (selectCheckbox) {
            event.stopPropagation();
            return;
        }

        const deleteBtn = event.target.closest('[data-draft-delete]');
        if (deleteBtn) {
            event.preventDefault();
            event.stopPropagation();
            const item = state.itemsById.get(String(deleteBtn.dataset.draftDelete || '').trim());
            if (item) await handleDelete(item);
            return;
        }

        const openBtn = event.target.closest('[data-draft-open]');
        if (openBtn) {
            const item = state.itemsById.get(String(openBtn.dataset.draftOpen || '').trim());
            if (item) openReviewModal(item);
            return;
        }

        const row = event.target.closest('tr[data-draft-id]');
        if (!row || event.target.closest('.row-actions') || event.target.closest('.draft-select-cell')) return;
        const item = state.itemsById.get(String(row.dataset.draftId || '').trim());
        if (item) openReviewModal(item);
    });

    selectPageCheckbox?.addEventListener('change', () => {
        const { pageItems } = getPaginationSnapshot();
        const pageIds = pageItems.map((item) => getItemId(item)).filter(Boolean);
        if (selectPageCheckbox.checked) {
            pageIds.forEach((itemId) => state.selectedIds.add(itemId));
        } else {
            pageIds.forEach((itemId) => state.selectedIds.delete(itemId));
        }
        renderTable();
    });
    deleteSelectedBtn?.addEventListener('click', () => {
        handleDeleteSelected().catch((error) => {
            notify(error.message || 'Unable to delete selected customer drafts.', 'error');
        });
    });

    searchInput?.addEventListener('input', () => {
        state.searchTerm = String(searchInput.value || '').trim();
        state.pagination.page = 1;
        renderTable();
    });
    statusSelect?.addEventListener('change', () => {
        state.queueStatus = String(statusSelect.value || 'pending').trim().toLowerCase() === 'in-progress'
            ? 'in-progress'
            : 'pending';
        state.selectedIds.clear();
        state.pagination.page = 1;
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="9" class="draft-empty text-secondary text-center">Loading drafts...</td></tr>';
        }
        loadQueue().catch((error) => {
            notify(error.message || 'Unable to load draft queue.', 'error');
        });
    });
    pageSizeSelect?.addEventListener('change', () => {
        const nextSize = Number(pageSizeSelect.value) || 10;
        state.pagination.pageSize = nextSize;
        state.pagination.page = 1;
        localStorage.setItem('draftQueuePageSize', String(nextSize));
        renderTable();
    });
    footerPrevBtn?.addEventListener('click', () => {
        if (state.pagination.page <= 1) return;
        state.pagination.page -= 1;
        renderTable();
    });
    footerNextBtn?.addEventListener('click', () => {
        const { total, pageCount } = getPaginationSnapshot();
        if (state.pagination.page >= pageCount) return;
        state.pagination.page += 1;
        renderTable();
    });
    reviewCloseBtn?.addEventListener('click', closeReviewModal);
    reviewCancelBtn?.addEventListener('click', closeReviewModal);
    reviewModal?.addEventListener('click', (event) => {
        if (event.target === reviewModal) closeReviewModal();
    });
    reviewForm?.addEventListener('submit', handleApprove);
    reviewForm?.elements?.area?.addEventListener('change', () => {
        const areaSelect = reviewForm.elements.area;
        const value = String(areaSelect.value || '').trim();
        if (value) {
            areaSelect.dataset.pendingValue = value;
            areaSelect.dataset.hasInvalidValue = 'false';
        } else {
            delete areaSelect.dataset.pendingValue;
            delete areaSelect.dataset.hasInvalidValue;
        }
    });
    reviewPlanSelect?.addEventListener('change', () => syncReviewPlanFields(true));
    reviewPlanCategory?.addEventListener('change', () => applyReviewPlanCategoryUI(reviewPlanCategory.value || 'postpaid'));
    reviewForm?.elements?.activationDate?.addEventListener('change', () => {
        syncReviewBillDateMin();
        enforceNonPastReviewBillDateSelection();
        recomputeReviewDueDate();
    });
    reviewBillDateInput?.addEventListener('change', () => {
        enforceNonPastReviewBillDateSelection();
        recomputeReviewDueDate();
    });
    reviewDueOffsetInput?.addEventListener('input', recomputeReviewDueDate);
    reviewPrepaidExpirationInput?.addEventListener('change', recomputeReviewDueDate);
    reviewLoginPasswordToggleBtn?.addEventListener('click', () => {
        setReviewPasswordVisibility(reviewLoginPasswordInput?.type === 'password');
    });
    reviewNapSelect?.addEventListener('change', () => {
        const currentPort = reviewNapSelect.value === reviewNapSelect.dataset.currentNapId
            ? reviewNapPortSelect?.dataset?.currentPort || ''
            : '';
        populateReviewPortOptions(reviewNapSelect.value, currentPort);
    });

    Promise.all([loadPlans(), loadCoverageAreas(), loadQueue()]).catch((error) => {
        notify(error.message || 'Unable to load draft queue.', 'error');
    });
})();
