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
    const paymentCustomerField = document.getElementById('paymentCustomerField');
    const paymentLockedCustomer = document.getElementById('paymentLockedCustomer');
    const paymentLockedCustomerAvatar = document.getElementById('paymentLockedCustomerAvatar');
    const paymentLockedCustomerName = document.getElementById('paymentLockedCustomerName');
    const paymentLockedCustomerMeta = document.getElementById('paymentLockedCustomerMeta');
    const paymentLockedAccountInput = document.getElementById('paymentLockedAccountInput');
    const paymentAmountInput = document.getElementById('paymentAmount');
    const paymentKindSelect = document.getElementById('paymentKind');
    const paymentMethodField = document.getElementById('paymentMethodField');
    const paymentMethodSelect = document.getElementById('paymentMethod');
    const paymentReferenceField = document.getElementById('paymentReferenceField');
    const paymentReferenceInput = document.getElementById('paymentReference');
    const paymentAmountField = document.getElementById('paymentAmountField');
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
    const paymentBreakdownModal = document.getElementById('paymentBreakdownModal');
    const paymentBreakdownModalSubtitle = document.getElementById('paymentBreakdownModalSubtitle');
    const paymentBreakdownModalAddPayment = document.getElementById('paymentBreakdownModalAddPayment');
    const paymentBreakdownModalFullPage = document.getElementById('paymentBreakdownModalFullPage');
    const paymentBreakdownModalAccount = document.getElementById('paymentBreakdownModalAccount');
    const paymentBreakdownModalPlan = document.getElementById('paymentBreakdownModalPlan');
    const paymentBreakdownModalStatus = document.getElementById('paymentBreakdownModalStatus');
    const paymentBreakdownModalBalance = document.getElementById('paymentBreakdownModalBalance');
    const paymentBreakdownModalNotice = document.getElementById('paymentBreakdownModalNotice');
    const paymentBreakdownModalTableBody = document.getElementById('paymentBreakdownModalTableBody');
    const paymentBreakdownModalSummary = document.getElementById('paymentBreakdownModalSummary');
    const paymentBreakdownTableRenderer = window.PaymentBreakdownTable || null;
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
    const canUseDirectWifi = () => Boolean(window.directWifiEnabled ?? window.isArchieFlavor);
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
    const BUSINESS_PROFILE_STORAGE_KEY = 'archie-business-profile';
    const DEFAULT_BUSINESS_NAME = 'Archie Point To Point Pisonet';
    const rootElement = document.documentElement;
    const bodyElement = document.body;

    let allCustomers = [];
    let filteredPaymentsState = [];
    let lastFocusedElement = null;
    let currentUser = null;
    let selectedCustomer = null;
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
    let paymentBreakdownRequestId = 0;
    let activePaymentBreakdownAccount = '';
    let paymentBreakdownPaymentAccount = '';
    const paymentHistorySelectedEntryIds = new Set();
    const paymentHistoryExpandedYears = new Set();
    let currentBillStateCache = new WeakMap();
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
    const buildPaymentBreakdownUrl = (accountNumber) => {
        const target = normalizeAccountNumber(accountNumber);
        return target ? `payment-breakdown.html?account=${encodeURIComponent(target)}` : '#';
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
        } catch (e) {
            // fallback: empty
            plansCatalog = { prepaid: [], postpaid: [] };
            planByName.clear();
        }
    }

    const DEFAULT_PAYMENTS_PAGE_SIZE = 50;
    const getValidPageSize = (value, fallback = DEFAULT_PAYMENTS_PAGE_SIZE) => {
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
        const hasMatchingOption = Array.from(pageSizeSelect?.options || [])
            .some((option) => parseInt(option.value, 10) === parsed);
        return hasMatchingOption ? parsed : fallback;
    };
    const savedPageSize = localStorage.getItem('paymentsPageSize');
    const initialPageSize = getValidPageSize(savedPageSize);

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
    const EPSILON = 0.005;
    const MAX_SYNTHETIC_BREAKDOWN_ROWS = 120;
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
    const formatMonthKeyLabel = (monthKey) => {
        const match = String(monthKey || '').trim().match(/^(\d{4})-(\d{2})$/);
        if (!match) return 'selected month';
        const date = buildStableManilaDate(Number(match[1]), Number(match[2]), 1);
        return new Intl.DateTimeFormat('en-PH', { timeZone: window.__APP_TIMEZONE__ || 'Asia/Manila', month: 'short', year: 'numeric' }).format(date);
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
    const getCustomerInitials = (customer) => {
        const parts = getCustomerNameParts(customer);
        const directInitials = `${parts.firstName?.[0] || ''}${parts.lastName?.[0] || ''}`.toUpperCase();
        if (directInitials) return directInitials;
        const fallbackName = formatCustomerName(customer);
        const fallbackInitials = fallbackName
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0] || '')
            .join('')
            .toUpperCase();
        return fallbackInitials || '--';
    };
    const getLockedCustomerMeta = (customer) => {
        const accountNumber = normalizeAccountNumber(customer?.accountNumber || '');
        const planName = String(
            customer?.planName
            || customer?.plan
            || customer?.planPackage
            || customer?.package
            || ''
        ).trim();
        const area = getCustomerArea(customer);
        const pieces = [
            accountNumber ? `Account ${accountNumber}` : '',
            planName,
            area
        ].filter(Boolean);
        return pieces.join(' • ') || 'Payment will be saved to this subscriber.';
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
    const getLastDayOfMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate();
    const isLastDayOfMonth = (date) => Boolean(
        date instanceof Date
        && !Number.isNaN(date.getTime())
        && date.getDate() === getLastDayOfMonth(date.getFullYear(), date.getMonth())
    );
    const isThirtyFirstDay = (date) => Boolean(
        date instanceof Date
        && !Number.isNaN(date.getTime())
        && date.getDate() === 31
    );
    const hasMonthEndBillingCycle = (customer = {}) => {
        const text = String([
            customer?.billingCycle,
            customer?.billing_cycle,
            customer?.planBilling,
            customer?.billing
        ].filter(Boolean).join(' ')).trim().toLowerCase();
        return /\blast\b/.test(text) && /\bmonth\b/.test(text);
    };
    const usesMonthEndBillingCycle = (customer = {}, referenceDate = null) => {
        const billDate = parseDateOnly(customer?.billDate || customer?.bill_date);
        const dueDate = parseDateOnly(customer?.dueDate || customer?.due_date);
        return hasMonthEndBillingCycle(customer)
            || isThirtyFirstDay(referenceDate)
            || isThirtyFirstDay(billDate)
            || isThirtyFirstDay(dueDate);
    };
    const buildMonthlyDate = (year, monthIndex, day, monthEnd = false) => {
        const lastDay = getLastDayOfMonth(year, monthIndex);
        const safeDay = monthEnd ? lastDay : Math.min(day, lastDay);
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
        const useMonthEnd = usesMonthEndBillingCycle(customer, parsedDue);
        const baseDay = useMonthEnd ? 31 : parsedDue.getDate();
        let year = parsedDue.getFullYear();
        let month = parsedDue.getMonth();
        let candidate = buildMonthlyDate(year, month, baseDay, useMonthEnd);

        while (candidate < start) {
            month += 1;
            if (month > 11) {
                month = 0;
                year += 1;
            }
            candidate = buildMonthlyDate(year, month, baseDay, useMonthEnd);
        }

        return formatDate(candidate);
    };
    const addDays = (date, days = 0) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
        const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        result.setDate(result.getDate() + (Number(days) || 0));
        return result;
    };
    const deriveDueOffsetForCustomer = (customer = {}) => {
        const direct = Number(customer?.dueOffset ?? customer?.due_offset);
        if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);

        const billDate = parseDateOnly(customer?.billDate);
        const dueDate = parseDateOnly(customer?.dueDate);
        const diffDays = dateDiffDays(billDate, dueDate);
        return Number.isFinite(diffDays) && diffDays >= 0 ? diffDays : null;
    };
    const resolveDueDateForBreakdownRow = (customer = {}, row = null) => {
        const planCategory = resolvePlanCategory(customer);
        if (planCategory === 'prepaid') {
            return parseDateOnly(customer?.prepaidExpirationAt || customer?.prepaid_expiration_at || customer?.dueDate || customer?.due_date)
                || (row?.billDate instanceof Date ? row.billDate : null);
        }

        const billDate = row?.billDate instanceof Date && !Number.isNaN(row.billDate.getTime())
            ? row.billDate
            : null;
        if (billDate) {
            const dueOffset = deriveDueOffsetForCustomer(customer);
            if (dueOffset !== null) return addDays(billDate, dueOffset);
        }
        return parseDateOnly(customer?.dueDate || customer?.due_date) || billDate;
    };
    const isMonthlyChargeEntry = (entry = {}) => {
        const entryId = String(entry?.id || '').trim();
        const kind = String(entry?.kind || '').trim().toLowerCase();
        const direction = String(entry?.direction || entry?.nature || '').trim().toLowerCase();
        const description = String(entry?.description || '').trim().toLowerCase();
        if (/^bill-[^-]+-\d{4}-\d{2}$/i.test(entryId)) return true;
        return (kind === 'charge' || kind === 'debit')
            && (direction === 'debit' || !direction)
            && /^monthly recurring charge\b/.test(description);
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
    const isOpeningPreviousBalanceEntry = (entry = {}) => {
        const reference = String(entry?.reference || entry?.orNumber || entry?.or_number || '').trim().toLowerCase();
        const description = String([
            entry?.description,
            entry?.notes,
            entry?.remarks
        ].filter(Boolean).join(' ')).trim().toLowerCase();
        return reference.startsWith('obb-')
            || reference.startsWith('opening-bal-')
            || description.includes('previous balance bill')
            || description.includes('opening previous balance');
    };
    const isPrepaidAutoChargeEntry = (entry = {}) => {
        const description = String([
            entry?.description,
            entry?.notes,
            entry?.remarks
        ].filter(Boolean).join(' ')).trim().toLowerCase();
        return description.includes('prepaid renewal charge');
    };
    const isOpeningAdvancePaymentEntry = (entry = {}) => {
        const reference = String(entry?.reference || entry?.orNumber || entry?.or_number || '').trim().toLowerCase();
        const description = String([
            entry?.description,
            entry?.notes,
            entry?.remarks
        ].filter(Boolean).join(' ')).trim().toLowerCase();
        return reference.startsWith('oba-')
            || reference.startsWith('opening-adv-')
            || description.includes('opening advance payment');
    };
    const resolveEntryDirection = (entry = {}) => {
        const kind = String(entry?.kind || '').trim().toLowerCase();
        const direction = String(entry?.direction || entry?.nature || '').trim().toLowerCase();
        if (isOpeningPreviousBalanceEntry(entry)) return 'debit';
        if (direction === 'debit' || direction === 'credit') return direction;
        if (kind === 'charge' || kind === 'debit' || kind === 'bill') return 'debit';
        if (kind === 'payment' || kind === 'rebate' || kind === 'discount' || kind === 'credit') return 'credit';
        return '';
    };
    const isEffectivePaymentStatusForPayments = (entry = {}) => {
        const status = String(entry?.status || entry?.paymentStatus || entry?.payment_status || '').trim().toLowerCase();
        return ![
            'pending_approval',
            'pending-approval',
            'pending approval',
            'rejected',
            'cancelled',
            'canceled',
            'void',
            'voided'
        ].includes(status);
    };
    const getEntryComparableTime = (entry = {}) => {
        const parsed = parseTimestampValue(entry?.recordedAt || entry?.recorded_at || entry?.date || '');
        return parsed ? parsed.getTime() : 0;
    };
    const getEffectivePaymentHistory = (history = []) => {
        const source = (Array.isArray(history) ? history : [])
            .filter(isEffectivePaymentStatusForPayments)
            .filter((entry) => !(
                resolveEntryDirection(entry) === 'debit'
                && isPrepaidAutoChargeEntry(entry)
            ));
        const entries = source
            .map((entry, index) => ({
                entry,
                amount: Math.abs(Number(entry?.amount) || 0),
                direction: resolveEntryDirection(entry),
                dateKey: getEntryDateKey(entry),
                time: getEntryComparableTime(entry) || index,
                index
            }));
        const openingAdjustments = entries.filter((row) => (
            row.amount > 0
            && (
                (row.direction === 'debit' && isOpeningPreviousBalanceEntry(row.entry))
                || (row.direction === 'credit' && isOpeningAdvancePaymentEntry(row.entry))
            )
        ));
        if (!openingAdjustments.length) return source;

        const ignoredIndexes = new Set();
        entries.forEach((row) => {
            if (row.direction !== 'debit' || !row.amount || !isPrepaidAutoChargeEntry(row.entry)) return;
            const matchedOpening = openingAdjustments.some((opening) => {
                const amountMatches = Math.abs(opening.amount - row.amount) <= 0.005;
                const dateMatches = row.dateKey && row.dateKey === opening.dateKey;
                const timeMatches = Math.abs(row.time - opening.time) <= 30000;
                return amountMatches && dateMatches && timeMatches;
            });
            if (matchedOpening) ignoredIndexes.add(row.index);
        });

        return entries
            .filter((row) => !ignoredIndexes.has(row.index))
            .map((row) => row.entry);
    };
    const hasOutstandingMonthlyChargeOnDate = (customer = {}, targetDateKey = '') => {
        if (!targetDateKey) return false;
        const history = getEffectivePaymentHistory(Array.isArray(customer?.history) ? customer.history : []);
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
    const roundMoney = (value) => {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return 0;
        return Math.round((amount + Number.EPSILON) * 100) / 100;
    };
    const roundWholePeso = (value) => {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return 0;
        return Math.round(amount);
    };
    const getPlanAmountForCustomer = (customer = {}) => {
        const matchedPlan = customer.planName ? planByName.get(normalizePlanName(customer.planName)) : null;
        const candidates = [
            matchedPlan?.price,
            customer?.planAmount,
            customer?.planPrice,
            customer?.monthlyFee,
            customer?.price
        ];
        for (const candidate of candidates) {
            const amount = Number(candidate);
            if (Number.isFinite(amount) && amount > 0) return roundMoney(amount);
        }
        return 0;
    };
    const isSameMonth = (left, right) => Boolean(
        left instanceof Date
        && right instanceof Date
        && !Number.isNaN(left.getTime())
        && !Number.isNaN(right.getTime())
        && left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
    );
    const getMonthEndDate = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
        return new Date(date.getFullYear(), date.getMonth() + 1, 0);
    };
    const getInclusiveDayCount = (startDate, endDate) => {
        if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime()) || !(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
            return 0;
        }
        const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        if (endUtc < startUtc) return 0;
        return Math.floor((endUtc - startUtc) / 86400000) + 1;
    };
    const resolveFirstBillingAmount = (customer = {}, fullPlanAmount = 0, cycleDate = new Date()) => {
        const planAmount = Number(fullPlanAmount) || 0;
        const activationDate = parseDateOnly(customer?.activationDate || customer?.activation_date);
        if (isExistingCustomerStart(customer) && activationDate && isSameMonth(activationDate, cycleDate)) {
            return {
                amount: 0,
                isProrated: false,
                periodStart: null,
                periodEnd: null,
                skipInitialCharge: true
            };
        }
        if (!activationDate || planAmount <= 0 || !isSameMonth(activationDate, cycleDate)) {
            return {
                amount: roundMoney(planAmount),
                isProrated: false,
                periodStart: null,
                periodEnd: null,
                skipInitialCharge: false
            };
        }
        const monthStart = new Date(activationDate.getFullYear(), activationDate.getMonth(), 1);
        const monthEnd = getMonthEndDate(activationDate);
        const activeDays = getInclusiveDayCount(activationDate, monthEnd);
        const totalDays = getInclusiveDayCount(monthStart, monthEnd);
        if (!activeDays || !totalDays || activeDays >= totalDays) {
            return {
                amount: roundMoney(planAmount),
                isProrated: false,
                periodStart: null,
                periodEnd: null,
                skipInitialCharge: false
            };
        }
        return {
            amount: roundWholePeso((planAmount / totalDays) * activeDays),
            isProrated: true,
            periodStart: activationDate,
            periodEnd: monthEnd,
            skipInitialCharge: false
        };
    };
    const isExistingCustomerStart = (customer = {}) => {
        const raw = String(
            customer?.customerStartType
            || customer?.subscriberStartType
            || customer?.customerOrigin
            || ''
        ).trim().toLowerCase();
        return raw === 'existing';
    };
    const isExistingCustomerOpeningCycle = (customer = {}, cycleDate = new Date()) => {
        if (!isExistingCustomerStart(customer)) return false;
        const activationDate = parseDateOnly(customer?.activationDate || customer?.activation_date);
        return Boolean(activationDate && isSameMonth(activationDate, cycleDate));
    };
    const getLedgerBalance = (customer = {}) => {
        const history = Array.isArray(customer?.history) ? customer.history : [];
        if (!history.length) {
            const directBalance = Number(customer?.balance);
            return Number.isFinite(directBalance) ? roundMoney(directBalance) : 0;
        }
        return roundMoney(getEffectivePaymentHistory(history).reduce((sum, entry) => {
            const amount = Math.abs(Number(entry?.amount) || 0);
            const direction = resolveEntryDirection(entry);
            if (direction === 'debit') return sum + amount;
            if (direction === 'credit') return sum - amount;
            return sum;
        }, 0));
    };

    const normalizeBreakdownText = (value) => String(value || '').trim().toLowerCase();
    const normalizeBreakdownIdentity = (value) => normalizeBreakdownText(value).replace(/[^a-z0-9]+/g, '');
    const toBreakdownAmount = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? roundMoney(Math.abs(parsed)) : 0;
    };
    const toBreakdownAdjustmentAmount = (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) return 0;
        return roundMoney(parsed);
    };
    const hasBreakdownAmountOverride = (value) => {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string' && !value.trim()) return false;
        return Number.isFinite(Number(value));
    };
    const toOptionalBreakdownAdjustmentAmount = (value) => (
        hasBreakdownAmountOverride(value) ? toBreakdownAdjustmentAmount(value) : null
    );
    const toBreakdownAdjustmentText = (value) => String(value || '').trim().slice(0, 160);
    const hasOwnBreakdownAdjustmentField = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
    const normalizeBreakdownMonthKeyForPayments = (value) => {
        const text = toBreakdownAdjustmentText(value);
        const match = text.match(/^(\d{4})-(\d{2})$/) || text.match(/^(\d{4})-(\d{2})-\d{2}/);
        if (!match) return '';
        const year = Number(match[1]);
        const month = Number(match[2]);
        if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return '';
        return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    };
    const resolveRawFirstBillAdjustmentForPayments = (adjustment = {}) => {
        if (!adjustment || typeof adjustment !== 'object' || Array.isArray(adjustment)) return {};
        if (adjustment.firstBill && typeof adjustment.firstBill === 'object') return adjustment.firstBill;
        const firstBillFields = [
            'previousBalance',
            'advance',
            'referral',
            'due',
            'referralName',
            'referredName',
            'referralClientName',
            'referralAccountNumber',
            'referredAccountNumber'
        ];
        return firstBillFields.some((field) => hasOwnBreakdownAdjustmentField(adjustment, field)) ? adjustment : {};
    };
    const normalizeFirstBillAdjustmentForPayments = (adjustment = null) => {
        const firstBill = resolveRawFirstBillAdjustmentForPayments(adjustment);
        if (!firstBill || typeof firstBill !== 'object') return null;
        return {
            previousBalance: toBreakdownAdjustmentAmount(firstBill.previousBalance),
            advance: toBreakdownAdjustmentAmount(firstBill.advance),
            referral: toOptionalBreakdownAdjustmentAmount(firstBill.referral),
            due: toOptionalBreakdownAdjustmentAmount(firstBill.due),
            referralName: toBreakdownAdjustmentText(
                firstBill.referralName
                || firstBill.referredName
                || firstBill.referralClientName
            ),
            referralAccountNumber: toBreakdownAdjustmentText(
                firstBill.referralAccountNumber
                || firstBill.referredAccountNumber
            )
        };
    };
    const normalizeMonthlyReferralAdjustmentsForPayments = (input = {}) => {
        const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
        return Object.entries(source).reduce((acc, [key, value]) => {
            const item = value && typeof value === 'object' && !Array.isArray(value)
                ? value
                : { referral: value };
            const monthKey = normalizeBreakdownMonthKeyForPayments(
                item.monthKey
                || item.billingMonth
                || item.billMonth
                || key
            );
            const referralValue = item.referral ?? item.amount ?? item.discount;
            if (!monthKey || !hasBreakdownAmountOverride(referralValue)) return acc;
            const referralName = toBreakdownAdjustmentText(
                item.referralName
                || item.referredName
                || item.referralClientName
                || item.name
            );
            const referralAccountNumber = toBreakdownAdjustmentText(
                item.referralAccountNumber
                || item.referredAccountNumber
                || item.accountNumber
            );
            acc[monthKey] = {
                monthKey,
                referral: toBreakdownAdjustmentAmount(referralValue)
            };
            if (referralName) acc[monthKey].referralName = referralName;
            if (referralAccountNumber) acc[monthKey].referralAccountNumber = referralAccountNumber;
            return acc;
        }, {});
    };
    const normalizePlanChangeAdjustmentsForPayments = (input = []) => {
        const list = Array.isArray(input)
            ? input
            : Object.values(input && typeof input === 'object' ? input : {});
        const byMonth = new Map();
        list.forEach((value) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return;
            const effectiveMonth = normalizeBreakdownMonthKeyForPayments(
                value.effectiveMonth
                || value.monthKey
                || value.billingMonth
                || value.billMonth
            );
            const planAmount = toBreakdownAdjustmentAmount(value.planAmount ?? value.amount ?? value.price);
            if (!effectiveMonth || planAmount <= 0) return;
            const planCategory = toBreakdownAdjustmentText(value.planCategory || value.category || value.planType).toLowerCase();
            const entry = {
                effectiveMonth,
                planId: toBreakdownAdjustmentText(value.planId || value.id),
                planName: toBreakdownAdjustmentText(value.planName || value.name || value.label) || 'Adjusted plan',
                planAmount
            };
            if (planCategory === 'prepaid' || planCategory === 'postpaid') {
                entry.planCategory = planCategory;
            }
            byMonth.set(effectiveMonth, entry);
        });
        return Array.from(byMonth.values()).sort((left, right) => (
            left.effectiveMonth.localeCompare(right.effectiveMonth)
        ));
    };
    const normalizePaymentBreakdownAdjustmentForPayments = (adjustment = null) => {
        if (!adjustment || typeof adjustment !== 'object' || Array.isArray(adjustment)) {
            return { firstBill: null, monthlyReferrals: {}, planChanges: [] };
        }
        return {
            firstBill: normalizeFirstBillAdjustmentForPayments(adjustment),
            monthlyReferrals: normalizeMonthlyReferralAdjustmentsForPayments(
                adjustment.monthlyReferrals
                || adjustment.referralAdjustments
                || adjustment.monthlyReferralAdjustments
            ),
            planChanges: normalizePlanChangeAdjustmentsForPayments(
                adjustment.planChanges
                || adjustment.scheduledPlanChanges
                || adjustment.planChangeAdjustments
            )
        };
    };
    const getPaymentBreakdownAdjustmentForPayments = (customer = {}) => normalizePaymentBreakdownAdjustmentForPayments(
        customer.paymentBreakdownAdjustment
        || customer.breakdownAdjustment
        || customer.firstBillAdjustment
        || null
    );
    const getFirstBillAdjustmentForPayments = (customer = {}) => getPaymentBreakdownAdjustmentForPayments(customer).firstBill;
    const safeBreakdownDate = (value) => parseTimestampValue(value);
    const getBreakdownDateParts = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
        return {
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            day: date.getDate()
        };
    };
    const getBreakdownMonthKeyForPayments = (date) => {
        const parts = getBreakdownDateParts(date);
        if (!parts) return '';
        return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}`;
    };
    const compareBreakdownDateOnlyForPayments = (left, right) => {
        const leftParts = getBreakdownDateParts(left);
        const rightParts = getBreakdownDateParts(right);
        if (!leftParts || !rightParts) {
            const leftTime = left instanceof Date && !Number.isNaN(left.getTime()) ? left.getTime() : 0;
            const rightTime = right instanceof Date && !Number.isNaN(right.getTime()) ? right.getTime() : 0;
            return leftTime - rightTime;
        }
        if (leftParts.year !== rightParts.year) return leftParts.year - rightParts.year;
        if (leftParts.month !== rightParts.month) return leftParts.month - rightParts.month;
        return leftParts.day - rightParts.day;
    };
    const isBeforeBreakdownDateForPayments = (left, right) => compareBreakdownDateOnlyForPayments(left, right) < 0;
    const isOnOrBeforeBreakdownDateForPayments = (left, right) => compareBreakdownDateOnlyForPayments(left, right) <= 0;
    const isBeforeBreakdownMonthForPayments = (left, right) => {
        const leftParts = getBreakdownDateParts(left);
        const rightParts = getBreakdownDateParts(right);
        if (!leftParts || !rightParts) return isBeforeBreakdownDateForPayments(left, right);
        if (leftParts.year !== rightParts.year) return leftParts.year < rightParts.year;
        return leftParts.month < rightParts.month;
    };
    const getTodayBreakdownDateForPayments = () => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    };
    const buildBreakdownMonthlyDate = (year, month, billingDay) => {
        const parsedYear = Number(year);
        const parsedMonth = Number(month);
        if (!Number.isFinite(parsedYear) || !Number.isFinite(parsedMonth)) return null;
        const monthIndex = Math.min(Math.max(parsedMonth, 1), 12) - 1;
        const lastDay = new Date(parsedYear, monthIndex + 1, 0).getDate();
        return new Date(
            parsedYear,
            monthIndex,
            Math.min(Math.max(Number(billingDay) || 1, 1), lastDay)
        );
    };
    const getNextBreakdownMonthParts = (year, month) => (
        month >= 12
            ? { year: year + 1, month: 1 }
            : { year, month: month + 1 }
    );
    const getMinBreakdownDate = (dates = []) => {
        const validDates = dates.filter((date) => date instanceof Date && !Number.isNaN(date.getTime()));
        if (!validDates.length) return null;
        return validDates.reduce((earliest, date) => date < earliest ? date : earliest, validDates[0]);
    };
    const getMaxBreakdownDate = (dates = []) => {
        const validDates = dates.filter((date) => date instanceof Date && !Number.isNaN(date.getTime()));
        if (!validDates.length) return null;
        return validDates.reduce((latest, date) => date > latest ? date : latest, validDates[0]);
    };
    const resolveFirstMonthProrationForPayments = (customer = {}, billDate = null, fullPlanAmount = 0) => {
        const activationDate = safeBreakdownDate(customer.activationDate || customer.activation_date);
        const planAmount = Number(fullPlanAmount) || 0;
        if (isExistingCustomerStart(customer) && activationDate && billDate && isSameMonth(activationDate, billDate)) {
            return {
                amount: 0,
                isProrated: false,
                periodStart: null,
                periodEnd: null
            };
        }
        if (!activationDate || !billDate || planAmount <= 0 || !isSameMonth(activationDate, billDate)) {
            return {
                amount: roundMoney(planAmount),
                isProrated: false,
                periodStart: null,
                periodEnd: null
            };
        }
        const periodEnd = getMonthEndDate(activationDate);
        const periodStart = activationDate;
        const monthStart = new Date(activationDate.getFullYear(), activationDate.getMonth(), 1);
        const activeDays = getInclusiveDayCount(periodStart, periodEnd);
        const totalDays = getInclusiveDayCount(monthStart, periodEnd);
        if (!activeDays || !totalDays || activeDays >= totalDays) {
            return {
                amount: roundMoney(planAmount),
                isProrated: false,
                periodStart: null,
                periodEnd: null
            };
        }
        return {
            amount: roundWholePeso((planAmount / totalDays) * activeDays),
            isProrated: true,
            periodStart,
            periodEnd
        };
    };
    const resolveBreakdownPlanAmountForPayments = (customer = {}, overrideAmount = null) => {
        const matchedPlan = customer.planName ? planByName.get(normalizePlanName(customer.planName)) : null;
        const candidates = [
            overrideAmount,
            matchedPlan?.price,
            customer.planAmount,
            customer.planPrice,
            customer.monthlyFee,
            customer.price,
            customer.amount
        ];
        for (const candidate of candidates) {
            const parsed = Number(candidate);
            if (Number.isFinite(parsed) && parsed > 0) return roundMoney(parsed);
        }
        return 0;
    };
    const normalizeBreakdownPlanType = (value) => {
        const normalized = normalizeBreakdownText(value);
        if (normalized.includes('prepaid')) return 'prepaid';
        if (normalized.includes('postpaid')) return 'postpaid';
        return '';
    };
    const resolveSourcePlanTypeForPayments = (customer = {}) => {
        const directType = [
            customer.sourceType,
            customer.source_type,
            customer.customerType,
            customer.customer_type,
            customer.accountType,
            customer.account_type,
            customer.subscriberType,
            customer.subscriber_type
        ].map(normalizeBreakdownPlanType).find(Boolean);
        if (directType) return directType;

        const remarks = String(customer.remarks || customer.notes || '').trim();
        const sourceMatch = remarks.match(/\bsource\s+type\s*:\s*(prepaid|postpaid)\b/i);
        return sourceMatch?.[1] ? normalizeBreakdownPlanType(sourceMatch[1]) : '';
    };
    const resolveBreakdownPlanTypeForPayments = (customer = {}) => {
        const sourceType = resolveSourcePlanTypeForPayments(customer);
        if (sourceType) return sourceType;

        const explicit = normalizeBreakdownPlanType(customer.planCategory || customer.planType || customer.type);
        if (explicit) return explicit;

        const billing = normalizeBreakdownText(customer.planBilling || customer.billingCycle || customer.billing);
        if (billing.includes('prepaid')) return 'prepaid';
        if (billing.includes('postpaid')) return 'postpaid';

        const planName = normalizeBreakdownText(customer.planName || customer.plan);
        if (planName.includes('prepaid')) return 'prepaid';
        return resolvePlanCategory(customer);
    };
    const getDisconnectionStateForPayments = (customer = {}) => {
        const raw = customer?.disconnection || null;
        if (!raw || typeof raw !== 'object') return null;
        if (normalizeBreakdownText(raw.status) !== 'disconnected') return null;
        const disconnectedAt = safeBreakdownDate(raw.disconnectedAt || raw.decidedAt || raw.updatedAt);
        if (!disconnectedAt) return null;
        const billingPolicy = normalizeBreakdownText(raw.billingPolicy) === 'continue' ? 'continue' : 'stop';
        return { disconnectedAt, billingPolicy };
    };
    const resolveBreakdownDirectionForPayments = (entry = {}) => {
        if (isOpeningPreviousBalanceRawForPayments(entry)) return 'debit';
        const direction = normalizeBreakdownText(entry.direction || entry.nature);
        if (direction === 'debit' || direction === 'credit') return direction;
        const kind = normalizeBreakdownText(entry.kind || entry.type);
        if (kind === 'charge' || kind === 'debit' || kind === 'bill') return 'debit';
        return 'credit';
    };
    const resolveBreakdownKindForPayments = (entry = {}) => {
        const kind = normalizeBreakdownText(entry.kind || entry.type);
        if (kind) return kind;
        return resolveBreakdownDirectionForPayments(entry) === 'debit' ? 'charge' : 'payment';
    };
    const isOpeningPreviousBalanceRawForPayments = (entry = {}) => {
        const reference = normalizeBreakdownText(entry?.reference || entry?.orNumber || entry?.or_number);
        const description = normalizeBreakdownText([
            entry?.description,
            entry?.notes,
            entry?.remarks
        ].filter(Boolean).join(' '));
        return reference.startsWith('obb-')
            || reference.startsWith('opening-bal-')
            || description.includes('previous balance bill')
            || description.includes('opening previous balance');
    };
    const isOpeningAdvanceRawForPayments = (entry = {}) => {
        const reference = normalizeBreakdownText(entry?.reference || entry?.orNumber || entry?.or_number);
        const description = normalizeBreakdownText([
            entry?.description,
            entry?.notes,
            entry?.remarks
        ].filter(Boolean).join(' '));
        return reference.startsWith('oba-')
            || reference.startsWith('opening-adv-')
            || description.includes('opening advance payment');
    };
    const isPrepaidAutoChargeRawForPayments = (entry = {}) => {
        const description = normalizeBreakdownText([
            entry?.description,
            entry?.notes,
            entry?.remarks
        ].filter(Boolean).join(' '));
        return description.includes('prepaid renewal charge');
    };
    const normalizeBreakdownEntryForPayments = (entry, index) => {
        const amount = toBreakdownAmount(entry?.amount);
        if (!amount) return null;
        const openingPreviousBalance = isOpeningPreviousBalanceRawForPayments(entry);
        const direction = openingPreviousBalance ? 'debit' : resolveBreakdownDirectionForPayments(entry);
        const kind = openingPreviousBalance ? 'bill' : resolveBreakdownKindForPayments(entry);
        const dateObj = safeBreakdownDate(direction === 'debit'
            ? (entry?.date || entry?.recordedAt || entry?.recorded_at || entry?.createdAt || entry?.created_at)
            : (entry?.recordedAt || entry?.recorded_at || entry?.date || entry?.createdAt || entry?.created_at));
        return {
            raw: entry || {},
            index,
            id: String(entry?.id || entry?.entryId || entry?.fingerprint || index),
            amount,
            direction,
            kind,
            dateObj,
            time: dateObj ? dateObj.getTime() : index,
            isOpeningPreviousBalance: openingPreviousBalance,
            isOpeningAdvance: isOpeningAdvanceRawForPayments(entry),
            isPrepaidAutoCharge: isPrepaidAutoChargeRawForPayments(entry)
        };
    };
    const compareBreakdownEntriesForPayments = (left, right) => {
        if (left.time !== right.time) return left.time - right.time;
        if (left.direction !== right.direction) return left.direction === 'debit' ? -1 : 1;
        return left.index - right.index;
    };
    const getBreakdownEntryDateKeyForPayments = (entry = {}) => (
        entry?.dateObj instanceof Date && !Number.isNaN(entry.dateObj.getTime())
            ? formatDateISO(entry.dateObj)
            : ''
    );
    const isOpeningPreviousBalanceEntryForPayments = (entry = {}) => Boolean(
        entry?.isOpeningPreviousBalance || isOpeningPreviousBalanceRawForPayments(entry?.raw || entry)
    );
    const isOpeningAdvanceEntryForPayments = (entry = {}) => Boolean(
        entry?.isOpeningAdvance || isOpeningAdvanceRawForPayments(entry?.raw || entry)
    );
    const isPrepaidAutoChargeEntryForPayments = (entry = {}) => Boolean(
        entry?.isPrepaidAutoCharge || isPrepaidAutoChargeRawForPayments(entry?.raw || entry)
    );
    const findIgnoredOpeningAutoChargeOrdersForPayments = (customer = {}, entries = []) => {
        if (resolveBreakdownPlanTypeForPayments(customer) === 'prepaid') {
            return new Set(entries
                .filter((entry) => entry.direction === 'debit' && isPrepaidAutoChargeEntryForPayments(entry))
                .map((entry) => entry.sortOrder));
        }

        const openingAdjustments = entries.filter((entry) => (
            (
                entry.direction === 'debit'
                && isOpeningPreviousBalanceEntryForPayments(entry)
            )
            || (
                entry.direction === 'credit'
                && isOpeningAdvanceEntryForPayments(entry)
            )
        ));
        if (!openingAdjustments.length) return new Set();

        const ignored = new Set();
        entries.forEach((entry) => {
            if (entry.direction !== 'debit' || !isPrepaidAutoChargeEntryForPayments(entry)) return;
            const entryDateKey = getBreakdownEntryDateKeyForPayments(entry);
            const matchedOpeningAdjustment = openingAdjustments.some((opening) => {
                const amountMatches = Math.abs((Number(opening.amount) || 0) - (Number(entry.amount) || 0)) <= EPSILON;
                const dateMatches = entryDateKey && entryDateKey === getBreakdownEntryDateKeyForPayments(opening);
                const timeDiff = Math.abs((Number(entry.time) || 0) - (Number(opening.time) || 0));
                return amountMatches && dateMatches && timeDiff <= 30000;
            });
            if (matchedOpeningAdjustment) ignored.add(entry.sortOrder);
        });

        return ignored;
    };
    const getBreakdownCustomerNameForPayments = (customer = {}, fallbackAccount = '') => {
        const firstName = String(customer.firstName || '').trim();
        const lastName = String(customer.lastName || '').trim();
        const fullFromParts = [firstName, lastName].filter(Boolean).join(' ').trim();
        const fallbackName = String(customer.name || customer.fullName || '').trim();
        const account = String(fallbackAccount || customer.accountNumber || '').trim();
        return fullFromParts || fallbackName || (account ? `Account ${account}` : 'Customer');
    };
    const getBreakdownReferralValuesForPayments = (customer = {}) => {
        const values = [];
        [
            'referredBy',
            'referred_by',
            'referredByName',
            'referred_by_name',
            'referredByAccount',
            'referredByAccountNumber',
            'referred_by_account',
            'referred_by_account_number',
            'referrer',
            'referrerName',
            'referrerAccount',
            'referrerAccountNumber',
            'referralAccount',
            'referralAccountNumber',
            'referralSource'
        ].forEach((field) => {
            const value = customer?.[field];
            if (value || value === 0) values.push(String(value));
        });

        const remarks = String(customer.remarks || customer.notes || '').trim();
        if (remarks) {
            const patterns = [
                /referred\s+by\s*:\s*([^;\n]+)/gi,
                /referrer\s*:\s*([^;\n]+)/gi,
                /referral\s*:\s*([^;\n]+)/gi
            ];
            patterns.forEach((pattern) => {
                let match;
                while ((match = pattern.exec(remarks)) !== null) {
                    if (match[1]) values.push(match[1]);
                }
            });
        }

        return values.map((value) => String(value || '').trim()).filter(Boolean);
    };
    const getBreakdownIdentityValuesForPayments = (customer = {}) => {
        const firstName = String(customer.firstName || '').trim();
        const lastName = String(customer.lastName || '').trim();
        const fullName = getBreakdownCustomerNameForPayments(customer, customer.accountNumber);
        return [
            customer.accountNumber,
            customer.id,
            customer.loginUsername,
            customer.pppoeUsername,
            customer.name,
            customer.fullName,
            fullName,
            firstName && lastName ? `${firstName} ${lastName}` : '',
            firstName && lastName ? `${lastName}, ${firstName}` : '',
            firstName && lastName ? `${lastName} ${firstName}` : ''
        ].map((value) => String(value || '').trim()).filter(Boolean);
    };
    const matchesBreakdownReferralValueForPayments = (referralValue, targetIdentitySet) => {
        const referralKey = normalizeBreakdownIdentity(referralValue);
        if (!referralKey) return false;
        if (targetIdentitySet.has(referralKey)) return true;
        return Array.from(targetIdentitySet).some((identity) => (
            identity.length >= 5
            && (referralKey.includes(identity) || identity.includes(referralKey))
        ));
    };
    const findReferredCustomersForPayments = (customer = {}, customers = []) => {
        const targetAccount = normalizeAccountNumber(customer.accountNumber || '');
        const targetIdentitySet = new Set(
            getBreakdownIdentityValuesForPayments(customer)
                .map(normalizeBreakdownIdentity)
                .filter(Boolean)
        );

        return (Array.isArray(customers) ? customers : []).filter((candidate) => {
            const currentAccount = normalizeAccountNumber(candidate?.accountNumber || '');
            if (targetAccount && currentAccount === targetAccount) return false;
            return getBreakdownReferralValuesForPayments(candidate).some((value) => (
                matchesBreakdownReferralValueForPayments(value, targetIdentitySet)
            ));
        });
    };
    const isReferralCreditForPayments = (entry = {}) => {
        if (entry.direction !== 'credit') return false;
        const text = normalizeBreakdownText([
            entry.kind,
            entry.raw?.kind,
            entry.raw?.type,
            entry.raw?.description,
            entry.raw?.notes,
            entry.raw?.remarks,
            entry.raw?.reference,
            entry.raw?.orNumber
        ].filter(Boolean).join(' '));
        return /\b(referral|referred|referrer)\b/.test(text);
    };
    const isImportedPaymentCreditForPayments = (entry = {}) => {
        if (entry.direction !== 'credit') return false;
        const kind = normalizeBreakdownText(entry.kind || entry.raw?.kind || entry.raw?.type);
        if (kind && kind !== 'payment' && kind !== 'credit') return false;
        const reference = String(entry.raw?.reference || entry.raw?.orNumber || '').trim();
        const text = normalizeBreakdownText([
            entry.raw?.importedFrom,
            entry.raw?.imported_from,
            entry.raw?.description,
            entry.raw?.notes,
            entry.raw?.remarks,
            entry.raw?.paymentMethod,
            entry.raw?.payment_method
        ].filter(Boolean).join(' '));
        return /^CF2026-/i.test(reference)
            || /\bimported\s+(?:cash|gcash|gash)?\s*payment\b/.test(text)
            || /\b(?:cash|gcash|gash)\s+[a-z]+\s*\d{4}\b/.test(text)
            || /\bpayment-history-excel-import\b/.test(text);
    };
    const isPaymentCreditForPayments = (entry = {}) => {
        if (entry.direction !== 'credit') return false;
        if (isOpeningAdvanceEntryForPayments(entry)) return false;
        const kind = normalizeBreakdownText(entry.kind || entry.raw?.kind || entry.raw?.type);
        return !kind || kind === 'payment' || kind === 'credit';
    };
    const shouldAttachCreditToBillMonthForPayments = (entry = {}, billDate = null, customer = {}) => {
        if (!isPaymentCreditForPayments(entry) || !entry.dateObj || !billDate) return false;
        if (!isSameMonth(entry.dateObj, billDate)) return false;
        if (isImportedPaymentCreditForPayments(entry)) return true;
        return resolveBreakdownPlanTypeForPayments(customer) === 'postpaid';
    };
    const sumBreakdownEntriesForPayments = (entries = []) => roundMoney(
        entries.reduce((sum, entry) => sum + (Number(entry?.amount) || 0), 0)
    );
    const splitBreakdownCarryOverForPayments = (balanceAfterPayment) => {
        const signedBalance = roundMoney(Number(balanceAfterPayment) || 0);
        if (signedBalance > EPSILON) {
            return {
                signedBalance,
                previousBalance: signedBalance,
                advance: 0,
                type: 'balance'
            };
        }
        if (signedBalance < -EPSILON) {
            return {
                signedBalance,
                previousBalance: 0,
                advance: roundMoney(Math.abs(signedBalance)),
                type: 'advance'
            };
        }
        return {
            signedBalance: 0,
            previousBalance: 0,
            advance: 0,
            type: 'settled'
        };
    };
    const applyBreakdownEntryToBalanceForPayments = (balance, entry = {}) => {
        const amount = Number(entry.amount) || 0;
        if (entry.direction === 'debit') return roundMoney(balance + amount);
        if (entry.direction === 'credit') return roundMoney(balance - amount);
        return roundMoney(balance);
    };
    const createBreakdownReferralContextForPayments = (customer, entries, customers) => {
        const breakdownAdjustment = getPaymentBreakdownAdjustmentForPayments(customer);
        const planAmount = getPlanAmountForCustomer(customer);
        const explicitReferralTotal = sumBreakdownEntriesForPayments(entries.filter(isReferralCreditForPayments));
        const referralDiscounts = explicitReferralTotal > EPSILON
            ? []
            : getAutomaticReferralDiscountsForPayments(customer);
        const automaticReferralTotal = explicitReferralTotal > EPSILON
            ? 0
            : roundMoney(referralDiscounts.length * (planAmount / 2));

        return {
            planAmount,
            referredCustomers: referralDiscounts,
            referralDiscounts,
            explicitReferralTotal,
            automaticReferralTotal,
            automaticReferralRemaining: automaticReferralTotal,
            automaticReferralApplied: 0,
            usedReferralDiscountIds: new Set(),
            usedSyntheticBills: false,
            firstBillAdjustment: breakdownAdjustment.firstBill,
            monthlyReferralAdjustments: breakdownAdjustment.monthlyReferrals,
            planChanges: breakdownAdjustment.planChanges
        };
    };
    const getMonthlyReferralAdjustmentForPayments = (context = {}, billDate = null, isFirstRow = false) => {
        if (isFirstRow || !billDate) return null;
        const monthKey = getBreakdownMonthKeyForPayments(billDate);
        if (!monthKey) return null;
        const adjustment = context?.monthlyReferralAdjustments?.[monthKey] || null;
        return adjustment && typeof adjustment === 'object' ? adjustment : null;
    };
    const resolvePlanChangeForBreakdownMonth = (context = {}, billDate = null) => {
        const monthKey = getBreakdownMonthKeyForPayments(billDate);
        if (!monthKey) return null;
        const changes = Array.isArray(context?.planChanges) ? context.planChanges : [];
        let selected = null;
        changes.forEach((change) => {
            if (!change?.effectiveMonth || change.effectiveMonth > monthKey) return;
            selected = change;
        });
        return selected;
    };
    const normalizeReferralDiscountItemForPayments = (item = {}, index = 0) => {
        const successAt = safeBreakdownDate(
            item.successAt
            || item.success_at
            || item.paidAt
            || item.paymentDate
            || item.date
        );
        if (!successAt) return null;
        const id = String(
            item.id
            || item.referralId
            || item.referral_id
            || item.referredAccountNumber
            || item.referred_account_number
            || item.referredName
            || `referral-${index}`
        ).trim();
        return {
            id: id || `referral-${index}`,
            referredAccountNumber: String(item.referredAccountNumber || item.referred_account_number || '').trim(),
            referredName: String(item.referredName || item.referred_name || item.name || 'Referral').trim(),
            eligibleMonth: String(item.eligibleMonth || item.eligible_month || '').trim(),
            successAt
        };
    };
    const getAutomaticReferralDiscountsForPayments = (customer = {}) => {
        const seen = new Set();
        return (Array.isArray(customer.referralDiscounts) ? customer.referralDiscounts : [])
            .map(normalizeReferralDiscountItemForPayments)
            .filter(Boolean)
            .filter((item) => {
                if (seen.has(item.id)) return false;
                seen.add(item.id);
                return true;
            })
            .sort((left, right) => {
                const dateDiff = compareBreakdownDateOnlyForPayments(left.successAt, right.successAt);
                if (dateDiff) return dateDiff;
                return left.referredName.localeCompare(right.referredName);
            });
    };
    const takeAutomaticReferralForPayments = (context, dueBeforeReferral, billDate, planAmount) => {
        const discounts = Array.isArray(context?.referralDiscounts) ? context.referralDiscounts : [];
        const unitAmount = roundMoney((Number(planAmount) || 0) / 2);
        const monthlyPlanCap = Math.max(0, Number(planAmount) || 0);
        let remaining = roundMoney(Math.min(Math.max(0, Number(dueBeforeReferral) || 0), monthlyPlanCap));
        if (!discounts.length || unitAmount <= EPSILON || remaining <= EPSILON || !billDate) {
            return { amount: 0, items: [] };
        }

        const usedIds = context.usedReferralDiscountIds || new Set();
        context.usedReferralDiscountIds = usedIds;
        const items = [];
        let amount = 0;
        let usedThisBill = 0;

        discounts.forEach((item) => {
            if (usedThisBill >= 2 || remaining <= EPSILON) return;
            if (!item?.id || usedIds.has(item.id)) return;
            if (!item.successAt || compareBreakdownDateOnlyForPayments(item.successAt, billDate) > 0) return;

            const applied = roundMoney(Math.min(unitAmount, remaining));
            if (applied <= EPSILON) return;
            usedIds.add(item.id);
            usedThisBill += 1;
            amount = roundMoney(amount + applied);
            remaining = roundMoney(remaining - applied);
            context.automaticReferralApplied = roundMoney((Number(context.automaticReferralApplied) || 0) + applied);
            context.automaticReferralRemaining = roundMoney(Math.max(0, (Number(context.automaticReferralRemaining) || 0) - applied));
            items.push({
                id: item.id,
                referredAccountNumber: item.referredAccountNumber,
                referredName: item.referredName,
                eligibleMonth: item.eligibleMonth,
                successAt: item.successAt,
                amount: applied
            });
        });

        return { amount, items };
    };
    const buildManualReferralDetailsForPayments = (adjustment = {}, amount = 0, fallbackId = 'manual-referral') => {
        const applied = roundMoney(Math.max(0, Number(amount) || 0));
        if (applied <= EPSILON) return [];
        const referredName = toBreakdownAdjustmentText(adjustment.referralName) || 'Manual referral';
        return [{
            id: fallbackId,
            referredAccountNumber: toBreakdownAdjustmentText(adjustment.referralAccountNumber),
            referredName,
            amount: applied,
            manual: true
        }];
    };
    const createBreakdownRowForPayments = ({
        customer,
        billDate,
        planAmount,
        credits,
        runningBalance,
        context,
        sourceType,
        proration = null,
        previousBalanceOverride = null,
        advanceOverride = null,
        openingPreviousBalance = false,
        openingAdvance = false,
        isFirstRow = false,
        planOverride = null
    }) => {
        const firstBillAdjustment = isFirstRow ? normalizeFirstBillAdjustmentForPayments(context?.firstBillAdjustment) : null;
        const monthlyReferralAdjustment = getMonthlyReferralAdjustmentForPayments(context, billDate, isFirstRow);
        const referralAdjustment = firstBillAdjustment && hasBreakdownAmountOverride(firstBillAdjustment.referral)
            ? firstBillAdjustment
            : monthlyReferralAdjustment;
        const effectivePreviousBalanceOverride = firstBillAdjustment
            ? firstBillAdjustment.previousBalance
            : previousBalanceOverride;
        const effectiveAdvanceOverride = firstBillAdjustment
            ? firstBillAdjustment.advance
            : advanceOverride;
        const hasPreviousBalanceOverride = hasBreakdownAmountOverride(effectivePreviousBalanceOverride);
        const hasAdvanceOverride = hasBreakdownAmountOverride(effectiveAdvanceOverride);
        const carryOver = splitBreakdownCarryOverForPayments(runningBalance);
        const previousBalance = hasPreviousBalanceOverride
            ? roundMoney(Math.max(0, Number(effectivePreviousBalanceOverride) || 0))
            : carryOver.previousBalance;
        const advance = hasAdvanceOverride
            ? roundMoney(Math.max(0, Number(effectiveAdvanceOverride) || 0))
            : carryOver.advance;
        const referralCredits = (Array.isArray(credits) ? credits : []).filter(isReferralCreditForPayments);
        const paymentCredits = (Array.isArray(credits) ? credits : []).filter((entry) => !isReferralCreditForPayments(entry));
        const explicitReferral = sumBreakdownEntriesForPayments(referralCredits);
        const dueBeforeAutoReferral = roundMoney(planAmount - advance + previousBalance - explicitReferral);
        const hasReferralOverride = Boolean(referralAdjustment && hasBreakdownAmountOverride(referralAdjustment.referral));
        const referralOverride = hasReferralOverride
            ? roundMoney(Math.max(0, Number(referralAdjustment.referral) || 0))
            : 0;
        const automaticReferral = explicitReferral > EPSILON
            ? { amount: 0, items: [] }
            : takeAutomaticReferralForPayments(
                context,
                hasReferralOverride ? referralOverride : dueBeforeAutoReferral,
                billDate,
                planAmount
            );
        const referral = hasReferralOverride
            ? referralOverride
            : roundMoney(explicitReferral + automaticReferral.amount);
        const referralDetails = hasReferralOverride
            ? buildManualReferralDetailsForPayments(referralAdjustment, referral, firstBillAdjustment ? 'manual-first-bill-referral' : `manual-referral-${getBreakdownMonthKeyForPayments(billDate)}`)
            : automaticReferral.items;
        const computedRawDue = roundMoney(planAmount - advance + previousBalance - referral);
        const hasDueOverride = Boolean(firstBillAdjustment && hasBreakdownAmountOverride(firstBillAdjustment.due));
        const rawDue = hasDueOverride
            ? roundMoney(Math.max(0, Number(firstBillAdjustment.due) || 0))
            : computedRawDue;
        const due = roundMoney(Math.max(0, rawDue));
        const amountPaid = sumBreakdownEntriesForPayments(paymentCredits);
        const balanceAfterPayment = roundMoney(rawDue - amountPaid);
        const nextCarryOver = splitBreakdownCarryOverForPayments(balanceAfterPayment);

        return {
            row: {
                billDate,
                planAmount,
                previousBalance,
                advance,
                referral,
                referralDetails,
                due,
                isReferralOverride: hasReferralOverride,
                isMonthlyReferralOverride: Boolean(monthlyReferralAdjustment && hasReferralOverride),
                isDueOverride: hasDueOverride,
                amountPaid,
                paymentStatus: balanceAfterPayment <= EPSILON ? 'paid' : 'unpaid',
                balanceAfterPayment,
                sourceType,
                planType: normalizeBreakdownPlanType(planOverride?.planCategory) || resolveBreakdownPlanTypeForPayments(customer),
                isFirstRow,
                isAdjustmentEditable: isFirstRow,
                isProrated: Boolean(proration?.isProrated),
                periodStart: proration?.periodStart || null,
                periodEnd: proration?.periodEnd || null,
                openingPreviousBalance,
                openingAdvance,
                nextPreviousBalance: nextCarryOver.previousBalance,
                nextAdvance: nextCarryOver.advance,
                nextCarryOverType: nextCarryOver.type
            },
            nextBalance: nextCarryOver.signedBalance
        };
    };
    const resolveBreakdownBillingDayForPayments = (customer = {}, fallbackDate = null) => {
        if (resolveBreakdownPlanTypeForPayments(customer) === 'prepaid') return 1;
        if (hasMonthEndBillingCycle(customer)) return 31;
        const candidates = [
            safeBreakdownDate(customer.billDate),
            safeBreakdownDate(customer.dueDate),
            safeBreakdownDate(customer.activationDate),
            fallbackDate
        ];
        for (const date of candidates) {
            const parts = getBreakdownDateParts(date);
            if (parts?.day) return parts.day;
        }
        return 1;
    };
    const buildBreakdownRowsFromPostedDebitsForPayments = (customer, entries, context) => {
        const rows = [];
        const ignoredAutoChargeOrders = findIgnoredOpeningAutoChargeOrdersForPayments(customer, entries);
        const effectiveEntries = entries.filter((entry) => !ignoredAutoChargeOrders.has(entry.sortOrder));
        const debitEntries = effectiveEntries.filter((entry) => entry.direction === 'debit');
        if (!debitEntries.length) return rows;
        const assignedCreditOrders = new Set();

        let runningBalance = 0;
        effectiveEntries
            .filter((entry) => {
                if (entry.sortOrder >= debitEntries[0].sortOrder) return false;
                if (
                    shouldAttachCreditToBillMonthForPayments(entry, debitEntries[0].dateObj, customer)
                ) {
                    return false;
                }
                return true;
            })
            .forEach((entry) => {
                runningBalance = applyBreakdownEntryToBalanceForPayments(runningBalance, entry);
            });

        debitEntries.forEach((debit, index) => {
            const nextDebit = debitEntries[index + 1] || null;
            const cycleCredits = effectiveEntries.filter((entry) => {
                if (entry.direction !== 'credit' || assignedCreditOrders.has(entry.sortOrder)) return false;
                const attachesToCurrentBillMonth = shouldAttachCreditToBillMonthForPayments(entry, debit.dateObj, customer);
                const attachesToNextBillMonth = nextDebit
                    ? shouldAttachCreditToBillMonthForPayments(entry, nextDebit.dateObj, customer)
                    : false;
                return attachesToCurrentBillMonth
                    || (
                        !attachesToNextBillMonth
                        && entry.sortOrder > debit.sortOrder
                        && (!nextDebit || entry.sortOrder < nextDebit.sortOrder)
                    );
            });
            cycleCredits.forEach((entry) => assignedCreditOrders.add(entry.sortOrder));
            const openingPreviousBalance = isOpeningPreviousBalanceEntryForPayments(debit);
            const planAmount = openingPreviousBalance ? 0 : resolveBreakdownPlanAmountForPayments(customer, debit.amount || context.planAmount);
            const result = createBreakdownRowForPayments({
                customer,
                billDate: debit.dateObj,
                planAmount,
                credits: cycleCredits,
                runningBalance,
                context,
                sourceType: openingPreviousBalance ? 'opening' : 'posted',
                previousBalanceOverride: openingPreviousBalance ? debit.amount : null,
                openingPreviousBalance,
                isFirstRow: index === 0
            });
            rows.push(result.row);
            runningBalance = result.nextBalance;
        });

        return rows;
    };
    const buildBreakdownRowsFromOpeningAdvanceOnlyForPayments = (customer, entries, context) => {
        if (!isExistingCustomerStart(customer)) return [];
        const openingAdvanceEntries = (Array.isArray(entries) ? entries : []).filter((entry) => (
            entry.direction === 'credit'
            && isOpeningAdvanceEntryForPayments(entry)
        ));
        if (!openingAdvanceEntries.length) return [];

        const totalAdvance = sumBreakdownEntriesForPayments(openingAdvanceEntries);
        if (totalAdvance <= EPSILON) return [];

        const billDate = getMaxBreakdownDate(openingAdvanceEntries.map((entry) => entry.dateObj))
            || safeBreakdownDate(customer.activationDate)
            || safeBreakdownDate(customer.billDate)
            || safeBreakdownDate(customer.dueDate)
            || new Date();
        const result = createBreakdownRowForPayments({
            customer,
            billDate,
            planAmount: 0,
            credits: [],
            runningBalance: 0,
            context,
            sourceType: 'opening',
            advanceOverride: totalAdvance,
            openingAdvance: true,
            isFirstRow: true
        });
        return [result.row];
    };
    const buildBreakdownRowsFromMonthlyPlanForPayments = (customer, entries, context) => {
        const planAmount = context.planAmount;
        const entryDates = entries.map((entry) => entry.dateObj).filter(Boolean);
        const firstEntryDate = getMinBreakdownDate(entryDates);
        const lastEntryDate = getMaxBreakdownDate(entryDates);
        const storedBillDate = safeBreakdownDate(customer.billDate);
        const prepaidStartDate = resolveBreakdownPlanTypeForPayments(customer) === 'prepaid'
            ? getMinBreakdownDate([firstEntryDate, storedBillDate].filter(Boolean))
            : null;
        let startSeed = prepaidStartDate
            || firstEntryDate
            || storedBillDate
            || safeBreakdownDate(customer.dueDate)
            || safeBreakdownDate(customer.activationDate)
            || new Date();
        const activationSeed = safeBreakdownDate(customer.activationDate || customer.activation_date);
        if (activationSeed && startSeed && isBeforeBreakdownMonthForPayments(startSeed, activationSeed)) {
            startSeed = activationSeed;
        }
        const endSeed = getMaxBreakdownDate([
            lastEntryDate,
            safeBreakdownDate(customer.dueDate),
            safeBreakdownDate(customer.billDate),
            new Date()
        ]) || startSeed;
        const startParts = getBreakdownDateParts(startSeed) || getBreakdownDateParts(new Date());
        const endParts = getBreakdownDateParts(endSeed) || startParts;
        const billingDay = resolveBreakdownBillingDayForPayments(customer, startSeed);
        const rows = [];
        let currentYear = startParts.year;
        let currentMonth = startParts.month;
        let billDate = buildBreakdownMonthlyDate(currentYear, currentMonth, billingDay);
        let lastBillDate = buildBreakdownMonthlyDate(endParts.year, endParts.month, billingDay);
        const disconnection = getDisconnectionStateForPayments(customer);
        if (disconnection?.billingPolicy === 'stop') {
            const disconnectionParts = getBreakdownDateParts(disconnection.disconnectedAt);
            const disconnectionBillDate = disconnectionParts
                ? buildBreakdownMonthlyDate(disconnectionParts.year, disconnectionParts.month, billingDay)
                : null;
            if (disconnectionBillDate && disconnectionBillDate < lastBillDate) {
                lastBillDate = disconnectionBillDate;
            }
        }
        const todayBreakdownDate = getTodayBreakdownDateForPayments();
        let runningBalance = 0;
        let cursor = 0;

        context.usedSyntheticBills = true;

        while (
            cursor < entries.length
            && entries[cursor].dateObj
            && (
                shouldAttachCreditToBillMonthForPayments(entries[cursor], billDate, customer)
                    ? isBeforeBreakdownMonthForPayments(entries[cursor].dateObj, billDate)
                    : isBeforeBreakdownDateForPayments(entries[cursor].dateObj, billDate)
            )
        ) {
            runningBalance = applyBreakdownEntryToBalanceForPayments(runningBalance, entries[cursor]);
            cursor += 1;
        }

        let guard = 0;
        while (
            billDate
            && lastBillDate
            && billDate <= lastBillDate
            && isOnOrBeforeBreakdownDateForPayments(billDate, todayBreakdownDate)
            && guard < MAX_SYNTHETIC_BREAKDOWN_ROWS
        ) {
            const nextParts = getNextBreakdownMonthParts(currentYear, currentMonth);
            const nextBillDate = buildBreakdownMonthlyDate(nextParts.year, nextParts.month, billingDay);
            const cycleCredits = [];

            while (
                cursor < entries.length
                && (
                    !entries[cursor].dateObj
                    || (
                        shouldAttachCreditToBillMonthForPayments(entries[cursor], billDate, customer)
                            || (
                                !shouldAttachCreditToBillMonthForPayments(entries[cursor], nextBillDate, customer)
                                && isBeforeBreakdownDateForPayments(entries[cursor].dateObj, nextBillDate)
                            )
                    )
                )
            ) {
                const entry = entries[cursor];
                if (entry.direction === 'credit') {
                    cycleCredits.push(entry);
                } else {
                    runningBalance = applyBreakdownEntryToBalanceForPayments(runningBalance, entry);
                }
                cursor += 1;
            }

            const planChange = resolvePlanChangeForBreakdownMonth(context, billDate);
            const effectivePlanAmount = planChange ? planChange.planAmount : planAmount;
            const proration = resolveFirstMonthProrationForPayments(customer, billDate, effectivePlanAmount);
            const result = createBreakdownRowForPayments({
                customer,
                billDate,
                planAmount: proration.amount,
                credits: cycleCredits,
                runningBalance,
                context,
                sourceType: 'monthly',
                proration: proration.isProrated ? proration : null,
                isFirstRow: rows.length === 0,
                planOverride: planChange
            });
            rows.push(result.row);
            runningBalance = result.nextBalance;

            currentYear = nextParts.year;
            currentMonth = nextParts.month;
            billDate = nextBillDate;
            guard += 1;
        }

        return rows;
    };
    const readCanonicalBreakdownForPayments = (customer = {}) => {
        const summary = customer?.billingSummary;
        if (!summary || Number(summary.version) < 2 || summary.available !== true || !Array.isArray(summary.rows)) return null;
        const rawContext = summary.context && typeof summary.context === 'object' ? summary.context : {};
        return {
            rows: summary.rows.map((row) => ({
                ...row,
                billDate: safeBreakdownDate(row?.billDate),
                periodStart: safeBreakdownDate(row?.periodStart),
                periodEnd: safeBreakdownDate(row?.periodEnd),
                planType: row?.planType === 'prepaid' ? 'prepaid' : 'postpaid',
                paymentDetails: Array.isArray(row?.paymentDetails) ? row.paymentDetails : []
            })),
            context: {
                ...rawContext,
                usedReferralDiscountIds: new Set(Array.isArray(rawContext.usedReferralDiscountIds)
                    ? rawContext.usedReferralDiscountIds
                    : [])
            }
        };
    };
    const buildBreakdownRowsForPayments = (customer = {}, customers = []) => {
        const canonicalBreakdown = readCanonicalBreakdownForPayments(customer);
        return canonicalBreakdown || { rows: [], context: { billingUnavailable: true } };
    };
    const getCurrentMonthBreakdownRowForPayments = (customer = {}, cycleDate = new Date()) => {
        const currentCycle = customer?.billingSummary?.currentCycle;
        if (!currentCycle) return null;
        return {
            ...currentCycle,
            billDate: safeBreakdownDate(currentCycle.billDate),
            dueDate: safeBreakdownDate(currentCycle.dueDate),
            periodStart: safeBreakdownDate(currentCycle.periodStart),
            periodEnd: safeBreakdownDate(currentCycle.periodEnd)
        };
    };
    const getPaymentBreakdownEndingRowForPayments = (customer = {}) => {
        const customerPool = Array.isArray(allCustomers) && allCustomers.length
            ? allCustomers
            : (Array.isArray(window.allCustomers) ? window.allCustomers : []);
        const { rows } = buildBreakdownRowsForPayments(customer, customerPool);
        return rows.length ? rows[rows.length - 1] : null;
    };
    const getEntryDate = (entry = {}) => parseDateOnly(entry?.date || entry?.recordedAt || entry?.recorded_at || entry?.createdAt || '');
    const isPrepaidBillChargeEntry = (entry = {}) => {
        if (resolveEntryDirection(entry) !== 'debit') return false;
        if (isOpeningPreviousBalanceEntry(entry)) return false;
        return isMonthlyChargeEntry(entry);
    };
    const hasCurrentMonthBillCharge = (customer = {}, planCategory = 'postpaid', cycleDate = new Date()) => {
        const history = getEffectivePaymentHistory(Array.isArray(customer?.history) ? customer.history : []);
        return history.some((entry) => {
            const entryDate = getEntryDate(entry);
            if (!entryDate || !isSameMonth(entryDate, cycleDate)) return false;
            return planCategory === 'prepaid'
                ? isPrepaidBillChargeEntry(entry)
                : isMonthlyChargeEntry(entry);
        });
    };
    const resolveCurrentBillState = (customer = {}) => {
        if (customer && typeof customer === 'object' && currentBillStateCache.has(customer)) {
            return currentBillStateCache.get(customer);
        }
        const summary = customer?.billingSummary;
        const canonicalBreakdown = readCanonicalBreakdownForPayments(customer);
        if (!summary || Number(summary.version) < 2 || summary.available !== true || !canonicalBreakdown) {
            const unavailableState = {
                amount: Number.NaN,
                payableAmount: 0,
                displayAmount: Number.NaN,
                billClass: 'billing-unavailable',
                planCategory: summary?.planType || resolvePlanCategory(customer),
                planAmount: 0,
                currentBillAmount: Number.NaN,
                currentMonthDue: Number.NaN,
                currentDueDate: null,
                balanceAfterPayment: Number.NaN,
                existingCustomerStart: false,
                hasPostedCurrentBill: false,
                hasCurrentBreakdownRow: false,
                paymentStatus: 'unavailable',
                billingStatus: 'unavailable',
                billingUnavailable: true,
                isProrated: false,
                periodStart: null,
                periodEnd: null,
                skipInitialCharge: false,
                currentBreakdownRow: null
            };
            if (customer && typeof customer === 'object') currentBillStateCache.set(customer, unavailableState);
            return unavailableState;
        }

        const rows = canonicalBreakdown.rows;
        const currentMonthKey = String(summary.currentCycle?.billingMonthKey || '').trim();
        const currentBreakdownRow = rows.find((row) => row?.billingMonthKey === currentMonthKey)
            || rows[rows.length - 1]
            || null;
        const endingBalance = Number(summary.endingBalance);
        const safeEndingBalance = Number.isFinite(endingBalance) ? roundMoney(endingBalance) : 0;
        const currentDueDate = parseDateOnly(summary.dueDate || currentBreakdownRow?.dueDate);
        const billClass = safeEndingBalance > EPSILON
            ? 'has-balance'
            : (safeEndingBalance < -EPSILON ? 'advance-balance' : 'zero-balance');
        const state = {
            amount: safeEndingBalance,
            payableAmount: Math.max(0, safeEndingBalance),
            displayAmount: Math.abs(safeEndingBalance),
            billClass,
            planCategory: summary.planType,
            planAmount: Number(currentBreakdownRow?.planAmount) || 0,
            currentBillAmount: safeEndingBalance,
            currentMonthDue: Number(currentBreakdownRow?.due) || 0,
            currentDueDate,
            balanceAfterPayment: safeEndingBalance,
            existingCustomerStart: Boolean(currentBreakdownRow?.openingPreviousBalance || currentBreakdownRow?.openingAdvance),
            hasPostedCurrentBill: currentBreakdownRow?.sourceType === 'posted' || currentBreakdownRow?.sourceType === 'opening',
            hasCurrentBreakdownRow: Boolean(currentBreakdownRow),
            paymentStatus: currentBreakdownRow?.paymentStatus || summary.billingStatus,
            billingStatus: summary.billingStatus,
            billingUnavailable: false,
            isProrated: Boolean(currentBreakdownRow?.isProrated),
            periodStart: currentBreakdownRow?.periodStart || null,
            periodEnd: currentBreakdownRow?.periodEnd || null,
            skipInitialCharge: false,
            currentBreakdownRow
        };
        if (customer && typeof customer === 'object') currentBillStateCache.set(customer, state);
        return state;
    };
    const getCustomerCycleDay = (customer = {}) => {
        if (usesMonthEndBillingCycle(customer)) return 31;
        const billDate = parseDateOnly(customer?.billDate);
        if (billDate) return billDate.getDate();
        const dueDate = parseDateOnly(customer?.dueDate);
        if (dueDate) return dueDate.getDate();
        return null;
    };
    const matchesCustomerCycleDate = (customer = {}, targetDate = null) => {
        if (!targetDate) return false;
        if (usesMonthEndBillingCycle(customer, targetDate)) {
            return isLastDayOfMonth(targetDate);
        }
        const cycleDay = getCustomerCycleDay(customer);
        return Number.isInteger(cycleDay) && cycleDay === targetDate.getDate();
    };
    const matchesDueCycleFilter = (customer = {}, targetDateKey = '') => {
        if (!targetDateKey) return true;
        const targetDate = parseDateOnly(targetDateKey);
        if (!targetDate) return true;
        const currentBillState = resolveCurrentBillState(customer);
        if (currentBillState.billingUnavailable) return false;
        const balance = currentBillState.amount;
        if (!Number.isFinite(balance) || balance <= 0) return false;
        return Boolean(
            currentBillState.currentDueDate
            && formatDateISO(currentBillState.currentDueDate) === targetDateKey
        );
    };

    function ensureTransactionAmountFieldVisible() {
        if (paymentAmountField) paymentAmountField.style.display = '';
        if (paymentAmountInput) {
            paymentAmountInput.required = true;
            paymentAmountInput.readOnly = false;
        }
    }

    function autofillTransactionAmount(customer) {
        ensureTransactionAmountFieldVisible();
        if (!paymentAmountInput) return;
        const currentBillState = customer ? resolveCurrentBillState(customer) : null;
        const currentBillAmount = currentBillState && !currentBillState.billingUnavailable
            ? currentBillState.payableAmount
            : 0;
        paymentAmountInput.value = customer && currentBillAmount > 0
            ? currentBillAmount.toFixed(2)
            : '';
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

    function setPaymentCustomerLock(customer = null) {
        const lockedCustomer = customer || null;
        const isLocked = Boolean(lockedCustomer);
        const accountNumber = normalizeAccountNumber(lockedCustomer?.accountNumber || '');

        paymentModal?.classList.toggle('payment-modal--customer-locked', isLocked);
        paymentCustomerField?.classList.toggle('payment-customer-field--locked', isLocked);

        if (paymentLockedCustomer) {
            paymentLockedCustomer.hidden = !isLocked;
        }
        if (paymentLockedCustomerAvatar) {
            paymentLockedCustomerAvatar.textContent = isLocked ? getCustomerInitials(lockedCustomer) : '--';
        }
        if (paymentLockedCustomerName) {
            paymentLockedCustomerName.textContent = isLocked ? formatCustomerName(lockedCustomer) : 'Selected subscriber';
        }
        if (paymentLockedCustomerMeta) {
            paymentLockedCustomerMeta.textContent = isLocked
                ? getLockedCustomerMeta(lockedCustomer)
                : 'Payment will be saved to this subscriber.';
        }
        if (paymentLockedAccountInput) {
            paymentLockedAccountInput.value = isLocked ? accountNumber : '';
            paymentLockedAccountInput.disabled = !isLocked;
        }
        if (customerSelect) {
            customerSelect.hidden = isLocked;
            customerSelect.disabled = isLocked;
            customerSelect.required = !isLocked;
            customerSelect.setAttribute('aria-hidden', isLocked ? 'true' : 'false');
        }
    }

    function openModal(options = {}) {
        paymentForm.reset();
        document.getElementById('paymentDate').valueAsDate = new Date();
        selectedCustomer = null;
        setPaymentCustomerLock(null);
        ensureTransactionAmountFieldVisible();
        syncPaymentMethodVisibility();
        // no payer input anymore; server will set payer from req.user
        lastFocusedElement = document.activeElement;
        paymentModalIgnoreCloseUntil = Date.now() + 500;
        paymentModal.classList.add('show');
        paymentModal.setAttribute('aria-hidden', 'false');
        syncModalScrollLock();
        updateRecorderHint();
        if (options.focusCustomer !== false) {
            customerSelect.focus();
        }
    }

    function openPaymentModalForAccount(accountNumber, options = {}) {
        const targetAccount = normalizeAccountNumber(accountNumber);
        if (!targetAccount) return false;

        const customer = findCustomerByAccount(allCustomers, targetAccount)
            || findCustomerByAccount(window.allCustomers, targetAccount);
        if (!customer) return false;
        if (!findCustomerByAccount(allCustomers, targetAccount)) {
            allCustomers.push(customer);
        }
        const hasCustomerOption = Array.from(customerSelect.options || [])
            .some((option) => normalizeAccountNumber(option.value) === targetAccount);
        if (!hasCustomerOption) {
            customerSelect.add(new Option(`${formatCustomerName(customer)} (${targetAccount})`, targetAccount));
        }

        const shouldLockCustomer = Boolean(options.lockCustomer);
        openModal({ focusCustomer: !shouldLockCustomer });

        // Pre-select customer and trigger the existing auto-fill logic.
        customerSelect.value = targetAccount;
        customerSelect.dispatchEvent(new Event('change'));
        if (shouldLockCustomer) {
            setPaymentCustomerLock(customer);
            paymentAmountInput?.focus();
        }

        return true;
    }

    const setPaymentBreakdownNotice = (message = '', type = 'info') => {
        if (!paymentBreakdownModalNotice) return;
        const text = String(message || '').trim();
        paymentBreakdownModalNotice.textContent = text;
        paymentBreakdownModalNotice.dataset.type = type;
        paymentBreakdownModalNotice.hidden = !text;
    };

    const setPaymentBreakdownSummaryValue = (element, value = '-') => {
        if (!element) return;
        const text = String(value ?? '').trim();
        element.textContent = text || '-';
    };

    const setPaymentBreakdownPaymentLayer = (active) => {
        const isActive = Boolean(active);
        paymentModal?.classList.toggle('payment-modal--over-breakdown', isActive);
        paymentBreakdownModal?.classList.toggle('payment-breakdown-modal--behind-payment', isActive);
        if (paymentBreakdownModal) {
            paymentBreakdownModal.inert = isActive;
            const isVisible = paymentBreakdownModal.classList.contains('show');
            paymentBreakdownModal.setAttribute('aria-hidden', isActive || !isVisible ? 'true' : 'false');
        }
    };

    const resetPaymentBreakdownModal = (accountNumber, customer = null) => {
        const targetAccount = normalizeAccountNumber(accountNumber);
        const displayName = customer ? formatCustomerName(customer) : 'Subscriber';
        if (paymentBreakdownModalSubtitle) {
            paymentBreakdownModalSubtitle.textContent = [
                displayName,
                targetAccount ? `Account ${targetAccount}` : ''
            ].filter(Boolean).join(' • ');
        }
        if (paymentBreakdownModalFullPage) {
            paymentBreakdownModalFullPage.href = buildPaymentBreakdownUrl(targetAccount);
        }
        setPaymentBreakdownSummaryValue(paymentBreakdownModalAccount, targetAccount);
        setPaymentBreakdownSummaryValue(paymentBreakdownModalPlan);
        setPaymentBreakdownSummaryValue(paymentBreakdownModalStatus, 'Loading');
        setPaymentBreakdownSummaryValue(paymentBreakdownModalBalance);
        if (paymentBreakdownModalStatus) paymentBreakdownModalStatus.dataset.status = 'loading';
        if (paymentBreakdownTableRenderer?.renderEmpty) {
            paymentBreakdownTableRenderer.renderEmpty(paymentBreakdownModalTableBody, 'Loading payment breakdown...');
        }
        if (paymentBreakdownModalSummary) paymentBreakdownModalSummary.textContent = 'Loading payment breakdown...';
        setPaymentBreakdownNotice('Loading the canonical billing record...', 'loading');
    };

    const renderPaymentBreakdownModalRecord = (record = {}) => {
        const summary = record?.billingSummary;
        if (!summary || Number(summary.version) < 2 || summary.available !== true || !Array.isArray(summary.rows)) {
            throw new Error('The canonical backend billing result is unavailable for this account.');
        }
        if (!paymentBreakdownTableRenderer?.createDisplayRows || !paymentBreakdownTableRenderer?.render) {
            throw new Error('The payment breakdown table could not be loaded. Refresh the page and try again.');
        }

        const accountNumber = normalizeAccountNumber(record.accountNumber || activePaymentBreakdownAccount);
        const displayName = formatCustomerName(record);
        const planName = String(record.planName || record.plan || 'Monthly plan').trim() || 'Monthly plan';
        const latestCanonicalRow = summary.rows.length ? summary.rows[summary.rows.length - 1] : null;
        const planAmount = Number(
            record.planAmount
            ?? record.monthlyAmount
            ?? latestCanonicalRow?.planAmount
            ?? record.amount
        ) || 0;
        const billingStatus = String(summary.billingStatus || 'unavailable').trim().toLowerCase() || 'unavailable';
        const billingStatusLabel = toTitleCase(billingStatus);
        const rows = paymentBreakdownTableRenderer.createDisplayRows(record, summary.rows);
        const paidRows = rows.filter((row) => row.paymentStatus === 'paid').length;
        const pendingRows = rows.filter((row) => row.paymentStatus === 'not-generated').length;
        const unpaidRows = Math.max(0, rows.length - paidRows - pendingRows);
        const endingBalance = Number(summary.endingBalance ?? summary.balance ?? record.balance) || 0;
        const reconciliation = summary.reconciliation;

        if (paymentBreakdownModalSubtitle) {
            paymentBreakdownModalSubtitle.textContent = [
                displayName,
                accountNumber ? `Account ${accountNumber}` : '',
                planName
            ].filter(Boolean).join(' • ');
        }
        setPaymentBreakdownSummaryValue(paymentBreakdownModalAccount, accountNumber);
        setPaymentBreakdownSummaryValue(paymentBreakdownModalPlan, `${planName} • ${formatCurrency(planAmount)}`);
        setPaymentBreakdownSummaryValue(paymentBreakdownModalStatus, billingStatusLabel);
        setPaymentBreakdownSummaryValue(
            paymentBreakdownModalBalance,
            paymentBreakdownTableRenderer.formatBalance?.(endingBalance) || formatCurrency(Math.max(0, endingBalance))
        );
        if (paymentBreakdownModalStatus) paymentBreakdownModalStatus.dataset.status = billingStatus;
        if (paymentBreakdownModalFullPage) paymentBreakdownModalFullPage.href = buildPaymentBreakdownUrl(accountNumber);

        paymentBreakdownTableRenderer.render({
            tbody: paymentBreakdownModalTableBody,
            rows,
            editableReferrals: false
        });

        const summaryParts = [
            `Showing ${rows.length} bill breakdown${rows.length === 1 ? '' : 's'}.`,
            `${paidRows} paid, ${unpaidRows} unpaid.`
        ];
        if (pendingRows) {
            summaryParts.push(`${pendingRows} postpaid bill${pendingRows === 1 ? '' : 's'} not generated yet.`);
        }
        if (Number(reconciliation?.issueCount) > 0) {
            summaryParts.push(`Reconciliation: ${Number(reconciliation.issueCount)} issue${Number(reconciliation.issueCount) === 1 ? '' : 's'} detected.`);
        } else if (reconciliation?.status === 'clean') {
            summaryParts.push('Reconciliation: clean.');
        }
        if (paymentBreakdownModalSummary) paymentBreakdownModalSummary.textContent = summaryParts.join(' ');
        setPaymentBreakdownNotice('', 'success');
    };

    const loadPaymentBreakdownModal = async (accountNumber, requestId) => {
        try {
            const response = await fetch(`/api/payment-records/${encodeURIComponent(accountNumber)}`, {
                credentials: 'include',
                cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.error || payload?.message || 'Unable to load the payment breakdown.');
            }
            if (requestId !== paymentBreakdownRequestId || !paymentBreakdownModal?.classList.contains('show')) return;
            if (!payload?.record) throw new Error('Customer payment record was not found.');
            renderPaymentBreakdownModalRecord(payload.record);
        } catch (error) {
            if (requestId !== paymentBreakdownRequestId || !paymentBreakdownModal?.classList.contains('show')) return;
            const message = error?.message || 'Unable to load the payment breakdown.';
            console.error('Failed to load payment breakdown modal:', error);
            paymentBreakdownTableRenderer?.renderEmpty?.(paymentBreakdownModalTableBody, message);
            if (paymentBreakdownModalSummary) paymentBreakdownModalSummary.textContent = 'Payment breakdown could not be loaded.';
            setPaymentBreakdownSummaryValue(paymentBreakdownModalStatus, 'Unavailable');
            if (paymentBreakdownModalStatus) paymentBreakdownModalStatus.dataset.status = 'unavailable';
            setPaymentBreakdownNotice(message, 'error');
        }
    };

    function refreshPaymentBreakdownModal(accountNumber) {
        const targetAccount = normalizeAccountNumber(accountNumber || activePaymentBreakdownAccount);
        if (!paymentBreakdownModal?.classList.contains('show') || !targetAccount) return;
        const customer = findCustomerByAccount(allCustomers, targetAccount)
            || findCustomerByAccount(window.allCustomers, targetAccount)
            || null;
        activePaymentBreakdownAccount = targetAccount;
        paymentBreakdownRequestId += 1;
        const requestId = paymentBreakdownRequestId;
        resetPaymentBreakdownModal(targetAccount, customer);
        void loadPaymentBreakdownModal(targetAccount, requestId);
    }

    function openPaymentBreakdownModal(accountNumber, triggerElement = null) {
        const targetAccount = normalizeAccountNumber(accountNumber);
        if (!paymentBreakdownModal || !targetAccount) return false;
        const customer = findCustomerByAccount(allCustomers, targetAccount)
            || findCustomerByAccount(window.allCustomers, targetAccount)
            || null;
        activePaymentBreakdownAccount = targetAccount;
        paymentBreakdownRequestId += 1;
        const requestId = paymentBreakdownRequestId;
        const focusableTrigger = triggerElement instanceof HTMLElement
            && triggerElement.matches('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
        lastFocusedElement = focusableTrigger ? triggerElement : document.activeElement;
        resetPaymentBreakdownModal(targetAccount, customer);
        paymentBreakdownModal.classList.add('show');
        paymentBreakdownModal.setAttribute('aria-hidden', 'false');
        syncModalScrollLock();
        paymentBreakdownModal.querySelector('.close-modal')?.focus();
        void loadPaymentBreakdownModal(targetAccount, requestId);
        return true;
    }

    function openPaymentFromBreakdownModal() {
        const targetAccount = normalizeAccountNumber(activePaymentBreakdownAccount);
        if (!targetAccount) {
            showToast('Unable to identify the subscriber for this payment.');
            return;
        }
        const opened = openPaymentModalForAccount(targetAccount, { lockCustomer: true });
        if (!opened) {
            showToast('Unable to open the payment form for this subscriber.');
            return;
        }
        paymentBreakdownPaymentAccount = targetAccount;
        setPaymentBreakdownPaymentLayer(true);
    }

    function closePaymentBreakdownModal() {
        if (!paymentBreakdownModal) return;
        paymentBreakdownRequestId += 1;
        activePaymentBreakdownAccount = '';
        paymentBreakdownPaymentAccount = '';
        setPaymentBreakdownPaymentLayer(false);
        paymentBreakdownModal.classList.remove('show');
        paymentBreakdownModal.setAttribute('aria-hidden', 'true');
        syncModalScrollLock();
        lastFocusedElement?.focus();
    }

    function closeModal(options = {}) {
        if (!options.force && Date.now() < paymentModalIgnoreCloseUntil) return;
        const breakdownAccount = normalizeAccountNumber(paymentBreakdownPaymentAccount);
        const shouldReturnToBreakdown = Boolean(
            breakdownAccount && paymentBreakdownModal?.classList.contains('show')
        );
        paymentBreakdownPaymentAccount = '';
        paymentModal.classList.remove('show');
        paymentModal.setAttribute('aria-hidden', 'true');
        setPaymentBreakdownPaymentLayer(false);
        syncModalScrollLock();
        if (shouldReturnToBreakdown) {
            if (options.refreshPaymentBreakdown) {
                refreshPaymentBreakdownModal(breakdownAccount);
            }
            paymentBreakdownModalAddPayment?.focus();
            return;
        }
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
    paymentBreakdownModalAddPayment?.addEventListener('click', openPaymentFromBreakdownModal);
    paymentKindSelect?.addEventListener('change', () => {
        syncPaymentMethodVisibility();
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
                showToast('WiFi editor is only available for Archie Fiber.');
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
            if (modalToClose === paymentBreakdownModal) {
                closePaymentBreakdownModal();
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
        if (event.target === paymentBreakdownModal) {
            closePaymentBreakdownModal();
        }
        if (event.target === customerAddModal) {
            closeCustomerAddModal();
        }
    });

    window.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && paymentModal.classList.contains('show')) {
            closeModal();
            return;
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
        if (event.key === 'Escape' && paymentBreakdownModal?.classList.contains('show')) {
            closePaymentBreakdownModal();
        }
    });

    // Auto-fill amount based on selected customer's balance
    customerSelect.addEventListener('change', () => {
        const accountNumber = normalizeAccountNumber(customerSelect.value);

        if (!accountNumber) {
            if (paymentAmountInput) paymentAmountInput.value = '';
            selectedCustomer = null;
            ensureTransactionAmountFieldVisible();
            return;
        }

        const customer = findCustomerByAccount(allCustomers, accountNumber);
        selectedCustomer = customer || null;
        autofillTransactionAmount(customer);

    });

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
            currentBillStateCache = new WeakMap();
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

        const totalReceivables = customers.reduce((sum, customer) => {
            const currentBillState = resolveCurrentBillState(customer);
            return currentBillState.billingUnavailable
                ? sum
                : sum + Math.max(0, currentBillState.amount);
        }, 0);

        const totalCollected = customers.reduce((sum, c) => sum + (c.totalCredits || 0), 0);

        const pastDueCount = customers.filter(c => deriveStatus(c) === 'overdue').length;

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

        const selectedKind = String(formData.get('kind') || '').trim().toLowerCase();
        const isPaymentKind = selectedKind === 'payment';

        const payload = {
            amount: parseFloat(formData.get('amount')),
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
                showToast(`Transaction added successfully!`);
                closeModal({ force: true, refreshPaymentBreakdown: true });
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
        advance: { class: 'advance', text: 'Advance' },
        complimentary: { class: 'info', text: 'Complimentary' },
        unavailable: { class: 'neutral', text: 'Unavailable' }
    };

    const deriveStatus = (customer) => {
        const status = String(customer?.billingSummary?.billingStatus || 'unavailable').trim().toLowerCase();
        return statusMap[status] ? status : 'unavailable';
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
            const complimentaryAccount = customer?.complimentaryAccount || customer?.billingSummary?.complimentaryAccount || {};
            const complimentaryActive = complimentaryAccount.active === true;

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

            let billingCycleDisplay = 'Not set';
            let billingCycleMeta = 'No cycle recorded';
            const planCategory = resolvePlanCategory(customer);
            const currentBillState = resolveCurrentBillState(customer);
            const canonicalCycle = customer?.billingSummary?.currentCycle;

            if (complimentaryActive) {
                const currentPeriod = complimentaryAccount.currentPeriod || {};
                billingCycleDisplay = `Complimentary from ${formatMonthKeyLabel(currentPeriod.effectiveMonth)}`;
                billingCycleMeta = complimentaryAccount.nextBillableCycleDate
                    ? `Billing resumes ${formatDate(complimentaryAccount.nextBillableCycleDate)}`
                    : 'No end month';
            } else if (!currentBillState.billingUnavailable && canonicalCycle?.billDate) {
                const cycleStatus = canonicalCycle.paymentStatus === 'paid'
                    ? 'Paid'
                    : (canonicalCycle.paymentStatus === 'unpaid' ? 'Unpaid' : 'Not generated');
                billingCycleDisplay = `Current: ${formatDate(canonicalCycle.billDate)} | ${cycleStatus}`;
                billingCycleMeta = customer.billingSummary.nextCycleDate
                    ? `Next: ${formatDate(customer.billingSummary.nextCycleDate)}`
                    : 'Next cycle unavailable';
            } else {
                billingCycleDisplay = 'Billing unavailable';
                billingCycleMeta = 'Canonical backend result required';
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
            const balanceClass = currentBillState.billClass;

            // Use Math.abs to prevent negative sign, color coding will indicate the status
            const balanceAmount = currentBillState.billingUnavailable
                ? 'Unavailable'
                : formatCurrency(currentBillState.displayAmount);
            const dueForDisplay = currentBillState.currentDueDate
                ? formatDate(currentBillState.currentDueDate)
                : '-';
            const prepaidBillMeta = currentBillState.billingUnavailable
                ? 'Backend result required'
                : !currentBillState.hasCurrentBreakdownRow
                ? 'No current bill'
                : currentBillState.amount < -EPSILON
                ? 'Advance'
                : (currentBillState.amount <= EPSILON
                    ? 'Paid'
                    : (currentBillState.existingCustomerStart ? 'Opening balance' : (currentBillState.hasPostedCurrentBill ? 'Balance' : (currentBillState.isProrated ? 'Prorated bill' : 'Current bill'))));
            const postpaidBillMeta = currentBillState.billingUnavailable
                ? 'Backend result required'
                : !currentBillState.hasCurrentBreakdownRow
                ? 'No current bill'
                : currentBillState.amount < -EPSILON
                ? (currentBillState.existingCustomerStart ? 'Opening advance' : 'Advance after current bill')
                : (currentBillState.amount <= EPSILON ? 'Paid' : (currentBillState.existingCustomerStart ? 'Opening balance' : (currentBillState.isProrated ? 'Prorated bill' : `Due ${dueForDisplay}`)));
            const currentBill = complimentaryActive
                ? `${balanceAmount}<br>Collection paused`
                : (planCategory === 'prepaid'
                    ? `${balanceAmount}<br>${prepaidBillMeta}`
                    : `${balanceAmount}<br>${postpaidBillMeta}`);
            
            // Plan catalog usage for display
            const matchedPlan = customer.planName ? planByName.get(normalizePlanName(customer.planName)) : undefined;
            const effectiveAmount = matchedPlan?.price ?? customer.planAmount ?? 0;
            const amountDisplay = formatCurrency(Number(effectiveAmount) || 0);
            const priceSuffix = '/ month';
            const isLegacyPlan = !matchedPlan;
            const planPillClass = isLegacyPlan ? 'plan-pill accent' : 'plan-pill neutral';
            const planMetaText = isLegacyPlan
                ? '<span style="color:#b91c1c;font-weight:600;">Not in current plans</span>'
                : `${amountDisplay}${priceSuffix ? ` &middot; ${priceSuffix}` : ''}`;

            const accountNumber = normalizeAccountNumber(customer.accountNumber || '');
            const paymentBreakdownUrl = buildPaymentBreakdownUrl(accountNumber);

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
                        <a class="subscriber subscriber-link" href="${paymentBreakdownUrl}" data-account-number="${accountNumber}" aria-label="Open payment breakdown for ${escapeHtml(displayName)}">
                            <span class="avatar">${displayInitials}</span>
                            <div>
                                <p class="subscriber-name">${displayName}</p>
                                <p class="subscriber-meta">Joined ${customer.since || customer.joinDate || 'N/A'} &middot; <span class="status-pill status-pill--indicator ${subscriberStatusClass}" title="${escapeHtml(subscriberStatusLabel)}" aria-label="${escapeHtml(subscriberStatusLabel)}"></span>${complimentaryActive ? ' <span class="badge bg-azure-lt text-azure">COMPLIMENTARY</span>' : ''}</p>
                            </div>
                        </a>
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
            const getComparableBalance = (customer) => Math.abs(resolveCurrentBillState(customer).amount);
            const getSignedBalance = (customer) => resolveCurrentBillState(customer).amount;

            results.sort((a, b) => {
                const balanceDiff = getComparableBalance(a) - getComparableBalance(b);
                if (balanceDiff !== 0) return balanceDiff * direction;

                const signedBalanceDiff = getSignedBalance(a) - getSignedBalance(b);
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
            const newSize = getValidPageSize(pageSizeSelect.value);
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
        const breakdownLink = event.target.closest('a.subscriber-link');
        if (breakdownLink && paymentsTableBody.contains(breakdownLink)) {
            event.preventDefault();
            const accountNumber = normalizeAccountNumber(breakdownLink.dataset.accountNumber || breakdownLink.closest('tr')?.dataset.accountNumber);
            if (!openPaymentBreakdownModal(accountNumber, breakdownLink)) {
                showToast('Unable to open the payment breakdown for this subscriber.');
            }
            return;
        }
        if (event.target.closest('button, a, input, select, textarea, label')) return;
        const row = event.target.closest('tr[data-account-number]');
        if (!row) return;
        const accountNumber = normalizeAccountNumber(row.dataset.accountNumber);
        if (!accountNumber) return;
        if (!openPaymentBreakdownModal(accountNumber, row)) {
            showToast('Unable to open the payment breakdown for this subscriber.');
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
        const parsedSize = getValidPageSize(pageSizeSelect?.value, paymentsPagination.pageSize || DEFAULT_PAYMENTS_PAGE_SIZE);
        if (Number.isFinite(parsedSize) && parsedSize > 0) {
            paymentsPagination.pageSize = parsedSize;
        } else if (!Number.isFinite(paymentsPagination.pageSize) || paymentsPagination.pageSize <= 0) {
            paymentsPagination.pageSize = DEFAULT_PAYMENTS_PAGE_SIZE;
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
            const opened = openPaymentModalForAccount(requestedPayNowAccount, { lockCustomer: true });
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
