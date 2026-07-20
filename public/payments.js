document.addEventListener('DOMContentLoaded', function () {
    const openPaymentModalBtn = document.getElementById('openPaymentModalBtn');
    const openCustomerAddBtn = document.getElementById('openCustomerAddBtn');
    const paymentModal = document.getElementById('paymentModal');
    const customerAddModal = document.getElementById('customerAddModal');
    const customerAddFrame = document.getElementById('customerAddFrame');
    const paymentModalRecorder = document.getElementById('paymentModalRecorder');
    const closePaymentModalBtn = document.getElementById('closePaymentModalBtn');
    const closeModalFooters = document.querySelectorAll('[data-dismiss="modal"]');
    const paymentForm = document.getElementById('paymentForm');
    const paymentFormSubmitBtn = paymentForm?.querySelector('button[type="submit"]');
    const setPaymentSubmitEnabled = (enabled) => {
        if (!paymentFormSubmitBtn) return;
        paymentFormSubmitBtn.disabled = !enabled;
    };
    const pendingPaymentAccounts = new Set();
    const customerSelect = document.getElementById('customerSelect');
    const paymentAmountInput = document.getElementById('paymentAmount');
    const paymentDateInput = document.getElementById('paymentDate');
    const paymentKindSelect = document.getElementById('paymentKind');
    const paymentMethodField = document.getElementById('paymentMethodField');
    const paymentMethodSelect = document.getElementById('paymentMethod');
    const paymentReferenceField = document.getElementById('paymentReferenceField');
    const paymentReferenceInput = document.getElementById('paymentReference');
    const paymentAmountField = document.getElementById('paymentAmountField');
    const prepaidPlanField = document.getElementById('prepaidPlanField');
    const prepaidPlanSelect = document.getElementById('prepaidPlanSelect');
    const prepaidPlanHint = document.getElementById('prepaidPlanHint');
    const prepaidExpiryField = document.getElementById('prepaidExpiryField');
    const prepaidExpiryDate = document.getElementById('prepaidExpiryDate');
    const paymentsTableBody = document.querySelector('.payments-table tbody');
    const searchInput = document.querySelector('.search-field input[type="search"]');
    const toast = document.getElementById('toast');

    const historyModal = document.getElementById('historyModal');
    const selectedCustomerName = document.getElementById('selectedCustomerName');
    const paymentHistoryBulkToolbar = document.getElementById('paymentHistoryBulkToolbar');
    const paymentHistorySelectAll = document.getElementById('paymentHistorySelectAll');
    const paymentHistorySelectedCount = document.getElementById('paymentHistorySelectedCount');
    const paymentHistoryDeleteSelectedBtn = document.getElementById('paymentHistoryDeleteSelectedBtn');
    const paymentHistoryTimeline = document.getElementById('paymentHistoryTimeline');
    const accountInfoModal = document.getElementById('accountInfoModal');
    const accountInfoEditBtn = document.getElementById('accountInfoEditBtn');
    const accountInfoInitials = document.getElementById('accountInfoInitials');
    const accountInfoFullName = document.getElementById('accountInfoFullName');
    const accountInfoAccountLabel = document.getElementById('accountInfoAccountLabel');
    const accountInfoEmail = document.getElementById('accountInfoEmail');
    const accountInfoMobile = document.getElementById('accountInfoMobile');
    const accountInfoAddress = document.getElementById('accountInfoAddress');
    const accountInfoBalanceCard = document.getElementById('accountInfoBalanceCard');
    const accountInfoCurrentBalance = document.getElementById('accountInfoCurrentBalance');
    const accountInfoBalanceTag = document.getElementById('accountInfoBalanceTag');
    const accountInfoBalanceHelper = document.getElementById('accountInfoBalanceHelper');
    const accountInfoPayNowBtn = document.getElementById('accountInfoPayNowBtn');
    const accountInfoSendReminderBtn = document.getElementById('accountInfoSendReminderBtn');
    const accountInfoWifiBtn = document.getElementById('accountInfoWifiBtn');
    const canUseDirectWifi = () => Boolean(window.directWifiEnabled ?? window.isDanteFlavor);
    const syncAccountInfoWifiVisibility = () => {
        if (accountInfoWifiBtn) accountInfoWifiBtn.hidden = !canUseDirectWifi();
    };
    syncAccountInfoWifiVisibility();
    window.addEventListener('flavor:metadata', syncAccountInfoWifiVisibility);
    const accountInfoStatusCard = document.getElementById('accountInfoStatusCard');
    const accountInfoStatusPill = document.getElementById('accountInfoStatusPill');
    const accountInfoSidebarPlan = document.getElementById('accountInfoSidebarPlan');
    const accountInfoStmtAccount = document.getElementById('accountInfoStmtAccount');
    const accountInfoStmtBilling = document.getElementById('accountInfoStmtBilling');
    const accountInfoStmtThermal = document.getElementById('accountInfoStmtThermal');
    const accountInfoPlanType = document.getElementById('accountInfoPlanType');
    const accountInfoPlanName = document.getElementById('accountInfoPlanName');
    const accountInfoBillingCycle = document.getElementById('accountInfoBillingCycle');
    const accountInfoArea = document.getElementById('accountInfoArea');
    const accountInfoMapPinLink = document.getElementById('accountInfoMapPinLink');
    const accountInfoRemarks = document.getElementById('accountInfoRemarks');
    const accountInfoPortalUsername = document.getElementById('accountInfoPortalUsername');
    const accountInfoPortalPassword = document.getElementById('accountInfoPortalPassword');
    const accountInfoPlanPrice = document.getElementById('accountInfoPlanPrice');
    const accountInfoPlanBilling = document.getElementById('accountInfoPlanBilling');
    const accountInfoActivationDate = document.getElementById('accountInfoActivationDate');
    const accountInfoBillDate = document.getElementById('accountInfoBillDate');
    const accountInfoDueRow = document.getElementById('accountInfoDueRow');
    const accountInfoDueDate = document.getElementById('accountInfoDueDate');
    const accountInfoDueBadge = document.getElementById('accountInfoDueBadge');
    const accountInfoDueAfter = document.getElementById('accountInfoDueAfter');
    const accountInfoCreditLimit = document.getElementById('accountInfoCreditLimit');
    const accountInfoMikrotikPanel = document.getElementById('accountInfoMikrotikPanel');
    const accountInfoRouter = document.getElementById('accountInfoRouter');
    const accountInfoPppoeUsername = document.getElementById('accountInfoPppoeUsername');
    const accountInfoPppoePassword = document.getElementById('accountInfoPppoePassword');
    const accountInfoPppoeProfile = document.getElementById('accountInfoPppoeProfile');
    const accountInfoNapPanel = document.getElementById('accountInfoNapPanel');
    const accountInfoNapInfo = document.getElementById('accountInfoNapInfo');
    const accountInfoNapPort = document.getElementById('accountInfoNapPort');
    const accountInfoOpticalInfo = document.getElementById('accountInfoOpticalInfo');
    const accountInfoMikrotikStatus = document.getElementById('accountInfoMikrotikStatus');
    const accountInfoMikrotikStatusRow = accountInfoMikrotikStatus?.closest('.view-row') || null;
    const accountInfoHistoryToolbar = document.getElementById('accountInfoHistoryToolbar');
    const accountInfoHistorySelectAll = document.getElementById('accountInfoHistorySelectAll');
    const accountInfoHistoryTableSelectAll = document.getElementById('accountInfoHistoryTableSelectAll');
    const accountInfoHistorySelectedCount = document.getElementById('accountInfoHistorySelectedCount');
    const accountInfoHistoryDeleteSelectedBtn = document.getElementById('accountInfoHistoryDeleteSelectedBtn');
    const accountInfoHistoryBody = document.getElementById('accountInfoHistoryBody');
    const accountInfoHistoryEmpty = document.getElementById('accountInfoHistoryEmpty');

    const filterModal = document.getElementById('filterModal');
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    const paymentsSortSelect = document.getElementById('paymentsSortSelect');
    const filterStatusSelect = document.getElementById('filterStatus');
    const filterAreaSelect = document.getElementById('filterArea');
    const filterDueDateInput = document.getElementById('filterDueDate');
    const paymentFilterAreaPicker = document.getElementById('paymentFilterAreaPicker');
    const paymentFilterAreaTrigger = document.getElementById('paymentFilterAreaTrigger');
    const paymentFilterAreaPanel = document.getElementById('paymentFilterAreaPanel');
    const paymentFilterAreaOptions = document.getElementById('paymentFilterAreaOptions');
    const paymentFilterAreaSelectAll = document.getElementById('paymentFilterAreaSelectAll');
    const accountViewShared = window.AccountViewShared || null;
    const SORT_FILTER_STORAGE_KEY = 'paymentsSortFilter';
    const DEFAULT_SORT_FILTER = 'newOld';
    const BUSINESS_PROFILE_STORAGE_KEY = 'dante-business-profile';
    const DEFAULT_BUSINESS_NAME = 'Dante Point To Point Pisonet';
    const rootElement = document.documentElement;
    const bodyElement = document.body;

    let allCustomers = [];
    let filteredPaymentsState = [];
    let lastFocusedElement = null;
    let currentUser = null;
    let selectedCustomer = null;
    let prepaidAutoAmount = null;
    let activeAccountInfoAccount = '';
    let mikrotikEnabled = Boolean(window.mikrotikEnabled);
    let accountInfoCopyValues = Object.create(null);
    let accountInfoLiveRefreshTimer = null;
    let accountInfoPppoeLiveTimer = null;
    let accountInfoLiveRefreshInFlight = false;
    let accountInfoPppoeLiveInFlight = false;
    let accountInfoHistoryRowsCache = [];
    let accountInfoHistoryExpandedAccount = '';
    const accountInfoPppoeLiveSamples = new Map();
    const accountInfoHistorySelectedEntryIds = new Set();
    const accountInfoHistoryExpandedYears = new Set();
    let paymentHistoryExpandedAccount = '';
    let paymentHistoryEntries = [];
    const paymentHistorySelectedEntryIds = new Set();
    const paymentHistoryExpandedYears = new Set();
    const ACCOUNT_INFO_LIVE_REFRESH_MS = 4000;
    const ACCOUNT_INFO_PPPOE_LIVE_REFRESH_MS = 1000;
    let customerFormBridgeReady = false;
    let pendingCustomerFormRequest = null;
    let areaFilterInitialized = false;
    let paymentModalIgnoreCloseUntil = 0;

    const applyAccountInfoMikrotikVisibility = () => {
        if (accountInfoMikrotikPanel && !mikrotikEnabled) {
            accountInfoMikrotikPanel.style.display = 'none';
        }
        if (accountInfoMikrotikStatusRow) {
            accountInfoMikrotikStatusRow.style.display = mikrotikEnabled ? '' : 'none';
        }
    };

    const loadMikrotikVisibilityState = async () => {
        try {
            if (typeof window.fetchMikrotikEnabledState === 'function') {
                const visibilityState = await window.fetchMikrotikEnabledState();
                mikrotikEnabled = Boolean(visibilityState?.enabled);
            } else {
                mikrotikEnabled = Boolean(window.mikrotikEnabled);
            }
        } catch (error) {
            mikrotikEnabled = false;
            console.warn('Unable to load MikroTik visibility state:', error?.message || error);
        }
        applyAccountInfoMikrotikVisibility();
    };

    const getCustomerRouterId = (customer = {}) => String(
        customer?.mikrotikId || customer?.routerId || customer?.router_id || ''
    ).trim();

    const updateAccountInfoPppoeLive = async (customer = {}, viewState = {}) => {
        if (accountInfoPppoeLiveInFlight) return;
        if (!accountViewShared?.buildPppoeLiveState || !accountViewShared?.renderPppoeLiveState) return;
        if (!accountInfoModal?.classList.contains('show')) return;
        const username = String(customer?.pppoeUsername || '').trim();
        if (!mikrotikEnabled || !username) {
            const state = accountViewShared.buildPppoeLiveState({
                username,
                profile: viewState?.pppoeProfile,
                fallbackStatus: customer?.mikrotikStatus || ''
            });
            accountViewShared.renderPppoeLiveState(accountInfoModal, state);
            return;
        }
        const routerId = getCustomerRouterId(customer);
        const sampleKey = `${routerId || 'default'}:${username.toLowerCase()}`;
        accountInfoPppoeLiveInFlight = true;
        try {
            const query = routerId ? `?routerId=${encodeURIComponent(routerId)}` : '';
            const response = await fetch(`/api/mikrotik/pppoe/active${query}`, { credentials: 'include', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Unable to load PPPoE live state.');
            const state = accountViewShared.buildPppoeLiveState({
                payload,
                username,
                profile: viewState?.pppoeProfile,
                fallbackStatus: customer?.mikrotikStatus || viewState?.mikrotikStatus || '',
                previousSample: accountInfoPppoeLiveSamples.get(sampleKey) || null
            });
            accountInfoPppoeLiveSamples.set(sampleKey, state.sample);
            accountViewShared.renderPppoeLiveState(accountInfoModal, state);
        } catch (error) {
            const state = accountViewShared.buildPppoeLiveState({
                username,
                profile: viewState?.pppoeProfile,
                fallbackStatus: customer?.mikrotikStatus || viewState?.mikrotikStatus || '',
                previousSample: accountInfoPppoeLiveSamples.get(sampleKey) || null
            });
            accountViewShared.renderPppoeLiveState(accountInfoModal, state);
            console.warn('PPPoE live state refresh failed:', error?.message || error);
        } finally {
            accountInfoPppoeLiveInFlight = false;
        }
    };

    const stopAccountInfoPppoeLiveRefresh = () => {
        if (accountInfoPppoeLiveTimer) {
            clearInterval(accountInfoPppoeLiveTimer);
            accountInfoPppoeLiveTimer = null;
        }
        accountInfoPppoeLiveInFlight = false;
    };

    const startAccountInfoPppoeLiveRefresh = (customer = {}, viewState = {}) => {
        stopAccountInfoPppoeLiveRefresh();
        const username = String(customer?.pppoeUsername || '').trim();
        if (!username || !mikrotikEnabled) {
            updateAccountInfoPppoeLive(customer, viewState);
            return;
        }
        updateAccountInfoPppoeLive(customer, viewState);
        accountInfoPppoeLiveTimer = setInterval(() => {
            updateAccountInfoPppoeLive(customer, viewState);
        }, ACCOUNT_INFO_PPPOE_LIVE_REFRESH_MS);
    };

    const syncModalScrollLock = () => {
        const hasOpenModal = Boolean(document.querySelector('.modal.show'));
        bodyElement.classList.toggle('modal-active', hasOpenModal);
        rootElement.classList.toggle('modal-active', hasOpenModal);
    };

    const buildCustomerFormFrameUrl = () => {
        const params = new URLSearchParams();
        params.set('embedded', 'payments');
        params.set('bridge', '2');
        return `customers.html?${params.toString()}`;
    };

    const sendCustomerFormRequest = (payload = {}) => {
        if (!customerAddFrame?.contentWindow) return;
        try {
            customerAddFrame.contentWindow.postMessage({
                source: 'payments-customer-form',
                context: 'payments',
                ...payload
            }, window.location.origin);
            return true;
        } catch {
            return false;
        }
    };

    const flushPendingCustomerFormRequest = () => {
        if (!customerFormBridgeReady || !pendingCustomerFormRequest) return false;
        const queuedRequest = pendingCustomerFormRequest;
        const sent = sendCustomerFormRequest(queuedRequest);
        if (sent) {
            pendingCustomerFormRequest = null;
        }
        return sent;
    };

    const queueCustomerFormRequest = (payload = {}) => {
        pendingCustomerFormRequest = payload;
        if (customerFormBridgeReady) {
            return flushPendingCustomerFormRequest();
        }
        primeCustomerAddFrame({ force: false });
        return false;
    };
    const getMultiSelectValues = (select) => {
        if (!select) return [];
        return Array.from(select.selectedOptions || [])
            .map((option) => String(option.value || '').trim())
            .filter(Boolean);
    };
    const setMultiSelectValues = (select, values = []) => {
        if (!select) return;
        const selected = new Set(
            (Array.isArray(values) ? values : [])
                .map((value) => String(value || '').trim().toLowerCase())
                .filter(Boolean)
        );
        Array.from(select.options || []).forEach((option) => {
            option.selected = selected.has(String(option.value || '').trim().toLowerCase());
        });
    };
    const createCheckboxAreaPicker = ({
        select,
        picker,
        trigger,
        panel,
        optionsContainer,
        selectAllCheckbox,
        onChange,
        emptyLabel = 'All areas'
    }) => {
        const noop = {
            rebuildOptions() {},
            sync() {},
            close() {}
        };
        if (!select || !picker || !trigger || !panel || !optionsContainer) return noop;

        const labelNode = trigger.querySelector('.filter-checklist__label') || trigger;
        const metaNode = trigger.querySelector('.filter-checklist__meta');
        const countNode = trigger.querySelector('.filter-checklist__count');
        const panelCountNode = panel.querySelector('.filter-checklist__panel-count');
        const normalizeValue = (value) => String(value || '').trim().toLowerCase();
        const getOptionEntries = () => Array.from(select.options || [])
            .map((option) => ({
                value: String(option.value || '').trim(),
                label: String(option.textContent || option.label || option.value || '').trim()
            }))
            .filter((entry) => entry.value);
        const getCheckedValues = () => Array.from(optionsContainer.querySelectorAll('input[type="checkbox"][data-area-value]:checked'))
            .map((input) => String(input.dataset.areaValue || '').trim())
            .filter(Boolean);
        const updateTriggerLabel = () => {
            const selectedValues = getMultiSelectValues(select);
            const totalOptions = getOptionEntries().length;
            if (!selectedValues.length) {
                labelNode.textContent = totalOptions > 0 ? 'No areas selected' : emptyLabel;
                if (metaNode) metaNode.textContent = totalOptions > 0 ? 'No customers shown' : 'No area filter available';
                if (countNode) {
                    countNode.hidden = true;
                    countNode.textContent = '0';
                }
                if (panelCountNode) panelCountNode.textContent = '0 selected';
                return;
            }
            if (totalOptions > 0 && selectedValues.length >= totalOptions) {
                labelNode.textContent = emptyLabel;
                if (metaNode) metaNode.textContent = 'All areas selected';
                if (countNode) {
                    countNode.hidden = true;
                    countNode.textContent = String(totalOptions);
                }
                if (panelCountNode) panelCountNode.textContent = `${totalOptions} selected`;
                return;
            }
            if (selectedValues.length === 1) {
                labelNode.textContent = selectedValues[0];
                if (metaNode) metaNode.textContent = '1 area selected';
            } else {
                labelNode.textContent = `${selectedValues.length} areas selected`;
                if (metaNode) metaNode.textContent = `${selectedValues.length} areas selected`;
            }
            if (countNode) {
                countNode.hidden = false;
                countNode.textContent = String(selectedValues.length);
            }
            if (panelCountNode) panelCountNode.textContent = `${selectedValues.length} selected`;
        };
        const updateSelectAllState = () => {
            if (!selectAllCheckbox) return;
            const total = getOptionEntries().length;
            const selectedCount = getMultiSelectValues(select).length;
            selectAllCheckbox.checked = total > 0 && selectedCount === total;
            selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < total;
            selectAllCheckbox.disabled = total === 0;
        };
        const syncFromSelect = () => {
            const selectedValues = new Set(getMultiSelectValues(select).map(normalizeValue));
            Array.from(optionsContainer.querySelectorAll('input[type="checkbox"][data-area-value]')).forEach((input) => {
                input.checked = selectedValues.has(normalizeValue(input.dataset.areaValue));
            });
            updateSelectAllState();
            updateTriggerLabel();
        };
        const notifySelectChange = () => {
            select.dispatchEvent(new Event('change', { bubbles: true }));
            if (typeof onChange === 'function') onChange();
        };
        const rebuildOptions = () => {
            const entries = getOptionEntries();
            optionsContainer.innerHTML = '';
            if (!entries.length) {
                const emptyState = document.createElement('p');
                emptyState.className = 'filter-checklist__empty';
                emptyState.textContent = 'No areas available.';
                optionsContainer.appendChild(emptyState);
                syncFromSelect();
                return;
            }
            entries.forEach((entry) => {
                const label = document.createElement('label');
                label.className = 'filter-checklist__option';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.dataset.areaValue = entry.value;
                const text = document.createElement('span');
                text.textContent = entry.label;
                label.append(input, text);
                optionsContainer.appendChild(label);
            });
            syncFromSelect();
        };
        const setOpen = (nextOpen) => {
            const open = Boolean(nextOpen);
            picker.classList.toggle('is-open', open);
            panel.hidden = !open;
            trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        };

        trigger.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(panel.hidden);
        });
        panel.addEventListener('click', (event) => {
            event.stopPropagation();
        });
        optionsContainer.addEventListener('change', (event) => {
            const input = event.target.closest('input[type="checkbox"][data-area-value]');
            if (!input) return;
            const changedValue = String(input.dataset.areaValue || '').trim();
            const entries = getOptionEntries();
            const previousValues = getMultiSelectValues(select);
            const wasAllSelected = entries.length > 0 && previousValues.length >= entries.length;
            const nextValues = wasAllSelected && changedValue
                ? [changedValue]
                : getCheckedValues();
            setMultiSelectValues(select, nextValues);
            syncFromSelect();
            notifySelectChange();
        });
        selectAllCheckbox?.addEventListener('change', () => {
            const values = selectAllCheckbox.checked ? getOptionEntries().map((entry) => entry.value) : [];
            setMultiSelectValues(select, values);
            syncFromSelect();
            notifySelectChange();
        });
        document.addEventListener('click', (event) => {
            if (panel.hidden) return;
            if (picker.contains(event.target)) return;
            setOpen(false);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !panel.hidden) {
                setOpen(false);
            }
        });

        syncFromSelect();
        return {
            rebuildOptions,
            sync: syncFromSelect,
            close: () => setOpen(false)
        };
    };
    const areaFilterPicker = createCheckboxAreaPicker({
        select: filterAreaSelect,
        picker: paymentFilterAreaPicker,
        trigger: paymentFilterAreaTrigger,
        panel: paymentFilterAreaPanel,
        optionsContainer: paymentFilterAreaOptions,
        selectAllCheckbox: paymentFilterAreaSelectAll,
        onChange: () => applyFilters(),
        emptyLabel: 'All areas'
    });

    function primeCustomerAddFrame(options = {}) {
        if (!customerAddFrame) return;
        const { force = false } = options;
        if (!force && customerAddFrame.src && customerAddFrame.src !== 'about:blank') return;
        customerFormBridgeReady = false;
        customerAddFrame.src = buildCustomerFormFrameUrl();
    }

    // --- Plan catalog for accurate plan display ---
    let plansCatalog = { prepaid: [], postpaid: [] };
    const planByName = new Map();
    const normalizePlanName = (name) => String(name || '').trim().toLowerCase();
    const normalizeAccountNumber = (value) => String(value ?? '').trim();
    const normalizeSubscriberStatus = (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'force-active') return 'active';
        if (raw === 'force-inactive') return 'inactive';
        if (raw === 'active' || raw === 'inactive' || raw === 'disabled') return raw;
        return '';
    };
    const resolveSubscriberStatus = (...sources) => {
        for (const source of sources) {
            if (!source || typeof source !== 'object') continue;
            for (const value of [source.subscriberStatus, source.customerStatus, source.status, source.statusRaw]) {
                const normalized = normalizeSubscriberStatus(value);
                if (normalized) return normalized;
            }
        }
        return 'active';
    };
    const normalizeEntryId = (value) => String(value ?? '').trim();
    const normalizeEntryIds = (values = []) => Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => normalizeEntryId(value))
            .filter(Boolean)
    ));
    const formatSelectionCount = (count) => `${count} selected`;
    const syncSelectedEntryIds = (selectedSet, entryIds) => {
        const available = new Set(normalizeEntryIds(entryIds));
        Array.from(selectedSet).forEach((entryId) => {
            if (!available.has(entryId)) {
                selectedSet.delete(entryId);
            }
        });
        return available;
    };
    const updateBulkSelectionUi = ({ toolbar, countNode, deleteBtn, selectAllInputs = [], selectedSet, entryIds }) => {
        const available = syncSelectedEntryIds(selectedSet, entryIds);
        const total = available.size;
        const selectedCount = selectedSet.size;
        if (toolbar) toolbar.hidden = total === 0;
        if (countNode) countNode.textContent = formatSelectionCount(selectedCount);
        if (deleteBtn) deleteBtn.disabled = selectedCount === 0;
        selectAllInputs.forEach((input) => {
            if (!input) return;
            input.checked = total > 0 && selectedCount === total;
            input.indeterminate = selectedCount > 0 && selectedCount < total;
            input.disabled = total === 0;
        });
        return { total, selectedCount, available };
    };
    const parseDeleteError = async (response, fallbackMessage) => {
        const payload = await response.json().catch(() => ({}));
        return payload.message || payload.error || fallbackMessage;
    };
    const deleteEntriesForAccount = async (accountNumber, entryIds) => {
        const normalizedAccount = normalizeAccountNumber(accountNumber);
        const normalizedIds = normalizeEntryIds(entryIds);
        if (!normalizedAccount || !normalizedIds.length) {
            throw new Error('Select at least one transaction to delete.');
        }
        const response = await fetch(`/api/payments/${encodeURIComponent(normalizedAccount)}/bulk-delete`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ entryIds: normalizedIds })
        });
        if (!response.ok) {
            throw new Error(await parseDeleteError(response, 'Failed to delete transactions'));
        }
        return response.json().catch(() => ({ deletedCount: normalizedIds.length }));
    };
    const getPaymentHistorySelectableIds = () => paymentHistoryEntries
        .map((entry) => normalizeEntryId(entry?.id))
        .filter(Boolean);
    const getAccountInfoHistorySelectableIds = () => accountInfoHistoryRowsCache
        .map((row) => normalizeEntryId(row?.entryId))
        .filter(Boolean);
    const updatePaymentHistoryBulkUi = () => updateBulkSelectionUi({
        toolbar: paymentHistoryBulkToolbar,
        countNode: paymentHistorySelectedCount,
        deleteBtn: paymentHistoryDeleteSelectedBtn,
        selectAllInputs: [paymentHistorySelectAll],
        selectedSet: paymentHistorySelectedEntryIds,
        entryIds: getPaymentHistorySelectableIds()
    });
    const updateAccountInfoHistoryBulkUi = () => updateBulkSelectionUi({
        toolbar: accountInfoHistoryToolbar,
        countNode: accountInfoHistorySelectedCount,
        deleteBtn: accountInfoHistoryDeleteSelectedBtn,
        selectAllInputs: [accountInfoHistorySelectAll, accountInfoHistoryTableSelectAll],
        selectedSet: accountInfoHistorySelectedEntryIds,
        entryIds: getAccountInfoHistorySelectableIds()
    });
    const applySelectionToAll = (selectedSet, entryIds, checked) => {
        selectedSet.clear();
        if (checked) {
            normalizeEntryIds(entryIds).forEach((entryId) => selectedSet.add(entryId));
        }
    };
    const urlParams = new URLSearchParams(window.location.search);
    let payNowAccountFromQuery = normalizeAccountNumber(urlParams.get('payNow') || '');
    const findCustomerByAccount = (list, accountNumber) => {
        const target = normalizeAccountNumber(accountNumber);
        return (Array.isArray(list) ? list : []).find(c => normalizeAccountNumber(c.accountNumber) === target);
    };
    const getCustomerArea = (customer) => String(
        customer?.area
        || customer?.coverageArea
        || customer?.cluster
        || ''
    ).trim();
    const addMonthClamp = (dateObj) => {
        const year = dateObj.getFullYear();
        const month = dateObj.getMonth();
        const day = dateObj.getDate();
        const next = new Date(year, month + 1, 1);
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        const targetDay = Math.min(day, lastDay);
        return new Date(next.getFullYear(), next.getMonth(), targetDay);
    };

    async function loadPlansCatalog() {
        try {
            const res = await fetch('/api/plans');
            const data = await res.json();
            plansCatalog = data.plans || { prepaid: [], postpaid: [] };
            planByName.clear();
            [...(plansCatalog.prepaid || []), ...(plansCatalog.postpaid || [])].forEach(plan => {
                planByName.set(normalizePlanName(plan.name), plan);
            });
            if (selectedCustomer && resolvePlanCategory(selectedCustomer) === 'prepaid') {
                populatePrepaidPlanOptions(selectedCustomer.planName || '');
                updatePrepaidPreview(selectedCustomer);
            }
        } catch (e) {
            // fallback: empty
            plansCatalog = { prepaid: [], postpaid: [] };
            planByName.clear();
        }
    }

    const savedPageSize = localStorage.getItem('paymentsPageSize');
    const initialPageSize = savedPageSize ? parseInt(savedPageSize, 10) : 2;

    const paymentsPagination = { page: 1, pageSize: initialPageSize };
    const paymentsFooter = document.getElementById('paymentsFooter');
    const paymentsSummary = document.getElementById('paymentsSummary');
    const paymentsPrev = document.getElementById('paymentsPrev');
    const paymentsNext = document.getElementById('paymentsNext');
    const paymentsPageInfo = document.getElementById('paymentsPageInfo');

    // Shared helpers for consistent formatting across views
    const pesoSign = '\u20B1';
    const MANILA_TIME_ZONE = 'Asia/Manila';
    const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
    const SQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    const ISO_DATETIME_NO_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
    const MANILA_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
        timeZone: MANILA_TIME_ZONE,
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
    const MANILA_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
        timeZone: MANILA_TIME_ZONE,
        hour: 'numeric',
        minute: '2-digit'
    });
    const MANILA_YEAR_FORMATTER = new Intl.DateTimeFormat('en-US', {
        timeZone: MANILA_TIME_ZONE,
        year: 'numeric'
    });
    const formatCurrency = (amount) => `${pesoSign}${(Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const parseDateOnlyParts = (value) => {
        const raw = String(value ?? '').trim();
        if (!raw) return null;
        const match = raw.match(DATE_ONLY_RE);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
        return { year, month, day };
    };
    const buildStableManilaDate = (year, month, day) => new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const parseDateValue = (value) => {
        if (!value && value !== 0) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        const dateOnlyParts = parseDateOnlyParts(raw);
        if (dateOnlyParts) {
            return new Date(dateOnlyParts.year, dateOnlyParts.month - 1, dateOnlyParts.day);
        }
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const parseTimestampValue = (value) => {
        if (!value && value !== 0) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        const dateOnlyParts = parseDateOnlyParts(raw);
        if (dateOnlyParts) {
            return new Date(dateOnlyParts.year, dateOnlyParts.month - 1, dateOnlyParts.day);
        }
        if (SQL_DATETIME_RE.test(raw)) {
            const parsed = new Date(raw.replace(' ', 'T') + 'Z');
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        if (ISO_DATETIME_NO_TZ_RE.test(raw)) {
            const parsed = new Date(`${raw}Z`);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const hasExplicitTime = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return false;
        return /T\d{2}:\d{2}/.test(raw) || /\d{2}:\d{2}(:\d{2})?/.test(raw);
    };
    const formatDate = (dateStr) => {
        const dateOnlyParts = parseDateOnlyParts(dateStr);
        if (dateOnlyParts) {
            return MANILA_DATE_FORMATTER.format(
                buildStableManilaDate(dateOnlyParts.year, dateOnlyParts.month, dateOnlyParts.day)
            );
        }
        const parsed = parseDateValue(dateStr);
        return parsed ? MANILA_DATE_FORMATTER.format(parsed) : 'N/A';
    };
    const formatDateTime = (value, fallback = 'N/A') => {
        if (!hasExplicitTime(value)) return formatDate(value);
        const parsed = parseTimestampValue(value);
        if (!parsed) return fallback;
        return `${MANILA_DATE_FORMATTER.format(parsed)}, ${MANILA_TIME_FORMATTER.format(parsed)}`;
    };
    const getManilaYearKey = (value) => {
        const dateOnlyParts = parseDateOnlyParts(value);
        if (dateOnlyParts) return String(dateOnlyParts.year);
        const parsed = hasExplicitTime(value) ? parseTimestampValue(value) : parseDateValue(value);
        if (!parsed) return 'unknown';
        return MANILA_YEAR_FORMATTER.format(parsed);
    };
    const formatDateISO = (dateObj) => {
        if (!(dateObj instanceof Date) || isNaN(dateObj)) return '';
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };
    const parseDateOnly = (value) => {
        const parsed = parseDateValue(value);
        if (!parsed) return null;
        parsed.setHours(0, 0, 0, 0);
        return parsed;
    };
    const computeExpiryDate = (baseDate, validityDays) => {
        const days = Number(validityDays);
        if (!(baseDate instanceof Date) || isNaN(baseDate) || !Number.isFinite(days) || days <= 0) return '';
        const expiry = new Date(baseDate);
        expiry.setDate(expiry.getDate() + days);
        return formatDateISO(expiry);
    };
    const formatRecorderLabel = (recorder, kind) => {
        if (recorder && (recorder.name || recorder.username || recorder.id)) {
            const base = recorder.name || recorder.username || recorder.id || 'Unknown';
            return recorder.role ? `${base} (${recorder.role})` : base;
        }
        if (kind) {
            const normalizedKind = String(kind).toLowerCase();
            if (normalizedKind === 'charge' || normalizedKind === 'bill') return 'System';
        }
        return 'Unknown';
    };
    const formatCustomerName = (customer) => {
        if (!customer) return 'Unknown customer';
        const trimmedName = (customer.name || '').trim();
        if (trimmedName) return trimmedName;
        const first = (customer.firstName || '').trim();
        const last = (customer.lastName || '').trim();
        if (first || last) return `${first}${first && last ? ' ' : ''}${last}`.trim();
        return customer.accountNumber ? `Account ${customer.accountNumber}` : 'Unknown customer';
    };
    const getCustomerNameParts = (customer) => {
        const rawFirst = String(customer?.firstName || '').trim();
        const rawLast = String(customer?.lastName || '').trim();
        const rawFull = String(customer?.name || '').trim();
        if (rawFirst || rawLast) {
            const fullName = rawFull || `${rawFirst}${rawFirst && rawLast ? ' ' : ''}${rawLast}`.trim();
            return { firstName: rawFirst, lastName: rawLast, fullName };
        }
        if (rawFull) {
            const parts = rawFull.split(/\s+/).filter(Boolean);
            const firstName = parts.shift() || '';
            const lastName = parts.join(' ');
            return { firstName, lastName, fullName: rawFull };
        }
        return { firstName: '', lastName: '', fullName: '' };
    };
    const formatSubscriberDisplayName = (nameParts, sortFilter = '') => {
        if (sortFilter === 'lastNameAsc' && (nameParts.lastName || nameParts.firstName)) {
            return [nameParts.lastName, nameParts.firstName].filter(Boolean).join(', ');
        }
        return nameParts.fullName
            || [nameParts.firstName, nameParts.lastName].filter(Boolean).join(' ')
            || 'No Name';
    };
    const toComparablePaymentTimestamp = (customer) => {
        const parseTimestamp = (value) => {
            const raw = String(value || '').trim();
            if (!raw || raw.toUpperCase() === 'N/A') return null;
            const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
                ? `${raw}T00:00:00`
                : (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(raw) ? raw.replace(/\s+/, 'T') : raw);
            const parsed = new Date(normalized);
            const time = parsed.getTime();
            return Number.isFinite(time) ? time : null;
        };

        const createdAtTime = parseTimestamp(customer?.createdAt);
        if (createdAtTime !== null) {
            return createdAtTime;
        }

        const fallbackSources = [
            customer?.updatedAt,
            customer?.activationDate,
            customer?.billDate,
            customer?.dueDate,
            customer?.lastPaymentDate
        ];
        for (const value of fallbackSources) {
            const time = parseTimestamp(value);
            if (time !== null) return time;
        }
        return 0;
    };
    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const formatViewText = (value, fallback = 'Not set') => {
        const textValue = String(value ?? '').trim();
        return textValue || fallback;
    };
    const toTitleCase = (value) => {
        const textValue = String(value || '').trim().toLowerCase();
        if (!textValue) return '';
        return textValue.charAt(0).toUpperCase() + textValue.slice(1);
    };
    const parseSafeDate = (value) => {
        if (!value) return null;
        const parsed = new Date(value);
        return isNaN(parsed) ? null : parsed;
    };
    const dateDiffDays = (fromDate, toDate) => {
        if (!(fromDate instanceof Date) || !(toDate instanceof Date)) return null;
        const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
        const end = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
        const diffMs = end.getTime() - start.getTime();
        return Math.round(diffMs / 86400000);
    };
    const buildMonthlyDate = (year, monthIndex, day) => {
        const safeDay = Math.min(day, new Date(year, monthIndex + 1, 0).getDate());
        return new Date(year, monthIndex, safeDay);
    };
    const getDueStatus = (dueDate) => {
        const parsed = parseDateOnly(dueDate);
        if (!parsed) return { state: '', label: '', days: null };
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
        const diffDays = Math.round((target - start) / 86400000);
        if (diffDays === 0) {
            return { state: 'today', label: 'Due today', days: 0 };
        }
        if (diffDays > 0) {
            return { state: 'upcoming', label: `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`, days: diffDays };
        }
        const overdue = Math.abs(diffDays);
        return { state: 'overdue', label: `Overdue \u00B7 ${overdue} day${overdue === 1 ? '' : 's'}`, days: overdue };
    };
    const getDisplayDueDateForPostpaid = (customer, { treatAsOverdue = false } = {}) => {
        const parsedDue = parseDateOnly(customer?.dueDate);
        if (!parsedDue) return formatDate(customer?.dueDate);
        if (treatAsOverdue) return formatDate(parsedDue);

        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const baseDay = parsedDue.getDate();
        let year = parsedDue.getFullYear();
        let month = parsedDue.getMonth();
        let candidate = buildMonthlyDate(year, month, baseDay);

        while (candidate < start) {
            month += 1;
            if (month > 11) {
                month = 0;
                year += 1;
            }
            candidate = buildMonthlyDate(year, month, baseDay);
        }

        return formatDate(candidate);
    };
    const isMonthlyChargeEntry = (entry = {}) => {
        const entryId = String(entry?.id || '').trim();
        const kind = String(entry?.kind || '').trim().toLowerCase();
        const direction = String(entry?.direction || entry?.nature || '').trim().toLowerCase();
        const description = String(entry?.description || '').trim().toLowerCase();
        if (/^bill-[^-]+-\d{4}-\d{2}$/i.test(entryId)) return true;
        return (kind === 'charge' || kind === 'debit')
            && (direction === 'debit' || !direction)
            && description === 'monthly recurring charge';
    };
    const getEntryDateKey = (entry = {}) => {
        const parsed = parseDateOnly(entry?.date || entry?.recordedAt || entry?.recorded_at || '');
        return parsed ? formatDateISO(parsed) : '';
    };
    const hasMonthlyChargeOnDate = (customer = {}, targetDateKey = '') => {
        if (!targetDateKey) return false;
        const history = Array.isArray(customer?.history) ? customer.history : [];
        return history.some((entry) => isMonthlyChargeEntry(entry) && getEntryDateKey(entry) === targetDateKey);
    };
    const hasAnyMonthlyChargeEntry = (customer = {}) => {
        const history = Array.isArray(customer?.history) ? customer.history : [];
        return history.some((entry) => isMonthlyChargeEntry(entry));
    };
    const resolveEntryDirection = (entry = {}) => {
        const kind = String(entry?.kind || '').trim().toLowerCase();
        const direction = String(entry?.direction || entry?.nature || '').trim().toLowerCase();
        if (direction === 'debit' || direction === 'credit') return direction;
        if (kind === 'charge' || kind === 'debit' || kind === 'bill') return 'debit';
        if (kind === 'payment' || kind === 'rebate' || kind === 'discount' || kind === 'credit') return 'credit';
        return '';
    };
    const getEntryComparableTime = (entry = {}) => {
        const parsed = parseTimestampValue(entry?.recordedAt || entry?.recorded_at || entry?.date || '');
        return parsed ? parsed.getTime() : 0;
    };
    const hasOutstandingMonthlyChargeOnDate = (customer = {}, targetDateKey = '') => {
        if (!targetDateKey) return false;
        const history = Array.isArray(customer?.history) ? customer.history : [];
        const ledger = history
            .map((entry, index) => {
                const amount = Math.abs(Number(entry?.amount) || 0);
                const direction = resolveEntryDirection(entry);
                if (!amount || !direction) return null;
                return {
                    entry,
                    amount,
                    direction,
                    dateKey: getEntryDateKey(entry),
                    isMonthlyCharge: isMonthlyChargeEntry(entry),
                    time: getEntryComparableTime(entry),
                    index
                };
            })
            .filter(Boolean)
            .sort((left, right) => {
                const timeDiff = left.time - right.time;
                if (timeDiff !== 0) return timeDiff;
                if (left.direction !== right.direction) return left.direction === 'debit' ? -1 : 1;
                return left.index - right.index;
            });

        const openDebits = [];
        let unappliedCredit = 0;
        const epsilon = 0.005;

        ledger.forEach((row) => {
            if (row.direction === 'debit') {
                let remaining = row.amount;
                if (unappliedCredit > epsilon) {
                    const applied = Math.min(remaining, unappliedCredit);
                    remaining = Number((remaining - applied).toFixed(2));
                    unappliedCredit = Number((unappliedCredit - applied).toFixed(2));
                }
                if (remaining > epsilon) {
                    openDebits.push({
                        remaining,
                        dateKey: row.dateKey,
                        isMonthlyCharge: row.isMonthlyCharge
                    });
                }
                return;
            }

            let credit = row.amount;
            for (const debit of openDebits) {
                if (credit <= epsilon) break;
                if (debit.remaining <= epsilon) continue;
                const applied = Math.min(debit.remaining, credit);
                debit.remaining = Number((debit.remaining - applied).toFixed(2));
                credit = Number((credit - applied).toFixed(2));
            }
            if (credit > epsilon) {
                unappliedCredit = Number((unappliedCredit + credit).toFixed(2));
            }
        });

        return openDebits.some((debit) => (
            debit.isMonthlyCharge
            && debit.dateKey === targetDateKey
            && debit.remaining > epsilon
        ));
    };
    const getCustomerCycleDay = (customer = {}) => {
        const billDate = parseDateOnly(customer?.billDate);
        if (billDate) return billDate.getDate();
        const dueDate = parseDateOnly(customer?.dueDate);
        if (dueDate) return dueDate.getDate();
        return null;
    };
    const matchesDueCycleFilter = (customer = {}, targetDateKey = '') => {
        if (!targetDateKey) return true;
        const targetDate = parseDateOnly(targetDateKey);
        if (!targetDate) return true;
        const balance = Number(customer?.balance);
        if (!Number.isFinite(balance) || balance <= 0) return false;

        const planCategory = resolvePlanCategory(customer);
        if (planCategory === 'prepaid') {
            const prepaidDue = parseDateOnly(customer?.prepaidExpirationAt || customer?.dueDate);
            return Boolean(prepaidDue && formatDateISO(prepaidDue) === targetDateKey);
        }

        if (hasMonthlyChargeOnDate(customer, targetDateKey)) {
            return hasOutstandingMonthlyChargeOnDate(customer, targetDateKey);
        }
        if (hasAnyMonthlyChargeEntry(customer)) return false;

        const cycleDay = getCustomerCycleDay(customer);
        return Number.isInteger(cycleDay) && cycleDay === targetDate.getDate();
    };

    function setPrepaidFieldsVisible(visible) {
        const display = visible ? '' : 'none';
        if (prepaidPlanField) prepaidPlanField.style.display = display;
        if (prepaidExpiryField) prepaidExpiryField.style.display = display;
        if (paymentAmountField) paymentAmountField.style.display = visible ? 'none' : '';
        if (paymentAmountInput) {
            paymentAmountInput.required = !visible;
            paymentAmountInput.readOnly = visible;
        }
        if (!visible) {
            if (prepaidPlanSelect) prepaidPlanSelect.value = '';
            if (prepaidExpiryDate) prepaidExpiryDate.value = '';
            if (prepaidPlanHint) prepaidPlanHint.textContent = '';
        }
    }

    function populatePrepaidPlanOptions(selectedName = '') {
        if (!prepaidPlanSelect) return;
        const plans = Array.isArray(plansCatalog.prepaid) ? plansCatalog.prepaid : [];
        prepaidPlanSelect.innerHTML = '<option value="">Select prepaid plan</option>';
        if (!plans.length) {
            prepaidPlanSelect.add(new Option('No prepaid plans available', ''));
            return;
        }
        plans
            .slice()
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
            .forEach((plan) => {
                if (!plan?.name) return;
                prepaidPlanSelect.add(new Option(plan.name, plan.name));
            });
        if (selectedName && plans.some((plan) => plan.name === selectedName)) {
            prepaidPlanSelect.value = selectedName;
        }
    }

    function getSelectedPrepaidPlan() {
        const name = prepaidPlanSelect?.value || '';
        if (!name) return null;
        const plan = planByName.get(normalizePlanName(name));
        if (plan && String(plan.category || '').toLowerCase() === 'prepaid') return plan;
        return null;
    }

    function derivePrepaidBaseDate(customer, paymentDateStr) {
        const paymentDate = parseDateOnly(paymentDateStr) || new Date();
        const dueDate = parseDateOnly(customer?.dueDate);
        if (dueDate && dueDate > paymentDate) return dueDate;
        return paymentDate;
    }

    function maybeAutofillAmount(plan) {
        if (!paymentAmountInput || !plan) return;
        const nextValue = Number(plan.price || 0).toFixed(2);
        if (!paymentAmountInput.value || paymentAmountInput.value === prepaidAutoAmount) {
            paymentAmountInput.value = nextValue;
            prepaidAutoAmount = nextValue;
        }
    }

    function updatePrepaidPreview(customer) {
        if (!customer) return;
        const plan = getSelectedPrepaidPlan();
        if (!plan) {
            if (prepaidExpiryDate) prepaidExpiryDate.value = '';
            if (prepaidPlanHint) prepaidPlanHint.textContent = '';
            return;
        }
        if (prepaidPlanHint) {
            prepaidPlanHint.textContent = plan.validity ? `Validity: ${plan.validity} day(s)` : '';
        }
        const baseDate = derivePrepaidBaseDate(customer, paymentDateInput?.value);
        const expiry = computeExpiryDate(baseDate, plan.validity);
        if (prepaidExpiryDate) prepaidExpiryDate.value = expiry || '';
        maybeAutofillAmount(plan);
    }

    function isPaymentTransactionKind() {
        return String(paymentKindSelect?.value || 'payment').trim().toLowerCase() === 'payment';
    }

    function syncPrepaidFieldsForSelectedCustomer() {
        if (!selectedCustomer || resolvePlanCategory(selectedCustomer) !== 'prepaid' || !isPaymentTransactionKind()) {
            setPrepaidFieldsVisible(false);
            return;
        }
        setPrepaidFieldsVisible(true);
        populatePrepaidPlanOptions(selectedCustomer?.planName || '');
        updatePrepaidPreview(selectedCustomer);
    }

    function showToast(message) {
        if (typeof window.appToast === 'function') {
            window.appToast(message, { type: 'info' });
            return;
        }
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    async function copyTextToClipboard(value) {
        const text = String(value || '').trim();
        if (!text) return false;
        if (navigator?.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (error) {
                // Fallback to execCommand for blocked clipboard contexts.
            }
        }
        const fallbackInput = document.createElement('textarea');
        fallbackInput.value = text;
        fallbackInput.setAttribute('readonly', '');
        fallbackInput.style.position = 'fixed';
        fallbackInput.style.opacity = '0';
        fallbackInput.style.pointerEvents = 'none';
        document.body.appendChild(fallbackInput);
        fallbackInput.focus();
        fallbackInput.select();
        let copied = false;
        try {
            copied = document.execCommand('copy');
        } catch (error) {
            copied = false;
        }
        fallbackInput.remove();
        return copied;
    }

    function getCurrentBusinessName() {
        const topbarName = String(document.getElementById('topbarBusinessName')?.textContent || '').trim();
        if (topbarName) return topbarName;
        try {
            const raw = localStorage.getItem(BUSINESS_PROFILE_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                const storedName = String(parsed?.businessName || '').trim();
                if (storedName) return storedName;
            }
        } catch (error) {
            // Ignore profile cache parsing errors and fall back to default name.
        }
        return DEFAULT_BUSINESS_NAME;
    }

    function buildCopiedAccountText({ accountName = '', accountNumber = '' } = {}) {
        const normalizedAccountNumber = normalizeAccountNumber(accountNumber);
        if (!normalizedAccountNumber) return '';
        const normalizedAccountName = String(accountName || '').trim() || 'N/A';
        return [
            getCurrentBusinessName(),
            `Account Name : ${normalizedAccountName}`,
            `Account Number : ${normalizedAccountNumber}`
        ].join('\n');
    }

    const sanitizeCopyValue = (value) => {
        const text = String(value || '').trim();
        if (!text || text === '--' || text === 'Not set' || text === 'Set (reset required to view)') return '';
        return text;
    };

    const getCopyFieldLabel = (fieldName) => {
        if (fieldName === 'accountNumber') return 'Account number';
        if (fieldName === 'loginUsername') return 'Portal username';
        if (fieldName === 'loginPassword') return 'Portal password';
        if (fieldName === 'pppoeUsername') return 'PPPoE username';
        if (fieldName === 'pppoePassword') return 'PPPoE password';
        if (fieldName === 'pppoeAssignedIp') return 'Assigned IP';
        return 'Value';
    };

    const getAccountInfoCopyValue = (fieldName) => {
        const cached = sanitizeCopyValue(accountInfoCopyValues?.[fieldName]);
        if (cached) return cached;
        const liveNode = accountInfoModal?.querySelector(`[data-view="${fieldName}"]`);
        return sanitizeCopyValue(liveNode?.textContent || '');
    };

    function updateRecorderHint() {
        if (!paymentModalRecorder) return;
        if (!currentUser) {
            paymentModalRecorder.textContent = 'Recorder unavailable. Please sign in again.';
            return;
        }
        const displayName = (currentUser.name || currentUser.username || '').trim() || 'Current user';
        const roleSuffix = currentUser.role ? ` (${currentUser.role})` : '';
        paymentModalRecorder.textContent = `Recording as ${displayName}${roleSuffix}`;
    }

    function syncPaymentMethodVisibility() {
        const showPaymentMethod = String(paymentKindSelect?.value || '').trim().toLowerCase() === 'payment';
        if (paymentMethodField) {
            paymentMethodField.hidden = !showPaymentMethod;
            paymentMethodField.style.display = showPaymentMethod ? '' : 'none';
        }
        if (paymentMethodSelect) {
            paymentMethodSelect.required = showPaymentMethod;
            paymentMethodSelect.disabled = !showPaymentMethod;
            if (showPaymentMethod && !paymentMethodSelect.value) {
                paymentMethodSelect.value = 'Cash';
            }
        }
        if (paymentReferenceField) {
            paymentReferenceField.hidden = !showPaymentMethod;
            paymentReferenceField.style.display = showPaymentMethod ? '' : 'none';
        }
        if (paymentReferenceInput) {
            paymentReferenceInput.disabled = !showPaymentMethod;
        }
    }

    function openModal() {
        paymentForm.reset();
        document.getElementById('paymentDate').valueAsDate = new Date();
        selectedCustomer = null;
        prepaidAutoAmount = null;
        setPrepaidFieldsVisible(false);
        syncPaymentMethodVisibility();
        // no payer input anymore; server will set payer from req.user
        lastFocusedElement = document.activeElement;
        paymentModalIgnoreCloseUntil = Date.now() + 500;
        paymentModal.classList.add('show');
        paymentModal.setAttribute('aria-hidden', 'false');
        syncModalScrollLock();
        updateRecorderHint();
        customerSelect.focus();
    }

    function openPaymentModalForAccount(accountNumber) {
        const targetAccount = normalizeAccountNumber(accountNumber);
        if (!targetAccount) return false;

        const customer = findCustomerByAccount(allCustomers, targetAccount);
        if (!customer) return false;

        openModal();

        // Pre-select customer and trigger the existing auto-fill logic.
        customerSelect.value = targetAccount;
        customerSelect.dispatchEvent(new Event('change'));

        return true;
    }

    function closeModal(options = {}) {
        if (!options.force && Date.now() < paymentModalIgnoreCloseUntil) return;
        paymentModal.classList.remove('show');
        paymentModal.setAttribute('aria-hidden', 'true');
        syncModalScrollLock();
        lastFocusedElement?.focus();
    }

    function openCustomerAddModal() {
        if (!customerAddModal || !customerAddFrame) return;
        lastFocusedElement = document.activeElement;
        if (accountInfoModal?.classList.contains('show')) {
            stopAccountInfoLiveRefresh();
        }
        primeCustomerAddFrame({ force: false });
        customerAddModal.classList.add('show');
        customerAddModal.setAttribute('aria-hidden', 'false');
        syncModalScrollLock();
        queueCustomerFormRequest({ type: 'open-add' });
    }

    function openCustomerEditModal(accountNumber) {
        const targetAccount = normalizeAccountNumber(accountNumber);
        if (!customerAddModal || !customerAddFrame || !targetAccount) return false;
        lastFocusedElement = document.activeElement;
        if (accountInfoModal?.classList.contains('show')) {
            stopAccountInfoLiveRefresh();
        }
        primeCustomerAddFrame({ force: false });
        customerAddModal.classList.add('show');
        customerAddModal.setAttribute('aria-hidden', 'false');
        syncModalScrollLock();
        queueCustomerFormRequest({ type: 'open-edit', accountNumber: targetAccount });
        return true;
    }

    function closeCustomerAddModal(options = {}) {
        if (!customerAddModal || !customerAddFrame) return;
        const { restoreFocus = true, syncChildForm = true } = options;
        customerAddModal.classList.remove('show');
        customerAddModal.setAttribute('aria-hidden', 'true');
        if (syncChildForm && customerFormBridgeReady) {
            sendCustomerFormRequest({ type: 'close-form', notifyParent: false });
        }
        syncModalScrollLock();
        if (accountInfoModal?.classList.contains('show') && normalizeAccountNumber(activeAccountInfoAccount)) {
            startAccountInfoLiveRefresh(activeAccountInfoAccount);
        }
        if (restoreFocus) {
            lastFocusedElement?.focus();
        }
    }

    function closeHistoryModal() {
        const closeButton = historyModal.querySelector('.close-modal');
        closeButton.focus(); // Temporarily focus to avoid error before hiding
        historyModal.classList.remove('show');
        historyModal.setAttribute('aria-hidden', 'true');
        syncModalScrollLock();
        paymentHistorySelectedEntryIds.clear();
        updatePaymentHistoryBulkUi();
        lastFocusedElement?.focus();
    }

    const stopAccountInfoLiveRefresh = () => {
        if (accountInfoLiveRefreshTimer) {
            clearInterval(accountInfoLiveRefreshTimer);
            accountInfoLiveRefreshTimer = null;
        }
        stopAccountInfoPppoeLiveRefresh();
        accountInfoLiveRefreshInFlight = false;
    };

    const fetchLatestAccountRecord = async (accountNumber) => {
        const target = normalizeAccountNumber(accountNumber);
        if (!target) return null;
        const response = await fetch(`/api/payment-records/${encodeURIComponent(target)}`, {
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) return null;
        const data = await response.json().catch(() => ({}));
        return data?.record || null;
    };

    const upsertAccountRecord = (record) => {
        const accountNumber = normalizeAccountNumber(record?.accountNumber);
        if (!accountNumber) return;
        const idx = allCustomers.findIndex((entry) => normalizeAccountNumber(entry?.accountNumber) === accountNumber);
        if (idx >= 0) {
            allCustomers[idx] = { ...allCustomers[idx], ...record };
        } else {
            allCustomers.push(record);
        }
    };

    const startAccountInfoLiveRefresh = (accountNumber) => {
        const target = normalizeAccountNumber(accountNumber);
        if (!target) return;
        stopAccountInfoLiveRefresh();

        const refresh = async () => {
            if (accountInfoLiveRefreshInFlight) return;
            if (!accountInfoModal?.classList.contains('show')) return;
            if (normalizeAccountNumber(activeAccountInfoAccount) !== target) return;
            accountInfoLiveRefreshInFlight = true;
            try {
                const latest = await fetchLatestAccountRecord(target);
                if (!latest) return;
                upsertAccountRecord(latest);
                // Re-render using fresh data without resetting focus/timer.
                openAccountInfoModal(target, null, { skipLiveStart: true, preserveFocus: true });
            } catch (error) {
                console.warn('Account info live refresh failed:', error?.message || error);
            } finally {
                accountInfoLiveRefreshInFlight = false;
            }
        };

        // Immediate refresh, then polling.
        refresh();
        accountInfoLiveRefreshTimer = setInterval(refresh, ACCOUNT_INFO_LIVE_REFRESH_MS);
    };

    const refreshActiveAccountInfoNow = async () => {
        const target = normalizeAccountNumber(activeAccountInfoAccount);
        if (!target) return;
        if (accountInfoLiveRefreshInFlight) return;
        if (!accountInfoModal?.classList.contains('show')) return;
        accountInfoLiveRefreshInFlight = true;
        try {
            const latest = await fetchLatestAccountRecord(target);
            if (!latest) return;
            upsertAccountRecord(latest);
            openAccountInfoModal(target, null, { skipLiveStart: true, preserveFocus: true });
        } catch (error) {
            console.warn('Account info hover refresh failed:', error?.message || error);
        } finally {
            accountInfoLiveRefreshInFlight = false;
        }
    };

    function closeAccountInfoModal(options = {}) {
        const shouldRestoreFocus = options?.restoreFocus !== false;
        if (!accountInfoModal) return;
        stopAccountInfoLiveRefresh();
        accountInfoModal.classList.remove('show');
        accountInfoModal.setAttribute('aria-hidden', 'true');
        syncModalScrollLock();
        activeAccountInfoAccount = '';
        accountInfoHistoryRowsCache = [];
        accountInfoHistorySelectedEntryIds.clear();
        updateAccountInfoHistoryBulkUi();
        accountInfoCopyValues = Object.create(null);
        accountInfoPppoeLiveSamples.clear();
        if (shouldRestoreFocus) {
            lastFocusedElement?.focus();
        }
    }

    function renderAccountInfoHistory(historyRows = []) {
        if (!accountInfoHistoryBody || !accountInfoHistoryEmpty) return;
        accountInfoHistoryRowsCache = Array.isArray(historyRows) ? historyRows : [];
        if (!accountInfoHistoryRowsCache.length) {
            accountInfoHistorySelectedEntryIds.clear();
            accountInfoHistoryBody.innerHTML = '';
            accountInfoHistoryEmpty.style.display = 'block';
            updateAccountInfoHistoryBulkUi();
            return;
        }

        const groups = accountViewShared?.groupHistoryRowsByYear
            ? accountViewShared.groupHistoryRowsByYear(accountInfoHistoryRowsCache, {
                expandedYears: accountInfoHistoryExpandedYears,
                lockCurrentYear: true
            })
            : [{
                yearKey: 'all',
                yearLabel: 'All',
                isCurrentYear: false,
                isExpanded: true,
                isLocked: false,
                entryCount: accountInfoHistoryRowsCache.length,
                rows: accountInfoHistoryRowsCache
            }];

        accountInfoHistoryEmpty.style.display = 'none';
        accountInfoHistoryBody.innerHTML = groups.map((group) => {
            const yearButton = `
                <tr class="view-history-year-row">
                    <td colspan="9">
                        <button
                            type="button"
                            class="view-history-year-toggle ${group.isLocked ? 'is-locked' : ''}"
                            data-history-year="${escapeHtml(group.yearKey)}"
                            data-history-year-locked="${group.isLocked ? 'true' : 'false'}"
                            aria-expanded="${group.isExpanded ? 'true' : 'false'}"
                            ${group.isLocked ? 'aria-disabled="true"' : ''}
                        >
                            <span class="view-history-year-label">${escapeHtml(group.yearLabel)}</span>
                            <span class="view-history-year-meta">${group.entryCount} ${group.entryCount === 1 ? 'entry' : 'entries'}</span>
                            <span class="view-history-year-icon"><i class="fa-solid fa-chevron-down"></i></span>
                        </button>
                    </td>
                </tr>
            `;
            const entryRows = group.isExpanded
                ? group.rows.map((row) => `
                    <tr>
                        <td class="view-history-select-cell">
                            ${row.entryId
                                ? `<input type="checkbox" class="view-history-select-checkbox" data-entry-id="${row.escaped.entryId}" aria-label="Select transaction"${accountInfoHistorySelectedEntryIds.has(row.entryId) ? ' checked' : ''}>`
                                : '<span class="view-history-action-empty">-</span>'}
                        </td>
                        <td>${row.escaped.recordedByLabel}</td>
                        <td>${row.escaped.dateLabel}</td>
                        <td>${row.escaped.reference}</td>
                        <td>${row.escaped.orNumber || '&mdash;'}</td>
                        <td><span class="view-type view-type--${row.typeClass}"><i class="fa-solid ${row.typeIcon}"></i>${row.escaped.typeLabel}</span></td>
                        <td class="view-amount ${row.amountClass}">${row.escaped.signedAmount}</td>
                        <td><span class="view-badge ${row.direction === 'debit' ? 'is-overdue' : 'is-credit'}">${row.direction === 'debit' ? 'DEBIT' : 'CREDIT'}</span></td>
                        <td class="view-history-actions-cell">
                            ${row.entryId
                                ? `<button type="button" class="view-history-delete-btn" data-entry-id="${row.escaped.entryId}" aria-label="Delete transaction" title="Delete transaction"><i class="fa-solid fa-trash"></i></button>`
                                : '<span class="view-history-action-empty">-</span>'}
                        </td>
                    </tr>
                `).join('')
                : '';
            return yearButton + entryRows;
        }).join('');
        updateAccountInfoHistoryBulkUi();
    }

    function openAccountInfoModal(accountNumber, triggerElement, options = {}) {
        if (!accountInfoModal) return false;
        const skipLiveStart = options?.skipLiveStart === true;
        const preserveFocus = options?.preserveFocus === true;
        const targetAccount = normalizeAccountNumber(accountNumber);
        if (!targetAccount) return false;

        const customer = findCustomerByAccount(allCustomers, targetAccount);
        if (!customer) return false;

        const mainCustomer = Array.isArray(window.allCustomers)
            ? findCustomerByAccount(window.allCustomers, targetAccount)
            : null;
        const mergedCustomer = {
            ...(mainCustomer || {}),
            ...customer,
            subscriberStatus: resolveSubscriberStatus(customer, mainCustomer),
            customerStatus: resolveSubscriberStatus(customer, mainCustomer),
            status: resolveSubscriberStatus(customer, mainCustomer)
        };
        const paymentRecord = {
            balance: Number(customer.balance) || 0,
            history: Array.isArray(customer.history) ? customer.history : []
        };
        const viewState = accountViewShared?.buildState({
            customerData: mergedCustomer,
            paymentRecord,
            planByName,
            normalizePlanName,
            resolvePlanCategory,
            routerInfo: {
                routerLabel: customer.routerLabel || customer.routerName || customer.routerId || '',
                routerId: customer.routerId || '',
                routerAddress: customer.routerAddress || ''
            },
            formatNextBillDate: (record, category) => {
                if (category === 'prepaid') return accountViewShared.formatDate(record?.dueDate);
                const parsedBill = parseSafeDate(record?.billDate);
                if (!parsedBill) return accountViewShared.formatDate(record?.billDate);
                const today = new Date();
                const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                let candidate = new Date(start.getFullYear(), start.getMonth(), parsedBill.getDate());
                if (candidate < start) {
                    candidate = addMonthClamp(candidate);
                }
                return accountViewShared.formatDate(candidate);
            },
            defaultRouterLabel: 'Default router'
        });
        if (!viewState) return false;

        if (accountInfoMikrotikPanel) {
            accountInfoMikrotikPanel.style.display = mikrotikEnabled && viewState.hasPppoeAssignment ? '' : 'none';
        }
        if (accountInfoNapPanel) {
            accountInfoNapPanel.style.display = viewState.hasNapManagementInfo ? '' : 'none';
        }
        if (accountInfoMikrotikStatusRow) {
            accountInfoMikrotikStatusRow.style.display = mikrotikEnabled ? '' : 'none';
        }

        activeAccountInfoAccount = targetAccount;
        if (accountInfoHistoryExpandedAccount !== targetAccount) {
            accountInfoHistoryExpandedAccount = targetAccount;
            accountInfoHistoryExpandedYears.clear();
            accountInfoHistorySelectedEntryIds.clear();
        }
        accountInfoCopyValues = {
            accountNumber: viewState.accountNumber,
            loginUsername: viewState.loginUsername,
            loginPassword: viewState.loginPassword,
            pppoeUsername: viewState.pppoeUsername,
            pppoePassword: viewState.pppoePassword
        };

        if (accountInfoInitials) accountInfoInitials.textContent = viewState.initials || '--';
        if (accountInfoFullName) accountInfoFullName.textContent = viewState.displayName;
        if (accountInfoAccountLabel) accountInfoAccountLabel.textContent = viewState.accountNumber || 'Not set';
        if (accountInfoEmail) accountInfoEmail.textContent = viewState.email;
        if (accountInfoMobile) accountInfoMobile.textContent = viewState.mobile;
        if (accountInfoAddress) accountInfoAddress.textContent = viewState.fullAddress;
        if (accountInfoSidebarPlan) accountInfoSidebarPlan.textContent = viewState.planName;
        if (accountInfoPlanType) accountInfoPlanType.textContent = viewState.planCategoryLabel;
        if (accountInfoPlanName) accountInfoPlanName.textContent = viewState.planName;
        if (accountInfoBillingCycle) accountInfoBillingCycle.textContent = viewState.billingCycle;
        if (accountInfoArea) accountInfoArea.textContent = viewState.area;
        if (accountInfoRemarks) accountInfoRemarks.textContent = viewState.remarks === 'Not set' ? 'None' : viewState.remarks;
        if (accountInfoPortalUsername) accountInfoPortalUsername.textContent = viewState.loginUsername;
        if (accountInfoPortalPassword) accountInfoPortalPassword.textContent = viewState.loginPassword;
        if (accountInfoPlanPrice) accountInfoPlanPrice.textContent = viewState.planPriceDisplay;
        if (accountInfoPlanBilling) accountInfoPlanBilling.textContent = viewState.planBilling;
        if (accountInfoActivationDate) accountInfoActivationDate.textContent = viewState.activationDate;
        if (accountInfoBillDate) accountInfoBillDate.textContent = viewState.billDateDisplay;
        if (accountInfoDueDate) accountInfoDueDate.textContent = viewState.dueDateDisplay;
        if (accountInfoDueAfter) accountInfoDueAfter.textContent = viewState.dueOffsetDisplay;
        if (accountInfoCreditLimit) accountInfoCreditLimit.textContent = viewState.creditLimitDisplay;
        if (accountInfoRouter) accountInfoRouter.textContent = viewState.routerLabel;
        if (accountInfoPppoeUsername) accountInfoPppoeUsername.textContent = viewState.pppoeUsername;
        if (accountInfoPppoePassword) accountInfoPppoePassword.textContent = viewState.pppoePassword;
        if (accountInfoPppoeProfile) accountInfoPppoeProfile.textContent = viewState.pppoeProfile;
        if (accountInfoNapInfo) accountInfoNapInfo.textContent = viewState.napInfo;
        if (accountInfoNapPort) accountInfoNapPort.textContent = viewState.napPort;
        if (accountInfoOpticalInfo) accountInfoOpticalInfo.textContent = viewState.opticalInfo;
        if (accountInfoMikrotikStatus) accountInfoMikrotikStatus.textContent = viewState.mikrotikStatus;
        if (skipLiveStart) {
            updateAccountInfoPppoeLive(mergedCustomer, viewState);
        }

        if (accountInfoMapPinLink) {
            const rawPin = String(viewState.mapPin || '').trim();
            if (rawPin && rawPin !== 'Not set') {
                accountInfoMapPinLink.textContent = rawPin;
                accountInfoMapPinLink.href = viewState.mapPinUrl;
                accountInfoMapPinLink.classList.remove('is-disabled');
            } else {
                accountInfoMapPinLink.textContent = 'Not set';
                accountInfoMapPinLink.href = '#';
                accountInfoMapPinLink.classList.add('is-disabled');
            }
        }

        if (accountInfoStatusPill) {
            accountInfoStatusPill.className = `status-pill ${viewState.accountStatusClass}`;
            accountInfoStatusPill.textContent = viewState.accountStatusLabel;
            accountInfoStatusPill.title = viewState.accountStatusLabel;
            accountInfoStatusPill.setAttribute('aria-label', viewState.accountStatusLabel);
        }
        const accountInfoStatusIcon = accountInfoStatusCard?.querySelector('.view-key-icon i');
        if (accountInfoStatusIcon) {
            accountInfoStatusIcon.className = 'fa-solid fa-circle-check';
            if (viewState.accountStatusClass === 'warning') {
                accountInfoStatusIcon.className = 'fa-solid fa-triangle-exclamation';
            } else if (viewState.accountStatusClass === 'inactive') {
                accountInfoStatusIcon.className = 'fa-solid fa-circle-xmark';
            }
        }
        if (accountInfoStatusCard) {
            accountInfoStatusCard.classList.remove('is-success', 'is-warning', 'is-inactive');
            if (viewState.accountStatusClass === 'success') accountInfoStatusCard.classList.add('is-success');
            if (viewState.accountStatusClass === 'warning') accountInfoStatusCard.classList.add('is-warning');
            if (viewState.accountStatusClass === 'inactive') accountInfoStatusCard.classList.add('is-inactive');
        }

        if (accountInfoCurrentBalance) accountInfoCurrentBalance.textContent = viewState.balanceDisplay;
        if (accountInfoBalanceCard) accountInfoBalanceCard.classList.remove('is-overdue', 'is-advance');
        if (accountInfoCurrentBalance) accountInfoCurrentBalance.classList.remove('is-negative', 'is-advance');
        if (accountInfoBalanceTag) accountInfoBalanceTag.classList.remove('is-advance');
        if (accountInfoBalanceHelper) accountInfoBalanceHelper.classList.remove('is-advance');

        let balanceTagText = viewState.balanceTag ? String(viewState.balanceTag).toUpperCase() : '';
        let balanceHelperText = viewState.balanceHelper;
        if (!viewState.hasAdvance && !viewState.showOverdue && Number(viewState.balanceNumber) > 0) {
            balanceTagText = 'DUE';
            balanceHelperText = viewState.dueDateDisplay && viewState.dueDateDisplay !== 'Not set'
                ? `Due ${viewState.dueDateDisplay}`
                : 'Payment due';
        } else if (!viewState.hasAdvance && Number(viewState.balanceNumber) === 0) {
            balanceHelperText = 'Fully paid';
        }

        if (viewState.hasAdvance) {
            accountInfoBalanceCard?.classList.add('is-advance');
            accountInfoCurrentBalance?.classList.add('is-advance');
            accountInfoBalanceTag?.classList.add('is-advance');
            accountInfoBalanceHelper?.classList.add('is-advance');
        } else if (viewState.showOverdue) {
            accountInfoBalanceCard?.classList.add('is-overdue');
            accountInfoCurrentBalance?.classList.add('is-negative');
        }

        if (accountInfoBalanceTag) accountInfoBalanceTag.textContent = balanceTagText;
        if (accountInfoBalanceHelper) accountInfoBalanceHelper.textContent = balanceHelperText;

        if (accountInfoDueRow) accountInfoDueRow.classList.remove('is-overdue');
        if (accountInfoDueBadge) {
            accountInfoDueBadge.textContent = '';
            accountInfoDueBadge.classList.remove('is-overdue', 'is-warning', 'is-credit');
        }
        if (viewState.showOverdue) {
            accountInfoDueRow?.classList.add('is-overdue');
            if (accountInfoDueBadge) {
                const overdueDays = viewState.dueStatus?.days || 1;
                accountInfoDueBadge.textContent = `OVERDUE \u00B7 ${overdueDays} DAYS`;
                accountInfoDueBadge.classList.add('is-overdue');
            }
        } else if (!viewState.hasAdvance && viewState.dueStatus?.state === 'upcoming' && (viewState.dueStatus?.days || 0) <= 3) {
            if (accountInfoDueBadge) {
                accountInfoDueBadge.textContent = 'DUE SOON';
                accountInfoDueBadge.classList.add('is-warning');
            }
        } else if (viewState.hasAdvance) {
            if (accountInfoDueBadge) {
                accountInfoDueBadge.textContent = 'ADVANCE';
                accountInfoDueBadge.classList.add('is-credit');
            }
        }

        accountInfoHistoryRowsCache = Array.isArray(viewState.historyRows) ? viewState.historyRows : [];
        renderAccountInfoHistory(accountInfoHistoryRowsCache);

        if (!preserveFocus) {
            lastFocusedElement = triggerElement || document.activeElement;
        }
        accountInfoModal.classList.add('show');
        accountInfoModal.setAttribute('aria-hidden', 'false');
        syncModalScrollLock();
        if (!preserveFocus) {
            const closeBtn = accountInfoModal.querySelector('.close-modal');
            closeBtn?.focus();
        }
        if (!skipLiveStart) {
            startAccountInfoLiveRefresh(targetAccount);
            startAccountInfoPppoeLiveRefresh(mergedCustomer, viewState);
        }
        return true;
    }

    function closeFilterModal() {
        if (!filterModal) return;
        filterModal.classList.remove('show');
        filterModal.setAttribute('aria-hidden', 'true');
        areaFilterPicker.close();
        syncModalScrollLock();
    }

    openPaymentModalBtn.addEventListener('click', openModal);
    paymentKindSelect?.addEventListener('change', () => {
        syncPaymentMethodVisibility();
        syncPrepaidFieldsForSelectedCustomer();
    });
    openCustomerAddBtn?.addEventListener('click', () => {
        openCustomerAddModal();
    });
    customerAddFrame?.addEventListener('load', () => {
        const frameSrc = String(customerAddFrame.getAttribute('src') || '').trim();
        if (!frameSrc || frameSrc === 'about:blank') {
            customerFormBridgeReady = false;
        }
    });

    window.addEventListener('message', async (event) => {
        if (event.origin !== window.location.origin) return;
        const payload = event.data;
        if (!payload || payload.source !== 'customers-add-flow' || payload.context !== 'payments') return;

        if (payload.type === 'ready') {
            customerFormBridgeReady = true;
            flushPendingCustomerFormRequest();
            return;
        }

        if (payload.type === 'cancel') {
            closeCustomerAddModal({ syncChildForm: false });
            return;
        }

        if (!['created', 'updated'].includes(String(payload.type || ''))) return;

        const affectedAccountNumber = normalizeAccountNumber(
            payload.accountNumber || payload.customer?.accountNumber || ''
        );
        const wasViewingAccountInfo = Boolean(accountInfoModal?.classList.contains('show'));

        closeCustomerAddModal({ restoreFocus: false, syncChildForm: false });

        try {
            await loadPaymentRecords();
        } catch (error) {
            console.warn('Unable to refresh payments after customer creation:', error?.message || error);
        }

        if (payload.type === 'updated' && wasViewingAccountInfo && affectedAccountNumber) {
            try {
                await refreshActiveAccountInfoNow();
            } catch (error) {
                console.warn('Unable to refresh account info after customer update:', error?.message || error);
            }
        }

        if (affectedAccountNumber) {
            showToast(`Customer ${affectedAccountNumber} ${payload.type === 'updated' ? 'updated' : 'added'} successfully.`);
            return;
        }

        showToast(`Customer ${payload.type === 'updated' ? 'updated' : 'added'} successfully.`);
    });

    if (accountInfoPayNowBtn) {
        accountInfoPayNowBtn.addEventListener('mouseenter', refreshActiveAccountInfoNow);
        accountInfoPayNowBtn.addEventListener('focus', refreshActiveAccountInfoNow);
        accountInfoPayNowBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            const accountNumber = normalizeAccountNumber(activeAccountInfoAccount);
            if (!accountNumber) {
                showToast('No account selected.');
                return;
            }
            closeAccountInfoModal({ restoreFocus: false });
            if (!openPaymentModalForAccount(accountNumber)) {
                showToast('Unable to open payment form for this customer.');
            }
        });
    }

    if (accountInfoEditBtn) {
        accountInfoEditBtn.addEventListener('click', () => {
            const accountNumber = normalizeAccountNumber(activeAccountInfoAccount);
            if (!accountNumber) {
                showToast('No account selected.');
                return;
            }
            if (!openCustomerEditModal(accountNumber)) {
                showToast('Unable to open edit customer form.');
            }
        });
    }

    if (accountInfoSendReminderBtn) {
        accountInfoSendReminderBtn.addEventListener('mouseenter', refreshActiveAccountInfoNow);
        accountInfoSendReminderBtn.addEventListener('focus', refreshActiveAccountInfoNow);
        accountInfoSendReminderBtn.addEventListener('click', () => {
            const accountNumber = normalizeAccountNumber(activeAccountInfoAccount);
            if (!accountNumber) {
                showToast('No account selected.');
                return;
            }
            showToast(`Reminder queued for Account #${accountNumber}.`);
        });
    }

    if (accountInfoWifiBtn) {
        accountInfoWifiBtn.addEventListener('mouseenter', refreshActiveAccountInfoNow);
        accountInfoWifiBtn.addEventListener('focus', refreshActiveAccountInfoNow);
        accountInfoWifiBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!canUseDirectWifi()) {
                showToast('WiFi editor is only available for Dante Fiber.');
                return;
            }
            const accountNumber = normalizeAccountNumber(activeAccountInfoAccount);
            if (!accountNumber) {
                showToast('No account selected.');
                return;
            }
            accountInfoWifiBtn.disabled = true;
            accountInfoWifiBtn.setAttribute('aria-busy', 'true');
            try {
                if (typeof accountViewShared?.openWifiChangeForAccount === 'function') {
                    await accountViewShared.openWifiChangeForAccount(accountNumber, {
                        mode: 'direct',
                        url: getAccountInfoCopyValue('pppoeAssignedIp')
                    });
                } else {
                    showToast('WiFi editor is not available.');
                }
            } finally {
                accountInfoWifiBtn.disabled = false;
                accountInfoWifiBtn.removeAttribute('aria-busy');
            }
        });
    }

    if (accountInfoStmtAccount) {
        accountInfoStmtAccount.addEventListener('click', () => {
            const accountNumber = normalizeAccountNumber(activeAccountInfoAccount);
            if (!accountNumber) return;
            window.open(`account-statement.html?account=${accountNumber}`, '_blank');
        });
    }
    if (accountInfoStmtBilling) {
        accountInfoStmtBilling.addEventListener('click', () => {
            const accountNumber = normalizeAccountNumber(activeAccountInfoAccount);
            if (!accountNumber) return;
            window.open(`billing-statement.html?account=${accountNumber}`, '_blank');
        });
    }
    if (accountInfoStmtThermal) {
        accountInfoStmtThermal.addEventListener('click', () => {
            const accountNumber = normalizeAccountNumber(activeAccountInfoAccount);
            if (!accountNumber) return;
            window.open(`thermal-print.html?account=${accountNumber}`, '_blank');
        });
    }

    if (accountInfoModal) {
        accountInfoModal.addEventListener('change', (event) => {
            const historySelectAll = event.target.closest('#accountInfoHistorySelectAll, #accountInfoHistoryTableSelectAll');
            if (historySelectAll && accountInfoModal.contains(historySelectAll)) {
                applySelectionToAll(accountInfoHistorySelectedEntryIds, getAccountInfoHistorySelectableIds(), historySelectAll.checked);
                renderAccountInfoHistory(accountInfoHistoryRowsCache);
                return;
            }

            const historyCheckbox = event.target.closest('.view-history-select-checkbox');
            if (historyCheckbox && accountInfoModal.contains(historyCheckbox)) {
                const entryId = normalizeEntryId(historyCheckbox.dataset.entryId);
                if (!entryId) return;
                if (historyCheckbox.checked) {
                    accountInfoHistorySelectedEntryIds.add(entryId);
                } else {
                    accountInfoHistorySelectedEntryIds.delete(entryId);
                }
                updateAccountInfoHistoryBulkUi();
            }
        });
        accountInfoModal.addEventListener('click', async (event) => {
            const historyYearToggleBtn = event.target.closest('.view-history-year-toggle');
            if (historyYearToggleBtn && accountInfoModal.contains(historyYearToggleBtn)) {
                event.preventDefault();
                const yearKey = String(historyYearToggleBtn.dataset.historyYear || '').trim();
                if (!yearKey) return;
                const isLocked = String(historyYearToggleBtn.dataset.historyYearLocked || '').trim().toLowerCase() === 'true';
                if (isLocked) return;
                if (accountInfoHistoryExpandedYears.has(yearKey)) {
                    accountInfoHistoryExpandedYears.delete(yearKey);
                } else {
                    accountInfoHistoryExpandedYears.add(yearKey);
                }
                renderAccountInfoHistory(accountInfoHistoryRowsCache);
                return;
            }

            const historyDeleteBtn = event.target.closest('.view-history-delete-btn');
            if (historyDeleteBtn && accountInfoModal.contains(historyDeleteBtn)) {
                event.preventDefault();
                const entryId = String(historyDeleteBtn.dataset.entryId || '').trim();
                const accountNumber = normalizeAccountNumber(activeAccountInfoAccount);
                if (!accountNumber || !entryId) {
                    showToast('Unable to delete transaction: missing account or entry.');
                    return;
                }
                const confirmed = window.appConfirm
                    ? await window.appConfirm('Delete this transaction? This action cannot be undone.', { title: 'Delete Transaction' })
                    : window.confirm('Delete this transaction? This action cannot be undone.');
                if (!confirmed) return;

                historyDeleteBtn.disabled = true;
                try {
                    const response = await fetch(`/api/payments/${encodeURIComponent(accountNumber)}/${encodeURIComponent(entryId)}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    if (!response.ok) {
                        throw new Error(await parseDeleteError(response, 'Failed to delete transaction'));
                    }
                    accountInfoHistorySelectedEntryIds.delete(normalizeEntryId(entryId));
                    await loadPaymentRecords();
                    const latest = await fetchLatestAccountRecord(accountNumber);
                    if (latest) {
                        upsertAccountRecord(latest);
                    }
                    openAccountInfoModal(accountNumber, null, { skipLiveStart: true, preserveFocus: true });
                    showToast('Transaction deleted.');
                } catch (error) {
                    historyDeleteBtn.disabled = false;
                    showToast(`Error: ${error.message}`);
                }
                return;
            }

            const copyBtn = event.target.closest('[data-copy-field]');
            if (!copyBtn || !accountInfoModal.contains(copyBtn)) return;
            event.preventDefault();
            const copyField = String(copyBtn.dataset.copyField || '').trim();
            const label = getCopyFieldLabel(copyField);
            const textToCopy = getAccountInfoCopyValue(copyField);
            if (!textToCopy) {
                showToast(`${label} is not available to copy.`);
                return;
            }
            const copied = await copyTextToClipboard(textToCopy);
            showToast(copied ? `${label} copied.` : `Unable to copy ${label.toLowerCase()}.`);
        });
    }
    if (accountInfoHistoryDeleteSelectedBtn) {
        accountInfoHistoryDeleteSelectedBtn.addEventListener('click', async () => {
            const accountNumber = normalizeAccountNumber(activeAccountInfoAccount);
            const entryIds = Array.from(accountInfoHistorySelectedEntryIds);
            if (!accountNumber || !entryIds.length) {
                showToast('Select at least one transaction to delete.');
                return;
            }
            const confirmed = window.appConfirm
                ? await window.appConfirm(`Delete ${entryIds.length} selected transaction${entryIds.length === 1 ? '' : 's'}? This action cannot be undone.`, { title: 'Delete Selected Transactions' })
                : window.confirm(`Delete ${entryIds.length} selected transaction${entryIds.length === 1 ? '' : 's'}? This action cannot be undone.`);
            if (!confirmed) return;

            accountInfoHistoryDeleteSelectedBtn.disabled = true;
            try {
                const result = await deleteEntriesForAccount(accountNumber, entryIds);
                accountInfoHistorySelectedEntryIds.clear();
                await loadPaymentRecords();
                const latest = await fetchLatestAccountRecord(accountNumber);
                if (latest) {
                    upsertAccountRecord(latest);
                }
                openAccountInfoModal(accountNumber, null, { skipLiveStart: true, preserveFocus: true });
                const deletedCount = Number(result?.deletedCount) || entryIds.length;
                showToast(`${deletedCount} transaction${deletedCount === 1 ? '' : 's'} deleted.`);
            } catch (error) {
                showToast(`Error: ${error.message}`);
                updateAccountInfoHistoryBulkUi();
            }
        });
    }
    
    // Generic modal close logic
    document.querySelectorAll('[data-dismiss="modal"], .close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalToClose = btn.closest('.modal');
            if (!modalToClose) return;
            if (modalToClose === accountInfoModal) {
                closeAccountInfoModal();
                return;
            }
            if (modalToClose === historyModal) {
                closeHistoryModal();
                return;
            }
            if (modalToClose === paymentModal) {
                closeModal();
                return;
            }
            if (modalToClose === customerAddModal) {
                closeCustomerAddModal();
                return;
            }
            if (modalToClose === filterModal) {
                closeFilterModal();
                return;
            }
            modalToClose.classList.remove('show');
            modalToClose.setAttribute('aria-hidden', 'true');
            syncModalScrollLock();
            lastFocusedElement?.focus();
        });
    });

    window.addEventListener('click', function (event) {
        if (event.target === historyModal) {
            closeHistoryModal();
        }
        if (event.target === accountInfoModal) {
            closeAccountInfoModal();
        }
        if (event.target === customerAddModal) {
            closeCustomerAddModal();
        }
    });

    window.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && paymentModal.classList.contains('show')) {
            closeModal();
        }
        if (event.key === 'Escape' && customerAddModal?.classList.contains('show')) {
            closeCustomerAddModal();
        }
        if (event.key === 'Escape' && historyModal.classList.contains('show')) {
            closeHistoryModal();
        }
        if (event.key === 'Escape' && filterModal?.classList.contains('show')) {
            closeFilterModal();
        }
        if (event.key === 'Escape' && accountInfoModal?.classList.contains('show')) {
            closeAccountInfoModal();
        }
    });

    // Auto-fill amount based on selected customer's balance
    customerSelect.addEventListener('change', () => {
        const accountNumber = normalizeAccountNumber(customerSelect.value);

        if (!accountNumber) {
            if (paymentAmountInput) paymentAmountInput.value = '';
            selectedCustomer = null;
            setPrepaidFieldsVisible(false);
            return;
        }

        const customer = findCustomerByAccount(allCustomers, accountNumber);
        selectedCustomer = customer || null;
        const planCategory = resolvePlanCategory(customer);
        if (planCategory === 'prepaid') {
            syncPrepaidFieldsForSelectedCustomer();
        } else {
            setPrepaidFieldsVisible(false);
            if (customer && customer.balance > 0) {
                if (paymentAmountInput) paymentAmountInput.value = customer.balance.toFixed(2);
            } else if (paymentAmountInput) {
                paymentAmountInput.value = '';
            }
        }

    });

    if (prepaidPlanSelect) {
        prepaidPlanSelect.addEventListener('change', () => {
            if (selectedCustomer) updatePrepaidPreview(selectedCustomer);
        });
    }

    if (paymentDateInput) {
        paymentDateInput.addEventListener('change', () => {
            if (selectedCustomer && resolvePlanCategory(selectedCustomer) === 'prepaid') {
                updatePrepaidPreview(selectedCustomer);
            }
        });
    }

    async function loadPaymentRecords() {
        try {
            const [recordsResponse, customersResponse] = await Promise.all([
                fetch('/api/payment-records'),
                fetch('/api/customers')
            ]);
            const data = await recordsResponse.json();
            const customersData = customersResponse.ok
                ? await customersResponse.json().catch(() => ({}))
                : {};
            const paymentRecords = Array.isArray(data.records)
                ? data.records
                : (Array.isArray(data) ? data : []);
            const mainCustomers = Array.isArray(customersData.customers)
                ? customersData.customers
                : (Array.isArray(customersData) ? customersData : []);
            const mainCustomerByAccount = new Map(mainCustomers
                .map((customer) => [normalizeAccountNumber(customer?.accountNumber), customer])
                .filter(([account]) => account));
            const recordsSource = paymentRecords.length ? paymentRecords : mainCustomers;
            allCustomers = recordsSource.map((record) => {
                const mainCustomer = mainCustomerByAccount.get(normalizeAccountNumber(record?.accountNumber)) || {};
                return {
                    ...mainCustomer,
                    ...record,
                    loginPassword: mainCustomer.loginPassword ?? record.loginPassword,
                    loginPasswordSet: mainCustomer.loginPasswordSet ?? record.loginPasswordSet,
                    subscriberStatus: resolveSubscriberStatus(record, mainCustomer),
                    customerStatus: resolveSubscriberStatus(record, mainCustomer)
                };
            });
            window.allCustomers = mainCustomers.map((customer) => ({
                ...customer,
                status: resolveSubscriberStatus(customer)
            }));
            // Update UI metrics and dropdown
            updateMetrics(allCustomers);
            populateCustomerDropdown();
            populateAreaFilterOptions([...allCustomers, ...mainCustomers]);
            // Re-apply current filters/sort so state persists after refresh/reload.
            applyFilters();
        } catch (error) {
            console.error('Failed to load payment records:', error);
        }
    }

    function updateMetrics(customers) {
        const outstandingReceivablesEl = document.getElementById('outstandingReceivables');
        const paymentsCollectedEl = document.getElementById('paymentsCollected');
        const accountsPastDueEl = document.getElementById('accountsPastDue');

        if (!outstandingReceivablesEl || !paymentsCollectedEl || !accountsPastDueEl) return;

        const totalReceivables = customers
            .filter(c => c.balance > 0)
            .reduce((sum, c) => sum + c.balance, 0);

        const totalCollected = customers.reduce((sum, c) => sum + (c.totalCredits || 0), 0);

        const pastDueCount = customers.filter(c => c.status === 'Overdue').length;

        outstandingReceivablesEl.textContent = formatCurrency(totalReceivables);
        paymentsCollectedEl.textContent = formatCurrency(totalCollected);
        accountsPastDueEl.textContent = `${pastDueCount} account${pastDueCount !== 1 ? 's' : ''}`;
    }

    function populateCustomerDropdown() {
        if (!customerSelect) return;
        const currentVal = customerSelect.value;
        customerSelect.innerHTML = '<option value="">Select a customer</option>';
        allCustomers.forEach(customer => {
            const displayName = formatCustomerName(customer);
            const accountNumber = normalizeAccountNumber(customer.accountNumber);
            const optionLabel = accountNumber ? `${displayName} (${accountNumber})` : displayName;
            const option = new Option(optionLabel, accountNumber);
            customerSelect.add(option);
        });
        if (currentVal) {
            customerSelect.value = currentVal;
        }
    }

    function populateAreaFilterOptions(customers) {
        if (!filterAreaSelect) return;
        const previousValues = getMultiSelectValues(filterAreaSelect);
        const uniqueAreas = new Map();

        (Array.isArray(customers) ? customers : []).forEach((customer) => {
            const area = getCustomerArea(customer);
            if (!area) return;
            const key = area.toLowerCase();
            if (!uniqueAreas.has(key)) uniqueAreas.set(key, area);
        });

        const sortedAreas = Array.from(uniqueAreas.values()).sort((left, right) => String(left).localeCompare(String(right), undefined, {
            sensitivity: 'base',
            numeric: true
        }));

        filterAreaSelect.innerHTML = '';
        sortedAreas.forEach((area) => {
            filterAreaSelect.add(new Option(area, area));
        });
        const availableAreaKeys = new Set(sortedAreas.map((area) => area.toLowerCase()));
        const nextValues = areaFilterInitialized
            ? previousValues.filter((area) => availableAreaKeys.has(area.toLowerCase()))
            : sortedAreas.slice();
        setMultiSelectValues(filterAreaSelect, nextValues);
        areaFilterInitialized = true;
        areaFilterPicker.rebuildOptions();
    }

    paymentForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        if (paymentFormSubmitBtn?.disabled) return;
        const formData = new FormData(paymentForm);
        const accountNumber = normalizeAccountNumber(formData.get('accountNumber'));
        if (!accountNumber) {
            showToast('Select a customer to continue.');
            return;
        }
        if (pendingPaymentAccounts.has(accountNumber)) {
            showToast('Payment already processing for this account.');
            return;
        }
        pendingPaymentAccounts.add(accountNumber);
        setPaymentSubmitEnabled(false);
        const finishSubmit = () => {
            pendingPaymentAccounts.delete(accountNumber);
            setPaymentSubmitEnabled(true);
        };
        const customer = findCustomerByAccount(allCustomers, accountNumber);
        if (!customer) {
            showToast('Select a customer to continue.');
            finishSubmit();
            return;
        }

        const planCategory = resolvePlanCategory(customer);
        const selectedKind = String(formData.get('kind') || '').trim().toLowerCase();
        const isPaymentKind = selectedKind === 'payment';
        let prepaidUpdate = null;
        let prepaidAmount = null;
        if (planCategory === 'prepaid' && isPaymentKind) {
            const plan = getSelectedPrepaidPlan();
            if (!plan) {
                showToast('Select a prepaid plan for this renewal.');
                finishSubmit();
                return;
            }
            const paymentDate = parseDateOnly(formData.get('date')) || new Date();
            const baseDate = derivePrepaidBaseDate(customer, formData.get('date'));
            const expiryDate = computeExpiryDate(baseDate, plan.validity);
            if (!expiryDate) {
                showToast('Selected plan has no validity days.');
                finishSubmit();
                return;
            }
            prepaidAmount = Number(plan.price || 0);
            prepaidUpdate = {
                planId: plan.id || '',
                planName: plan.name,
                planCategory: 'prepaid',
                planAmount: plan.price,
                prepaidRenewalDate: formatDateISO(paymentDate),
                billDate: formatDateISO(baseDate),
                dueDate: expiryDate,
                prepaidExpirationAt: `${expiryDate} 23:59:59`
            };
        }

        const payload = {
            amount: planCategory === 'prepaid' && isPaymentKind ? prepaidAmount : parseFloat(formData.get('amount')),
            date: formData.get('date'),
            kind: selectedKind,
            paymentMethod: isPaymentKind ? (String(formData.get('paymentMethod') || 'Cash').trim() || 'Cash') : '',
            reference: isPaymentKind ? String(formData.get('reference') || '').trim() : '',
            description: formData.get('description'),
            type: selectedKind === 'charge' ? 'charge' : 'payment'
        };
        if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
            showToast('Amount must be greater than 0.');
            finishSubmit();
            return;
        }
        const currentUserRoles = Array.isArray(currentUser?.roles)
            ? currentUser.roles
            : String(currentUser?.role || '').split(/[,/|;]+|\s+\+\s+|\s+and\s+/i);
        const isCollector = currentUserRoles.some((role) => String(role || '').trim().toLowerCase() === 'collector');
        if (isCollector && String(payload.kind || '').trim().toLowerCase() === 'payment' && !payload.reference) {
            showToast('Reference is required for collector submissions.');
            finishSubmit();
            return;
        }
        try {
            const response = await fetch(`/api/payments/${accountNumber}`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const responseData = await response.json();
                if (!response.ok) throw new Error(responseData.message || `Failed to add transaction`);
                if (prepaidUpdate) {
                    try {
                        const updateRes = await fetch(`/api/customers/${accountNumber}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(prepaidUpdate)
                        });
                        if (!updateRes.ok) {
                            showToast('Payment recorded, but prepaid renewal update failed.');
                        }
                    } catch (err) {
                        showToast('Payment recorded, but prepaid renewal update failed.');
                    }
                }
                showToast(`Transaction added successfully!`);
                closeModal({ force: true });
                // Reload all data to reflect changes
                init();
        } catch (error) {
                showToast(`Error: ${error.message}`);
        } finally {
            finishSubmit();
        }
    });

    // Billing status (financial)
    const statusMap = {
        paid: { class: 'success', text: 'Paid' },
        due: { class: 'warning', text: 'Due' },
        overdue: { class: 'inactive', text: 'Overdue' },
        advance: { class: 'advance', text: 'Advance' }
    };

    const deriveStatus = (customer) => {
        const balance = Number(customer.balance) || 0;
        const limitRaw = Number(customer.creditLimit);
        const planAmt = Number(customer.planAmount) || 0;
        const creditLimit = Number.isFinite(limitRaw) && limitRaw >= 0 ? limitRaw : planAmt;
        if (balance < 0) return 'advance';
        if (balance <= 0) return 'paid';
        if (creditLimit > 0 && balance > creditLimit) return 'overdue';
        return 'due';
    };

    function resolvePlanCategory(customer) {
        const explicit = String(customer?.planCategory || customer?.planType || '').trim().toLowerCase();
        if (explicit === 'prepaid' || explicit === 'postpaid') return explicit;
        const billing = String(customer?.planBilling || '').trim().toLowerCase();
        if (billing.includes('prepaid')) return 'prepaid';
        if (billing.includes('postpaid')) return 'postpaid';
        const nameHint = String(customer?.planName || '').trim().toLowerCase();
        if (nameHint.startsWith('prepaid') || nameHint.includes('prepaid')) return 'prepaid';
        const match = customer?.planName ? planByName.get(normalizePlanName(customer.planName)) : null;
        if (match?.category) return String(match.category).toLowerCase();
        return 'postpaid';
    }

    function renderPayments(customers) {
        if (!paymentsTableBody) return;
        if (customers.length === 0) {
            paymentsTableBody.innerHTML = '<tr class="payments-empty-row"><td colspan="10" class="payments-empty-cell">No payments to display.</td></tr>';
            return;
        }
        const activeSortFilter = paymentsSortSelect?.value || DEFAULT_SORT_FILTER;

        const rowsHtml = customers.map(customer => {
            const nameParts = getCustomerNameParts(customer);
            const firstName = nameParts.firstName;
            const lastName = nameParts.lastName;
            const firstInitial = firstName.length > 0 ? firstName[0] : '';
            const lastInitial = lastName.length > 0 ? lastName[0] : '';
            const initials = `${firstInitial}${lastInitial}`.toUpperCase();
            const displayName = formatSubscriberDisplayName(nameParts, activeSortFilter);
            const displayInitials = initials || '??';

            const derivedStatusKey = deriveStatus(customer);
            const statusInfo = statusMap[derivedStatusKey] || { class: 'neutral', text: 'Unknown' };

            // Subscriber status (active/inactive) separate from billing status
            let subscriberStatusClass = 'success';
            let subscriberStatusLabel = 'Active';
            let mainCustomer = null;
            if (window.allCustomers && Array.isArray(window.allCustomers)) {
                mainCustomer = findCustomerByAccount(window.allCustomers, customer.accountNumber);
            }
            const rawStatus = resolveSubscriberStatus(customer, mainCustomer);
            if (rawStatus === 'disabled') {
                subscriberStatusClass = 'warning';
                subscriberStatusLabel = 'Disabled';
            } else if (rawStatus === 'inactive') {
                subscriberStatusClass = 'inactive';
                subscriberStatusLabel = 'Inactive';
            }

            const billDate = parseDateOnly(customer.billDate);
            let billingCycleDisplay = 'Not set';
            let billingCycleMeta = 'No cycle recorded';
            const planCategory = resolvePlanCategory(customer);
            const dueStatus = getDueStatus(customer?.dueDate);
            const balanceNumber = Number(customer?.balance);
            const hasAdvance = Number.isFinite(balanceNumber) && balanceNumber < 0;
            const isOverdue = dueStatus.state === 'overdue' && !hasAdvance && Number.isFinite(balanceNumber) && balanceNumber > 0;

            if (planCategory === 'prepaid') {
                billingCycleDisplay = 'Prepaid';
                const prepaidExpiry = customer.prepaidExpirationAt || customer.dueDate;
                if (prepaidExpiry) {
                    billingCycleMeta = `Expires: ${formatDateTime(prepaidExpiry, 'Not set')}`;
                } else {
                    billingCycleMeta = 'No expiry set';
                }
            } else if (billDate && !isNaN(billDate)) {
                const day = billDate.getDate();
                const getOrdinalSuffix = (d) => {
                    if (d > 3 && d < 21) return 'th';
                    switch (d % 10) { case 1: return "st"; case 2: return "nd"; case 3: return "rd"; default: return "th"; }
                };
                billingCycleDisplay = `Every ${day}${getOrdinalSuffix(day)} of the month`;
                billingCycleMeta = `Next due: ${getDisplayDueDateForPostpaid(customer, { treatAsOverdue: isOverdue })}`;
            }

            // Use Math.abs for last payment amount and add class for color coding
            const lastPaymentAmount = formatCurrency(Math.abs(customer.lastPaymentAmount));
            const lastPayment = `${lastPaymentAmount}<br>on ${formatDate(customer.lastPaymentDate)}`;
            let lastPaymentClass = '';
            // lastPaymentDirection is sent from the server
            if (customer.lastPaymentDirection === 'debit') {
                lastPaymentClass = 'has-balance'; // Re-use the same class as 'Current Bill' for red color
            } else if (customer.lastPaymentDirection === 'credit' && customer.lastPaymentAmount === 0) {
                lastPaymentClass = 'zero-balance';
            }
            let balanceClass = '';
            if (customer.balance > 0) {
                balanceClass = 'has-balance';
            } else if (customer.balance < 0) {
                balanceClass = 'advance-balance';
            } else {
                balanceClass = 'zero-balance';
            }

            // Use Math.abs to prevent negative sign, color coding will indicate the status
            const balanceAmount = formatCurrency(Math.abs(customer.balance));
            const dueForDisplay = planCategory === 'postpaid'
                ? getDisplayDueDateForPostpaid(customer, { treatAsOverdue: isOverdue })
                : formatDate(customer.dueDate);
            const currentBill = planCategory === 'prepaid'
                ? `${balanceAmount}<br>Expires ${formatDate(customer.dueDate)}`
                : `${balanceAmount}<br>Due ${dueForDisplay}`;
            
            // Plan catalog usage for display
            const matchedPlan = customer.planName ? planByName.get(normalizePlanName(customer.planName)) : undefined;
            const effectiveAmount = matchedPlan?.price ?? customer.planAmount ?? 0;
            const amountDisplay = formatCurrency(Number(effectiveAmount) || 0);
            const priceSuffix = (matchedPlan?.priceSuffix || customer.planBilling || '').toString().trim();
            const isLegacyPlan = !matchedPlan;
            const planPillClass = isLegacyPlan ? 'plan-pill accent' : 'plan-pill neutral';
            const planMetaText = isLegacyPlan
                ? '<span style="color:#b91c1c;font-weight:600;">Not in current plans</span>'
                : `${amountDisplay}${priceSuffix ? ` &middot; ${priceSuffix}` : ''}`;

            const accountNumber = normalizeAccountNumber(customer.accountNumber || '');

            const rowStatusClass = subscriberStatusClass === 'success' ? 'row-status-active' : 'row-status-inactive';

            return `
                <tr class="payments-row-clickable ${rowStatusClass}" data-account-number="${accountNumber}">
                    <td class="account-col">
                        <span class="account-tag-wrap">
                            <span class="account-tag">${accountNumber || '-'}</span>
                        ${accountNumber ? `
                            <button
                                type="button"
                                class="copy-btn account-copy-btn"
                                data-copy-account-number="${accountNumber}"
                                data-copy-account-name="${escapeHtml(displayName)}"
                                aria-label="Copy account number ${accountNumber}"
                                title="Copy account number">
                                <i class="fa-regular fa-copy"></i>
                            </button>
                        ` : ''}
                        </span>
                    </td>
                    <td>
                        <div class="subscriber">
                            <span class="avatar">${displayInitials}</span>
                            <div>
                                <p class="subscriber-name">${displayName}</p>
                                <p class="subscriber-meta">Joined ${customer.since || customer.joinDate || 'N/A'} &middot; <span class="status-pill status-pill--indicator ${subscriberStatusClass}" title="${escapeHtml(subscriberStatusLabel)}" aria-label="${escapeHtml(subscriberStatusLabel)}"></span></p>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div class="${planPillClass}">${customer.planName || 'N/A'}</div>
                        <p class="plan-meta">${planMetaText}</p>
                    </td>
                    <td>
                        <p class="cycle">${billingCycleDisplay}</p>
                        <p class="cycle muted">${billingCycleMeta}</p>
                    </td>
                    <td>
                        <div class="billing-amount mrc-amount">
                            ${amountDisplay}
                            <p class="billing-meta">Monthly recurring charge</p>
                        </div>
                    </td>
                    <td class="billing-amount ${lastPaymentClass}">${customer.lastPaymentAmount ? lastPayment : 'No payment yet'}</td>
                    <td><span class="status-pill ${statusInfo.class}">${statusInfo.text}</span></td>
                    <td class="billing-amount ${balanceClass}">${currentBill || 'N/A'}</td>
                    <td>
                        <div class="statement-actions-cell">
                            <button class="ghost-icon view-statement" data-account-number="${accountNumber}" aria-label="Account Statement" data-tooltip="Account Statement"><i class="fa-solid fa-file-lines"></i></button>
                            <button class="ghost-icon print-statement" data-account-number="${accountNumber}" aria-label="Billing Statement" data-tooltip="Billing Statement"><i class="fa-solid fa-print"></i></button>
                            <button class="ghost-icon print-thermal" data-account-number="${accountNumber}" aria-label="Thermal Receipt" data-tooltip="Thermal Receipt"><i class="fa-solid fa-receipt"></i></button>
                        </div>
                    </td>
                    <td class="actions-col">
                        <div class="row-actions">
                            <button class="ghost-icon add-payment" data-account-number="${accountNumber}" aria-label="Add payment" data-tooltip="Add payment"><i class="fa-solid fa-plus"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        paymentsTableBody.innerHTML = rowsHtml;
    }

    function applyFilters() {
        const searchQuery = (searchInput?.value || '').trim().toLowerCase();
        const statusFilter = String(filterStatusSelect?.value || '').trim().toLowerCase();
        const dueDateFilter = String(filterDueDateInput?.value || '').trim();
        const selectedAreas = getMultiSelectValues(filterAreaSelect);
        const totalAreaOptions = Array.from(filterAreaSelect?.options || [])
            .map((option) => String(option.value || '').trim())
            .filter(Boolean).length;
        const hasAreaOptions = totalAreaOptions > 0;
        const showNoAreas = hasAreaOptions && selectedAreas.length === 0;
        const useAreaFilter = hasAreaOptions && selectedAreas.length > 0 && selectedAreas.length < totalAreaOptions;
        const areaFilterSet = useAreaFilter
            ? new Set(selectedAreas.map((area) => area.toLowerCase()))
            : new Set();
        const sortFilter = paymentsSortSelect?.value || DEFAULT_SORT_FILTER;

        let results = allCustomers.slice();
        const compareText = (left, right) => String(left || '').localeCompare(String(right || ''), undefined, {
            sensitivity: 'base',
            numeric: true
        });

        // Filter by status
        if (statusFilter) {
            results = results.filter((customer) => deriveStatus(customer) === statusFilter);
        }

        // Filter by area
        if (showNoAreas) {
            results = [];
        } else if (areaFilterSet.size) {
            results = results.filter((customer) => areaFilterSet.has(getCustomerArea(customer).toLowerCase()));
        }

        // Filter by due date
        if (dueDateFilter) {
            results = results.filter((customer) => matchesDueCycleFilter(customer, dueDateFilter));
        }

        // Filter by search query
        if (searchQuery) {
            results = results.filter(customer => {
                const customerString = `${customer.firstName} ${customer.lastName} ${customer.accountNumber}`.toLowerCase();
                return customerString.includes(searchQuery);
            });
        }

        if (sortFilter === 'newOld' || sortFilter === 'oldNew') {
            const direction = sortFilter === 'newOld' ? -1 : 1;

            results.sort((a, b) => {
                const timeDiff = toComparablePaymentTimestamp(a) - toComparablePaymentTimestamp(b);
                if (timeDiff !== 0) return timeDiff * direction;
                return compareText(a?.accountNumber, b?.accountNumber) * direction;
            });
        } else if (sortFilter === 'balanceHighLow' || sortFilter === 'balanceLowHigh') {
            const direction = sortFilter === 'balanceHighLow' ? -1 : 1;
            const getComparableBalance = (customer) => Math.abs(Number(customer?.balance) || 0);

            results.sort((a, b) => {
                const balanceDiff = getComparableBalance(a) - getComparableBalance(b);
                if (balanceDiff !== 0) return balanceDiff * direction;

                const signedBalanceDiff = (Number(a?.balance) || 0) - (Number(b?.balance) || 0);
                if (signedBalanceDiff !== 0) return signedBalanceDiff * direction;

                return compareText(a?.accountNumber, b?.accountNumber);
            });
        } else if (sortFilter === 'firstNameAsc' || sortFilter === 'lastNameAsc') {
            const extractNameParts = (customer) => {
                const firstName = String(customer?.firstName || '').trim();
                const lastName = String(customer?.lastName || '').trim();
                if (firstName || lastName) return { firstName, lastName };

                const fullName = String(customer?.name || '').trim();
                if (!fullName) return { firstName: '', lastName: '' };

                const parts = fullName.split(/\s+/).filter(Boolean);
                const parsedFirstName = parts.shift() || '';
                const parsedLastName = parts.join(' ');
                return { firstName: parsedFirstName, lastName: parsedLastName };
            };

            results.sort((a, b) => {
                const aName = extractNameParts(a);
                const bName = extractNameParts(b);

                if (sortFilter === 'lastNameAsc') {
                    const lastCompare = compareText(aName.lastName, bName.lastName);
                    if (lastCompare !== 0) return lastCompare;
                    const firstCompare = compareText(aName.firstName, bName.firstName);
                    if (firstCompare !== 0) return firstCompare;
                } else {
                    const firstCompare = compareText(aName.firstName, bName.firstName);
                    if (firstCompare !== 0) return firstCompare;
                    const lastCompare = compareText(aName.lastName, bName.lastName);
                    if (lastCompare !== 0) return lastCompare;
                }

                return compareText(a?.accountNumber, b?.accountNumber);
            });
        }

        filteredPaymentsState = results;
        paymentsPagination.page = 1;
        renderPaymentsPage();
    }

    if (searchInput) {
        searchInput.addEventListener('input', applyFilters);
    }
    if (filterStatusSelect) {
        filterStatusSelect.addEventListener('change', applyFilters);
    }
    if (filterAreaSelect) {
        filterAreaSelect.addEventListener('change', applyFilters);
    }
    if (filterDueDateInput) {
        filterDueDateInput.addEventListener('change', applyFilters);
        filterDueDateInput.addEventListener('input', applyFilters);
    }
    if (paymentsSortSelect) {
        paymentsSortSelect.addEventListener('change', () => {
            localStorage.setItem(SORT_FILTER_STORAGE_KEY, paymentsSortSelect.value || '');
            applyFilters();
        });
    }

    if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', () => {
            const newSize = parseInt(pageSizeSelect.value, 10);
            paymentsPagination.pageSize = newSize;
            localStorage.setItem('paymentsPageSize', newSize);
            renderPaymentsPage();
        });
    }

    paymentsTableBody.addEventListener('click', async (event) => {
        const target = event.target.closest('button');
        if (!target) return;

        const copyAccountNumber = normalizeAccountNumber(target.dataset.copyAccountNumber || '');
        if (copyAccountNumber) {
            event.preventDefault();
            const accountName = String(target.dataset.copyAccountName || '').trim();
            const copied = await copyTextToClipboard(buildCopiedAccountText({
                accountName,
                accountNumber: copyAccountNumber
            }));
            showToast(copied ? 'Account details copied.' : 'Unable to copy account details.');
            return;
        }

        const accountNumber = normalizeAccountNumber(target.dataset.accountNumber);

        if (target.classList.contains('add-payment')) {
            if (!openPaymentModalForAccount(accountNumber)) {
                showToast('Unable to open payment form for this customer.');
            }
        }

        if (target.classList.contains('view-statement')) {
            window.open(`account-statement.html?account=${accountNumber}`, '_blank');
        }

        if (target.classList.contains('print-statement')) {
            window.open(`billing-statement.html?account=${accountNumber}`, '_blank');
        }

        if (target.classList.contains('print-thermal')) {
            window.open(`thermal-print.html?account=${accountNumber}`, '_blank');
        }

        const deleteBtn = event.target.closest('.delete-payment');
        if (deleteBtn) {
            const entryId = deleteBtn.dataset.entryId;
            const accountNumber = normalizeAccountNumber(deleteBtn.dataset.accountNumber);
            const confirmed = window.appConfirm
                ? await window.appConfirm('Are you sure you want to delete this payment record?', { title: 'Delete Payment Record' })
                : window.confirm('Are you sure you want to delete this payment record?');
            if (confirmed) {
                try {
                    const response = await fetch(`/api/payments/${accountNumber}/${entryId}`, { method: 'DELETE', credentials: 'include' });
                    if (!response.ok) throw new Error('Failed to delete payment');
                    showToast('Payment deleted.');
                    await loadPaymentRecords();
                } catch (error) {
                    showToast(`Error: ${error.message}`);
                }
            }
        }

    });

    paymentsTableBody.addEventListener('click', (event) => {
        if (event.target.closest('button, a, input, select, textarea, label')) return;
        const row = event.target.closest('tr[data-account-number]');
        if (!row) return;
        const accountNumber = normalizeAccountNumber(row.dataset.accountNumber);
        if (!accountNumber) return;
        if (!openAccountInfoModal(accountNumber, row)) {
            showToast('Unable to load account information.');
        }
    });

    // Add event listener for deleting entries within the history modal
    paymentHistoryTimeline.addEventListener('click', async (event) => {
        const yearToggleBtn = event.target.closest('.timeline-year__button');
        if (yearToggleBtn && paymentHistoryTimeline.contains(yearToggleBtn)) {
            const yearKey = String(yearToggleBtn.dataset.yearKey || '').trim();
            if (!yearKey) return;
            const isLocked = String(yearToggleBtn.dataset.yearLocked || '').trim().toLowerCase() === 'true';
            if (isLocked) return;
            if (paymentHistoryExpandedYears.has(yearKey)) {
                paymentHistoryExpandedYears.delete(yearKey);
            } else {
                paymentHistoryExpandedYears.add(yearKey);
            }
            const accountNumber = normalizeAccountNumber(yearToggleBtn.dataset.accountNumber || paymentHistoryExpandedAccount);
            renderPaymentHistory(paymentHistoryEntries, accountNumber);
            return;
        }

        const deleteBtn = event.target.closest('.timeline-delete');
        if (!deleteBtn) return;

        const entryId = deleteBtn.dataset.entryId;
        const accountNumber = normalizeAccountNumber(deleteBtn.dataset.accountNumber);

        const confirmed = window.appConfirm
            ? await window.appConfirm('Are you sure you want to delete this transaction? This action cannot be undone.', { title: 'Delete Transaction' })
            : window.confirm('Are you sure you want to delete this transaction? This action cannot be undone.');
        if (confirmed) {
            try {
                const response = await fetch(`/api/payments/${accountNumber}/${entryId}`, { method: 'DELETE', credentials: 'include' });
                if (!response.ok) {
                    throw new Error(await parseDeleteError(response, 'Failed to delete transaction'));
                }
                paymentHistorySelectedEntryIds.delete(normalizeEntryId(entryId));
                showToast('Transaction deleted successfully.');
                // Reload history to show the change
                await loadPaymentHistory(accountNumber);
                // Reload main table data to update balance
                await loadPaymentRecords();
            } catch (error) {
                showToast(`Error: ${error.message}`);
            }
        }
    });
    paymentHistoryTimeline.addEventListener('change', (event) => {
        const checkbox = event.target.closest('.timeline-select-checkbox');
        if (!checkbox) return;
        const entryId = normalizeEntryId(checkbox.dataset.entryId);
        if (!entryId) return;
        if (checkbox.checked) {
            paymentHistorySelectedEntryIds.add(entryId);
        } else {
            paymentHistorySelectedEntryIds.delete(entryId);
        }
        updatePaymentHistoryBulkUi();
    });
    if (paymentHistorySelectAll) {
        paymentHistorySelectAll.addEventListener('change', () => {
            applySelectionToAll(paymentHistorySelectedEntryIds, getPaymentHistorySelectableIds(), paymentHistorySelectAll.checked);
            renderPaymentHistory(paymentHistoryEntries, paymentHistoryExpandedAccount);
        });
    }
    if (paymentHistoryDeleteSelectedBtn) {
        paymentHistoryDeleteSelectedBtn.addEventListener('click', async () => {
            const accountNumber = normalizeAccountNumber(paymentHistoryExpandedAccount);
            const entryIds = Array.from(paymentHistorySelectedEntryIds);
            if (!accountNumber || !entryIds.length) {
                showToast('Select at least one transaction to delete.');
                return;
            }
            const confirmed = window.appConfirm
                ? await window.appConfirm(`Delete ${entryIds.length} selected transaction${entryIds.length === 1 ? '' : 's'}? This action cannot be undone.`, { title: 'Delete Selected Transactions' })
                : window.confirm(`Delete ${entryIds.length} selected transaction${entryIds.length === 1 ? '' : 's'}? This action cannot be undone.`);
            if (!confirmed) return;

            paymentHistoryDeleteSelectedBtn.disabled = true;
            try {
                const result = await deleteEntriesForAccount(accountNumber, entryIds);
                paymentHistorySelectedEntryIds.clear();
                await loadPaymentHistory(accountNumber);
                await loadPaymentRecords();
                const deletedCount = Number(result?.deletedCount) || entryIds.length;
                showToast(`${deletedCount} transaction${deletedCount === 1 ? '' : 's'} deleted.`);
            } catch (error) {
                showToast(`Error: ${error.message}`);
                updatePaymentHistoryBulkUi();
            }
        });
    }
    async function loadPaymentHistory(accountNumber) {
        const targetAccountNumber = normalizeAccountNumber(accountNumber);
        if (paymentHistoryExpandedAccount !== targetAccountNumber) {
            paymentHistoryExpandedAccount = targetAccountNumber;
            paymentHistoryExpandedYears.clear();
            paymentHistoryEntries = [];
            paymentHistorySelectedEntryIds.clear();
        }
        try {
            const response = await fetch(`/api/payments/${targetAccountNumber}`, { credentials: 'include' });
            if (!response.ok) throw new Error('Failed to fetch history');
            const data = await response.json();
            paymentHistoryEntries = Array.isArray(data.history) ? data.history : [];
            renderPaymentHistory(paymentHistoryEntries, targetAccountNumber);
        } catch (error) {
            console.error('Failed to load payment history:', error);
            paymentHistoryEntries = [];
            paymentHistorySelectedEntryIds.clear();
            updatePaymentHistoryBulkUi();
            paymentHistoryTimeline.innerHTML = `<div class="empty-state compact error"><i class="fa-solid fa-circle-exclamation"></i><p>Could not load history.</p><p class="hint">${error.message}</p></div>`;
        } finally {
            historyModal.classList.add('show');
            historyModal.setAttribute('aria-hidden', 'false');
            syncModalScrollLock();
        }
    }

    function renderPaymentHistory(history, accountNumber) {
        if (history.length === 0) {
            paymentHistorySelectedEntryIds.clear();
            updatePaymentHistoryBulkUi();
            paymentHistoryTimeline.innerHTML = '<div class="empty-state compact"><i class="fa-solid fa-receipt"></i><p>No transactions recorded yet.</p><p class="hint">Add a payment or charge to start building history.</p></div>';
            return;
        }

        const getIconForKind = (kind) => {
            const iconMap = {
                payment: 'fa-solid fa-hand-holding-dollar',
                charge: 'fa-solid fa-file-invoice-dollar',
                rebate: 'fa-solid fa-gift',
                discount: 'fa-solid fa-tags',
                bill: 'fa-solid fa-file-invoice'
            };
            return iconMap[kind] || 'fa-solid fa-receipt';
        };

        const normalizeReferenceForDisplay = (entry) => {
            const raw = String(entry?.reference || entry?.ref || '').trim();
            if (!raw) return '';
            if (typeof accountViewShared?.normalizeReferenceForDisplay === 'function') {
                return accountViewShared.normalizeReferenceForDisplay(raw);
            }
            const tagged = raw.match(/^(?:acct|cust)-([^-]+)-(.+)$/i);
            if (!tagged || !tagged[2]) return raw;
            const trailingToken = String(tagged[2]).split('-').filter(Boolean).pop();
            return String(trailingToken || tagged[2]).trim() || raw;
        };
        const getEntryDisplayDate = (entry) => {
            const dateValue = String(entry?.date || '').trim();
            const recordedAtValue = String(entry?.recordedAt || '').trim();
            if (dateValue && !hasExplicitTime(dateValue) && recordedAtValue && hasExplicitTime(recordedAtValue)) {
                return recordedAtValue;
            }
            return entry?.date || entry?.recordedAt || '';
        };

        const getEntryTimestamp = (entry) => {
            const parsed = parseTimestampValue(getEntryDisplayDate(entry));
            return parsed ? parsed.getTime() : 0;
        };

        const getEntryYearKey = (entry) => {
            return getManilaYearKey(getEntryDisplayDate(entry));
        };

        const sortedHistory = [...history].sort((a, b) => getEntryTimestamp(b) - getEntryTimestamp(a));
        const currentYearKey = MANILA_YEAR_FORMATTER.format(new Date());

        const renderTimelineEntry = (entry) => {
            const referenceValue = normalizeReferenceForDisplay(entry);
            const hasReference = Boolean(referenceValue);
            const referenceText = hasReference ? escapeHtml(referenceValue) : 'N/A';
            const referenceClass = hasReference
                ? 'timeline-meta-value timeline-ref-value'
                : 'timeline-meta-value timeline-ref-value is-missing';
            const rawOrNumber = String(entry?.orNumber || entry?.or_number || '').trim();
            const hasOrNumber = Boolean(rawOrNumber);
            const orNumberText = hasOrNumber ? escapeHtml(rawOrNumber) : 'N/A';
            const orNumberClass = hasOrNumber
                ? 'timeline-meta-value timeline-ref-value'
                : 'timeline-meta-value timeline-ref-value is-missing';
            const notesText = escapeHtml(entry.description || '');
            const payerText = entry.payer ? escapeHtml(entry.payer || '') : '';
            const recorderText = escapeHtml(formatRecorderLabel(entry.recordedBy, entry.kind));

            const descriptionText = notesText || 'No description';
            const paidByText = payerText || 'N/A';
            const entryId = normalizeEntryId(entry.id);

            // Build HTML using concatenation to avoid nested template literal parsing issues
            let html = '';
            html += '<div class="timeline-entry ' + (entry.kind || '') + '" data-direction="' + (entry.direction || '') + '">';
            html += '<div class="timeline-entry__actions">';
            if (entryId) {
                html += '<input type="checkbox" class="timeline-select-checkbox" data-entry-id="' + escapeHtml(entryId) + '" data-account-number="' + (accountNumber || '') + '" aria-label="Select this transaction"' + (paymentHistorySelectedEntryIds.has(entryId) ? ' checked' : '') + '>';
            }
            html += '<button class="timeline-delete" data-entry-id="' + (entry.id || '') + '" data-account-number="' + (accountNumber || '') + '" aria-label="Delete this entry" data-tooltip="Delete this entry">';
            html += '<i class="fa-solid fa-trash-can"></i>';
            html += '</button>';
            html += '</div>';
            html += '<div class="timeline-icon"><i class="' + getIconForKind(entry.kind) + '"></i></div>';
            html += '<div class="timeline-body">';
            html += '<header>';
            const kindText = (entry.kind || 'Transaction');
            html += '<h3>' + (kindText.charAt(0).toUpperCase() + kindText.slice(1)) + '</h3>';
            const ts = formatDateTime(getEntryDisplayDate(entry), 'N/A');
            html += '<span class="timestamp">' + ts + '</span>';
            html += '</header>';
            const amt = (entry.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            html += '<p class="timeline-amount ' + (entry.direction || '') + '">' + (entry.direction === 'debit' ? '-' : '') + '₱' + amt + '</p>';
            html += '<div class="timeline-meta-grid timeline-meta-grid--two-col">';
            html += '<p class="timeline-meta timeline-meta-cell"><span class="timeline-meta-key">Details:</span><span class="timeline-meta-value timeline-details-value">' + descriptionText + '</span></p>';
            html += '<p class="timeline-meta timeline-meta-cell"><span class="timeline-meta-key">Ref:</span><span class="' + referenceClass + '">' + referenceText + '</span></p>';
            html += '<p class="timeline-meta timeline-meta-cell"><span class="timeline-meta-key">OR:</span><span class="' + orNumberClass + '">' + orNumberText + '</span></p>';
            html += '<p class="timeline-meta timeline-meta-cell"><span class="timeline-meta-key">Paid by:</span><span class="timeline-meta-value timeline-person-value">' + paidByText + '</span></p>';
            html += '<p class="timeline-meta timeline-meta-cell"><span class="timeline-meta-key">Recorded by:</span><span class="timeline-meta-value timeline-person-value">' + recorderText + '</span></p>';
            html += '</div>';
            html += '</div>';
            html += '</div>';
            return html;
        };

        const yearBuckets = new Map();
        sortedHistory.forEach((entry) => {
            const yearKey = getEntryYearKey(entry);
            const bucket = yearBuckets.get(yearKey) || {
                key: yearKey,
                sortWeight: Number(yearKey) || -1,
                entries: []
            };
            bucket.entries.push(entry);
            yearBuckets.set(yearKey, bucket);
        });

        const yearGroups = Array.from(yearBuckets.values())
            .sort((left, right) => right.sortWeight - left.sortWeight);

        const validYearKeys = new Set(yearGroups.map((group) => group.key));
        paymentHistoryExpandedYears.forEach((yearKey) => {
            if (!validYearKeys.has(yearKey)) paymentHistoryExpandedYears.delete(yearKey);
        });

        const historyHtml = yearGroups.map((group) => {
            const isCurrentYear = group.key === currentYearKey;
            const isExpanded = isCurrentYear || paymentHistoryExpandedYears.has(group.key);
            const entryCount = group.entries.length;
            const yearLabel = group.key === 'unknown' ? 'No Date' : group.key;
            const entriesHtml = group.entries.map(renderTimelineEntry).join('');
            return `
                <section class="timeline-year ${isExpanded ? 'is-open' : ''} ${isCurrentYear ? 'is-current' : ''}">
                    <button
                        type="button"
                        class="timeline-year__button ${isCurrentYear ? 'is-locked' : ''}"
                        data-year-key="${escapeHtml(group.key)}"
                        data-year-locked="${isCurrentYear ? 'true' : 'false'}"
                        data-account-number="${escapeHtml(accountNumber || '')}"
                        aria-expanded="${isExpanded ? 'true' : 'false'}"
                        ${isCurrentYear ? 'aria-disabled="true"' : ''}
                    >
                        <span class="timeline-year__label">${escapeHtml(yearLabel)}</span>
                        <span class="timeline-year__meta">${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}</span>
                        <span class="timeline-year__icon"><i class="fa-solid fa-chevron-down"></i></span>
                    </button>
                    <div class="timeline-year__entries" ${isExpanded ? '' : 'hidden'}>
                        ${entriesHtml}
                    </div>
                </section>
            `;
        }).join('');
        paymentHistoryTimeline.innerHTML = historyHtml;
        updatePaymentHistoryBulkUi();
    }

    const updatePaymentsFooter = (total, start, end, pageCount) => {
        if (!paymentsFooter) return;
        paymentsFooter.classList.toggle('is-empty', total === 0);
        if (total === 0) {
            paymentsSummary.textContent = 'Showing 0 of 0 customers';
            paymentsPageInfo.textContent = 'Page 1 of 1';
        } else {
            paymentsSummary.textContent = `Showing ${start}-${end} of ${total} customers`;
            paymentsPageInfo.textContent = `Page ${paymentsPagination.page} of ${pageCount}`;
        }
        paymentsPrev.disabled = paymentsPagination.page <= 1;
        paymentsNext.disabled = paymentsPagination.page >= pageCount;
    };

    const renderPaymentsPage = () => {
        // For now, we render customers instead of payments
        const parsedSize = parseInt(pageSizeSelect?.value, 10);
        if (Number.isFinite(parsedSize) && parsedSize > 0) {
            paymentsPagination.pageSize = parsedSize;
        } else if (!Number.isFinite(paymentsPagination.pageSize) || paymentsPagination.pageSize <= 0) {
            paymentsPagination.pageSize = 10; // safe default
        }
        const total = Array.isArray(filteredPaymentsState) ? filteredPaymentsState.length : 0;
        const pageCount = Math.ceil(total / paymentsPagination.pageSize) || 1;
        const page = Math.min(Math.max(paymentsPagination.page, 1), pageCount);
        const startIndex = (page - 1) * paymentsPagination.pageSize;
        const pageRecords = (Array.isArray(filteredPaymentsState) ? filteredPaymentsState : []).slice(startIndex, startIndex + paymentsPagination.pageSize);
        renderPayments(pageRecords);
        updatePaymentsFooter(total, startIndex + 1, startIndex + pageRecords.length, pageCount);
    };

    paymentsPrev.addEventListener('click', () => {
        if (paymentsPagination.page > 1) {
            paymentsPagination.page--;
            renderPaymentsPage();
        }
    });

    paymentsNext.addEventListener('click', () => {
        const total = filteredPaymentsState.length;
        const pageCount = Math.ceil(total / paymentsPagination.pageSize) || 1;
        if (paymentsPagination.page < pageCount) {
            paymentsPagination.page++;
            renderPaymentsPage();
        }
    });

    async function init() {
        if (pageSizeSelect) {
            pageSizeSelect.value = paymentsPagination.pageSize;
        }
        if (paymentsSortSelect) {
            const savedSortFilter = String(localStorage.getItem(SORT_FILTER_STORAGE_KEY) || '').trim();
            const hasOption = Array.from(paymentsSortSelect.options || []).some((option) => option.value === savedSortFilter);
            paymentsSortSelect.value = hasOption ? savedSortFilter : DEFAULT_SORT_FILTER;
        }
        // Load current authenticated user for prefilling payer
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const j = await res.json();
                currentUser = j.user || null;
            } else {
                currentUser = null;
            }
        } catch (e) {
            currentUser = null;
        }
        updateRecorderHint();
        await loadMikrotikVisibilityState();
        // Load plan catalog first (for accurate plan display), then payment records
        primeCustomerAddFrame({ force: true });
        await loadPlansCatalog();
        await loadPaymentRecords();

        if (payNowAccountFromQuery) {
            const requestedPayNowAccount = payNowAccountFromQuery;
            payNowAccountFromQuery = '';
            const opened = openPaymentModalForAccount(requestedPayNowAccount);
            if (!opened) {
                showToast(`Account ${requestedPayNowAccount} was not found in Payments.`);
            }
            const url = new URL(window.location.href);
            if (url.searchParams.has('payNow')) {
                url.searchParams.delete('payNow');
                const nextUrl = `${url.pathname}${url.search}${url.hash}`;
                window.history.replaceState({}, '', nextUrl);
            }
        }
    }

    init();
});
