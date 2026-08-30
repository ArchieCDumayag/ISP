(() => {
    const tableBody = document.getElementById('archiveTableBody');
    const searchInput = document.getElementById('archiveSearch');
    const pageSizeSelect = document.getElementById('archivePageSize');
    const prevBtn = document.getElementById('archivePrev');
    const nextBtn = document.getElementById('archiveNext');
    const pageInfo = document.getElementById('archivePageInfo');
    const summary = document.getElementById('archiveSummary');
    const countBadge = document.getElementById('deletedArchiveCount');
    const selectAllInput = document.getElementById('archiveSelectAll');
    const deleteSelectedBtn = document.getElementById('archiveDeleteSelectedBtn');
    const deleteAllBtn = document.getElementById('archiveDeleteAllBtn');

    if (!tableBody || !pageSizeSelect) return;

    const COLUMN_COUNT = 7;
    const REQUEST_TIMEOUT_MS = 20000;

    const state = {
        items: [],
        total: 0,
        limit: Number(pageSizeSelect.value || 10) || 10,
        offset: 0,
        loading: false,
        errorMessage: '',
        search: '',
        bulkDeleteInProgress: false,
        bulkDeleteScope: '',
        selectedIds: new Set(),
        selectedMeta: new Map()
    };

    const notify = (message, type = 'info') => {
        if (typeof window.appToast === 'function') {
            try {
                window.appToast(message, { type });
            } catch (error) {
                console.warn('Archive notification failed:', error);
            }
            return;
        }
        console.log(message);
    };

    const escapeHtml = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const parseDate = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
        return Number.isFinite(parsed.getTime()) ? parsed : null;
    };

    const formatDate = (value) => {
        const parsed = parseDate(value);
        if (!parsed) return String(value || '-').trim() || '-';
        return new Intl.DateTimeFormat('en-US', {
            month: 'long',
            day: '2-digit',
            year: 'numeric'
        }).format(parsed);
    };

    const formatTime = (value) => {
        const parsed = parseDate(value);
        if (!parsed) return '';
        return new Intl.DateTimeFormat('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }).format(parsed);
    };

    const formatCountdown = (daysRemaining) => {
        const days = Number(daysRemaining);
        if (!Number.isFinite(days) || days <= 0) return 'Deletes today';
        if (days === 1) return '1 day left';
        return `${days} days left`;
    };

    const normalizeRecordType = (value) => String(value || '').trim().toLowerCase() === 'draft' ? 'draft' : 'customer';

    const formatArchiveCollection = (count) => `${count} archived record${count === 1 ? '' : 's'}`;

    const getArchiveStatusLabel = (recordType) => normalizeRecordType(recordType) === 'draft' ? 'Draft archive' : 'Archived';

    const getArchiveRestoreConfig = (recordType) => normalizeRecordType(recordType) === 'draft'
        ? {
            title: 'Restore Draft',
            okText: 'Restore to Drafts',
            confirmMessage: 'This will move the draft back to the customer draft queue.',
            successMessage: 'restored to customer drafts.'
        }
        : {
            title: 'Restore Customer',
            okText: 'Restore',
            confirmMessage: 'This will move the customer back to the active customer list.',
            successMessage: 'restored to active customers.'
        };

    const getInitials = (value) => {
        const words = String(value || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2);
        if (!words.length) return 'AR';
        return words.map((word) => word.charAt(0).toUpperCase()).join('');
    };

    const rememberArchiveItem = (item) => {
        const archiveId = String(item?.id || '').trim();
        if (!archiveId) return;
        state.selectedMeta.set(archiveId, {
            archiveId,
            customerName: String(item?.customerName || '').trim(),
            accountNumber: String(item?.accountNumber || '').trim(),
            recordType: normalizeRecordType(item?.recordType)
        });
    };

    const forgetArchiveItem = (archiveId) => {
        const normalized = String(archiveId || '').trim();
        if (!normalized) return;
        state.selectedIds.delete(normalized);
        state.selectedMeta.delete(normalized);
    };

    const formatArchiveLabel = ({ customerName = '', accountNumber = '' } = {}) => {
        const name = String(customerName || '').trim();
        const account = String(accountNumber || '').trim();
        if (name && account) return `${name} (${account})`;
        return name || account || 'this archived record';
    };

    const renderSelectionUi = () => {
        const pageIds = state.items
            .map((item) => String(item?.id || '').trim())
            .filter(Boolean);
        const selectedOnPage = pageIds.filter((archiveId) => state.selectedIds.has(archiveId)).length;
        const selectedCount = state.selectedIds.size;

        if (selectAllInput) {
            selectAllInput.disabled = state.loading || pageIds.length === 0 || state.bulkDeleteInProgress;
            selectAllInput.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
            selectAllInput.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
        }

        if (deleteSelectedBtn) {
            deleteSelectedBtn.disabled = selectedCount === 0 || state.loading || state.bulkDeleteInProgress;
            deleteSelectedBtn.innerHTML = state.bulkDeleteInProgress && state.bulkDeleteScope === 'selected'
                ? '<i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i> Deleting...'
                : `<i class="ti ti-trash" aria-hidden="true"></i> Delete selected${selectedCount ? ` (${selectedCount})` : ''}`;
        }

        if (deleteAllBtn) {
            const total = Number(state.total || 0);
            deleteAllBtn.disabled = total === 0 || state.loading || state.bulkDeleteInProgress;
            deleteAllBtn.innerHTML = state.bulkDeleteInProgress && state.bulkDeleteScope === 'all'
                ? '<i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i> Deleting all...'
                : '<i class="ti ti-trash-x" aria-hidden="true"></i> Delete all';
        }
    };

    const renderTable = () => {
        if (state.loading) {
            tableBody.innerHTML = `<tr><td colspan="${COLUMN_COUNT}" class="py-5 text-secondary text-center">Loading archived records...</td></tr>`;
            renderSelectionUi();
            return;
        }

        if (state.errorMessage) {
            tableBody.innerHTML = `<tr><td colspan="${COLUMN_COUNT}" class="py-5 text-danger text-center">${escapeHtml(state.errorMessage)}</td></tr>`;
            renderSelectionUi();
            return;
        }

        if (!state.items.length) {
            tableBody.innerHTML = `<tr><td colspan="${COLUMN_COUNT}" class="py-5 text-secondary text-center">${
                state.search ? 'No archived records matched your search.' : 'No archived records found.'
            }</td></tr>`;
            renderSelectionUi();
            return;
        }

        tableBody.innerHTML = state.items.map((item) => {
            rememberArchiveItem(item);
            const archiveId = String(item?.id || '').trim();
            const recordType = normalizeRecordType(item?.recordType);
            const accountNumber = String(item?.accountNumber || '-').trim() || '-';
            const customerName = String(item?.customerName || (recordType === 'draft' ? 'Unnamed draft' : 'Unnamed customer')).trim()
                || (recordType === 'draft' ? 'Unnamed draft' : 'Unnamed customer');
            const contact = String(item?.contactNumber || 'No contact saved').trim() || 'No contact saved';
            const planName = String(item?.planName || 'No plan').trim() || 'No plan';
            const areaName = String(item?.areaName || 'No area').trim() || 'No area';
            const daysRemaining = Number(item?.daysRemaining || 0);
            const countdownClass = daysRemaining <= 3
                ? 'badge bg-danger-lt text-danger'
                : 'badge bg-warning-lt text-warning';
            const restoreConfig = getArchiveRestoreConfig(recordType);
            const isSelected = state.selectedIds.has(archiveId);
            return `
                <tr data-archive-id="${escapeHtml(archiveId)}">
                    <td class="text-nowrap">
                        <input
                            type="checkbox"
                            class="form-check-input"
                            data-archive-select="${escapeHtml(archiveId)}"
                            aria-label="Select ${escapeHtml(customerName)}"
                            ${isSelected ? 'checked' : ''}
                        >
                    </td>
                    <td class="text-nowrap">
                        <span class="badge bg-blue-lt text-blue font-monospace">${escapeHtml(accountNumber)}</span>
                    </td>
                    <td>
                        <div class="d-flex align-items-center gap-2 min-w-0">
                            <span class="avatar avatar-sm bg-primary-lt text-primary">${escapeHtml(getInitials(customerName))}</span>
                            <div class="min-w-0">
                                <p class="fw-semibold mb-0 text-truncate">${escapeHtml(customerName)}</p>
                                <p class="d-flex flex-wrap align-items-center gap-1 text-secondary small mt-1 mb-0">
                                    <span>${escapeHtml(contact)}</span>
                                    <span class="badge bg-secondary-lt text-secondary">${escapeHtml(getArchiveStatusLabel(recordType))}</span>
                                </p>
                            </div>
                        </div>
                    </td>
                    <td>
                        <p class="fw-semibold mb-0">${escapeHtml(planName)}</p>
                        <p class="text-secondary small mt-1 mb-0">${escapeHtml(areaName)}</p>
                    </td>
                    <td>
                        <p class="fw-semibold mb-0">${escapeHtml(formatDate(item?.deletedAt))}</p>
                        <p class="text-secondary small mt-1 mb-0">${escapeHtml(formatTime(item?.deletedAt) || 'Time unavailable')}</p>
                    </td>
                    <td>
                        <span class="${countdownClass}">
                            <i class="ti ti-clock" aria-hidden="true"></i>
                            ${escapeHtml(formatCountdown(daysRemaining))}
                        </span>
                        <p class="text-secondary small mt-1 mb-0">
                            Deletes on ${escapeHtml(formatDate(item?.purgeAfter))}${formatTime(item?.purgeAfter) ? `, ${escapeHtml(formatTime(item?.purgeAfter))}` : ''}
                        </p>
                    </td>
                    <td class="text-end text-nowrap">
                        <div class="d-inline-flex gap-1">
                            <button
                                type="button"
                                class="btn btn-icon btn-outline-success btn-sm"
                                data-action="restore"
                                data-archive-id="${escapeHtml(archiveId)}"
                                data-customer-name="${escapeHtml(customerName)}"
                                data-account-number="${escapeHtml(accountNumber)}"
                                data-record-type="${escapeHtml(recordType)}"
                                title="${escapeHtml(restoreConfig.title)}"
                                aria-label="${escapeHtml(restoreConfig.title)}"
                            >
                                <i class="ti ti-arrow-back-up" aria-hidden="true"></i>
                            </button>
                            <button
                                type="button"
                                class="btn btn-icon btn-outline-danger btn-sm"
                                data-action="delete"
                                data-archive-id="${escapeHtml(archiveId)}"
                                data-customer-name="${escapeHtml(customerName)}"
                                data-account-number="${escapeHtml(accountNumber)}"
                                data-record-type="${escapeHtml(recordType)}"
                                title="Delete permanently"
                                aria-label="Delete permanently"
                            >
                                <i class="ti ti-trash" aria-hidden="true"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        renderSelectionUi();
    };

    const renderPagination = () => {
        const total = Number(state.total || 0);
        const start = total ? state.offset + 1 : 0;
        const end = total ? Math.min(state.offset + state.items.length, total) : 0;
        const page = total ? Math.floor(state.offset / state.limit) + 1 : 1;
        const pageCount = total ? Math.max(1, Math.ceil(total / state.limit)) : 1;

        if (summary) {
            summary.textContent = total
                ? `Showing ${start}-${end} of ${total} archived records`
                : 'Showing 0 of 0 archived records';
        }
        if (pageInfo) {
            pageInfo.textContent = `Page ${page} of ${pageCount}`;
        }
        if (prevBtn) {
            prevBtn.disabled = state.offset <= 0 || state.loading || state.bulkDeleteInProgress;
        }
        if (nextBtn) {
            nextBtn.disabled = state.loading || state.bulkDeleteInProgress || (state.offset + state.limit >= total);
        }
        if (countBadge) {
            countBadge.textContent = String(total);
        }
    };

    const render = () => {
        try {
            renderTable();
            renderPagination();
        } catch (error) {
            console.error('Failed to render archived records:', error);
            state.loading = false;
            state.errorMessage = error?.message || 'Failed to render archived records.';
            tableBody.innerHTML = `<tr><td colspan="${COLUMN_COUNT}" class="py-5 text-danger text-center">${escapeHtml(state.errorMessage)}</td></tr>`;
            renderPagination();
            renderSelectionUi();
        }
    };

    const apiFetch = async (url, options = {}) => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response = null;
        try {
            response = await fetch(url, {
                credentials: 'include',
                headers: {
                    ...(options.headers || {})
                },
                ...options,
                signal: options.signal || controller.signal
            });
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error('Loading archived records timed out. Please refresh and try again.');
            }
            throw error;
        } finally {
            window.clearTimeout(timeoutId);
        }
        let payload = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Session expired. Please sign in again.');
            }
            throw new Error(payload?.error || payload?.message || `Request failed (${response.status})`);
        }
        return payload;
    };

    const loadArchives = async () => {
        state.loading = true;
        state.errorMessage = '';
        render();

        try {
            while (true) {
                const params = new URLSearchParams({
                    limit: String(state.limit),
                    offset: String(state.offset)
                });
                if (state.search) {
                    params.set('search', state.search);
                }

                const payload = await apiFetch(`/api/customers/archive?${params.toString()}`);
                const items = Array.isArray(payload?.items) ? payload.items : [];
                const total = Number(payload?.total || 0);

                if (state.offset > 0 && total > 0 && state.offset >= total) {
                    state.offset = Math.max(0, Math.floor((total - 1) / state.limit) * state.limit);
                    continue;
                }

                state.items = items;
                state.total = total;
                break;
            }
        } catch (error) {
            state.items = [];
            state.total = 0;
            state.errorMessage = error.message || 'Failed to load archived records.';
            notify(error.message || 'Failed to load archived records.', 'error');
        } finally {
            state.loading = false;
            render();
        }
    };

    const confirmAction = async (message, options = {}) => {
        let result;
        if (window.appConfirm) {
            result = await window.appConfirm(message, options);
        } else {
            result = window.confirm(message);
        }
        if (result && typeof result === 'object') {
            return result.ok === true || result.confirmed === true || result.value === true;
        }
        return result === true;
    };

    const restoreArchivedCustomer = async ({ archiveId, customerName, accountNumber, recordType }) => {
        const normalizedId = String(archiveId || '').trim();
        if (!normalizedId) return;
        const label = formatArchiveLabel({ customerName, accountNumber });
        const restoreConfig = getArchiveRestoreConfig(recordType);
        const confirmed = await confirmAction(
            `Restore ${label}? ${restoreConfig.confirmMessage}`,
            { title: restoreConfig.title, okText: restoreConfig.okText }
        );
        if (!confirmed) return;

        try {
            const payload = await apiFetch(`/api/customers/archive/${encodeURIComponent(normalizedId)}/restore`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            forgetArchiveItem(normalizedId);
            notify(`${label} ${restoreConfig.successMessage}`, 'success');
            if (payload?.warning) {
                notify(String(payload.warning || '').trim(), 'warning');
            }
            await loadArchives();
        } catch (error) {
            notify(error.message || 'Failed to restore archived record.', 'error');
        }
    };

    const deleteArchivedCustomer = async ({ archiveId, customerName, accountNumber, skipConfirm = false } = {}) => {
        const normalizedId = String(archiveId || '').trim();
        if (!normalizedId) return false;
        const label = formatArchiveLabel({ customerName, accountNumber });

        if (!skipConfirm) {
            const confirmed = await confirmAction(
                `Permanently delete ${label}? This cannot be undone.`,
                { title: 'Delete Permanently', okText: 'Delete' }
            );
            if (!confirmed) return false;
        }

        const payload = await apiFetch(`/api/customers/archive/${encodeURIComponent(normalizedId)}`, {
            method: 'DELETE'
        });
        forgetArchiveItem(normalizedId);
        return payload || { ok: true };
    };

    const deleteSelectedArchives = async () => {
        const selectedIds = Array.from(state.selectedIds).filter(Boolean);
        if (!selectedIds.length || state.bulkDeleteInProgress) return;

        const previewItems = selectedIds
            .slice(0, 5)
            .map((archiveId) => state.selectedMeta.get(archiveId) || { archiveId });
        const previewText = previewItems.map((item) => formatArchiveLabel(item)).join(', ');
        const moreCount = selectedIds.length - previewItems.length;
        const message = moreCount > 0
            ? `Permanently delete ${formatArchiveCollection(selectedIds.length)} (${previewText}, +${moreCount} more)? This cannot be undone.`
            : `Permanently delete ${formatArchiveCollection(selectedIds.length)} (${previewText})? This cannot be undone.`;

        const confirmed = await confirmAction(message, {
            title: 'Delete Selected Archive Records',
            okText: 'Delete'
        });
        if (!confirmed) return;

        state.bulkDeleteInProgress = true;
        state.bulkDeleteScope = 'selected';
        renderSelectionUi();

        try {
            const results = await Promise.allSettled(selectedIds.map(async (archiveId) => {
                const meta = state.selectedMeta.get(archiveId) || { archiveId };
                const payload = await deleteArchivedCustomer({
                    archiveId,
                    customerName: meta.customerName,
                    accountNumber: meta.accountNumber,
                    skipConfirm: true
                });
                return { archiveId, warning: payload?.warning || '' };
            }));

            const succeededIds = [];
            const warnings = [];
            const failedResults = [];
            results.forEach((result) => {
                if (result.status === 'fulfilled' && result.value?.archiveId) {
                    succeededIds.push(result.value.archiveId);
                    if (result.value.warning) warnings.push(result.value.warning);
                } else {
                    failedResults.push(result.reason || new Error('Archived record was not deleted.'));
                }
            });

            succeededIds.forEach((archiveId) => forgetArchiveItem(archiveId));

            if (succeededIds.length && failedResults.length) {
                notify(`${formatArchiveCollection(succeededIds.length)} deleted. ${failedResults.length} failed.`, 'warning');
            } else if (succeededIds.length) {
                notify(`${formatArchiveCollection(succeededIds.length)} deleted.`, 'success');
            } else if (failedResults.length) {
                notify(failedResults[0]?.message || 'Failed to delete selected archived records.', 'error');
            }
            if (warnings.length) {
                notify(warnings[0], 'warning');
            }
        } catch (error) {
            notify(error?.message || 'Failed to delete selected archived records.', 'error');
        } finally {
            state.bulkDeleteInProgress = false;
            state.bulkDeleteScope = '';
            await loadArchives();
        }
    };

    const deleteAllArchives = async () => {
        const total = Number(state.total || 0);
        if (!total || state.bulkDeleteInProgress) return;

        const confirmed = await confirmAction(
            `Permanently delete all archived records? This deletes every archived record in this branch, not only this page. This cannot be undone.`,
            {
                title: 'Delete All Archive Records',
                okText: 'Delete All'
            }
        );
        if (!confirmed) return;

        state.bulkDeleteInProgress = true;
        state.bulkDeleteScope = 'all';
        renderSelectionUi();
        renderPagination();

        try {
            const payload = await apiFetch('/api/customers/archive', {
                method: 'DELETE'
            });
            const deletedCount = Number(payload?.deletedCount || 0);
            state.selectedIds.clear();
            state.selectedMeta.clear();
            state.offset = 0;
            notify(
                deletedCount
                    ? `${formatArchiveCollection(deletedCount)} permanently deleted.`
                    : 'No archived records were deleted.',
                deletedCount ? 'success' : 'info'
            );
        } catch (error) {
            notify(error?.message || 'Failed to delete all archived records.', 'error');
        } finally {
            state.bulkDeleteInProgress = false;
            state.bulkDeleteScope = '';
            await loadArchives();
        }
    };

    let searchTimer = null;
    searchInput?.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
            state.search = String(searchInput.value || '').trim();
            state.offset = 0;
            loadArchives();
        }, 220);
    });

    pageSizeSelect.addEventListener('change', () => {
        state.limit = Number(pageSizeSelect.value || 10) || 10;
        state.offset = 0;
        loadArchives();
    });

    prevBtn?.addEventListener('click', () => {
        if (state.offset <= 0 || state.loading || state.bulkDeleteInProgress) return;
        state.offset = Math.max(0, state.offset - state.limit);
        loadArchives();
    });

    nextBtn?.addEventListener('click', () => {
        if (state.loading || state.bulkDeleteInProgress || (state.offset + state.limit >= state.total)) return;
        state.offset += state.limit;
        loadArchives();
    });

    selectAllInput?.addEventListener('change', () => {
        const pageIds = state.items
            .map((item) => String(item?.id || '').trim())
            .filter(Boolean);
        if (!pageIds.length) return;

        pageIds.forEach((archiveId) => {
            const item = state.items.find((entry) => String(entry?.id || '').trim() === archiveId);
            if (selectAllInput.checked) {
                state.selectedIds.add(archiveId);
                if (item) rememberArchiveItem(item);
            } else {
                forgetArchiveItem(archiveId);
            }
        });

        renderSelectionUi();
        renderTable();
    });

    deleteSelectedBtn?.addEventListener('click', () => {
        deleteSelectedArchives();
    });

    deleteAllBtn?.addEventListener('click', () => {
        deleteAllArchives();
    });

    tableBody.addEventListener('change', (event) => {
        const checkbox = event.target.closest('[data-archive-select]');
        if (!checkbox) return;

        const archiveId = String(checkbox.dataset.archiveSelect || '').trim();
        const item = state.items.find((entry) => String(entry?.id || '').trim() === archiveId);
        if (!archiveId) return;

        if (checkbox.checked) {
            state.selectedIds.add(archiveId);
            if (item) rememberArchiveItem(item);
        } else {
            forgetArchiveItem(archiveId);
        }

        renderSelectionUi();
    });

    tableBody.addEventListener('click', async (event) => {
        const restoreBtn = event.target.closest('[data-action="restore"]');
        if (restoreBtn) {
            await restoreArchivedCustomer({
                archiveId: String(restoreBtn.dataset.archiveId || '').trim(),
                customerName: String(restoreBtn.dataset.customerName || '').trim(),
                accountNumber: String(restoreBtn.dataset.accountNumber || '').trim(),
                recordType: String(restoreBtn.dataset.recordType || '').trim()
            });
            return;
        }

        const deleteBtn = event.target.closest('[data-action="delete"]');
        if (!deleteBtn) return;

        const archiveId = String(deleteBtn.dataset.archiveId || '').trim();
        const customerName = String(deleteBtn.dataset.customerName || '').trim();
        const accountNumber = String(deleteBtn.dataset.accountNumber || '').trim();

        try {
            const payload = await deleteArchivedCustomer({ archiveId, customerName, accountNumber });
            if (!payload) return;
            notify(`${formatArchiveLabel({ customerName, accountNumber })} permanently deleted from archive.`, 'success');
            if (payload?.warning) {
                notify(payload.warning, 'warning');
            }
            await loadArchives();
        } catch (error) {
            notify(error.message || 'Failed to permanently delete archived record.', 'error');
        }
    });

    loadArchives();
})();

(() => {
    const tabButtons = Array.from(document.querySelectorAll('[data-archive-tab]'));
    const tabPanels = Array.from(document.querySelectorAll('[data-archive-panel]'));
    const tableBody = document.getElementById('closedAccountsTableBody');
    const searchInput = document.getElementById('closedAccountsSearch');
    const pageSizeSelect = document.getElementById('closedAccountsPageSize');
    const prevBtn = document.getElementById('closedAccountsPrev');
    const nextBtn = document.getElementById('closedAccountsNext');
    const pageInfo = document.getElementById('closedAccountsPageInfo');
    const summary = document.getElementById('closedAccountsSummary');
    const countBadge = document.getElementById('closedAccountsCount');
    const reopenModal = document.getElementById('reopenAccountModal');
    const reopenForm = document.getElementById('reopenAccountForm');
    const reopenClose = document.getElementById('reopenAccountClose');
    const reopenCancel = document.getElementById('reopenAccountCancel');
    const reopenCustomerName = document.getElementById('reopenAccountCustomerName');
    const reopenBalanceLabel = document.getElementById('reopenAccountBalanceLabel');
    const reopenBalance = document.getElementById('reopenAccountBalance');
    const reopenBalanceAction = document.getElementById('reopenAccountBalanceAction');
    const reopenBalanceHint = document.getElementById('reopenAccountBalanceHint');
    const reopenReason = document.getElementById('reopenAccountReason');
    const reopenConfirmed = document.getElementById('reopenAccountConfirmed');
    const reopenConfirmationLabel = document.getElementById('reopenAccountConfirmationLabel');
    const reopenError = document.getElementById('reopenAccountError');
    const reopenSubmit = document.getElementById('reopenAccountSubmit');
    if (!tableBody || !pageSizeSelect) return;

    const state = {
        items: [],
        total: 0,
        limit: Number(pageSizeSelect.value || 10) || 10,
        offset: 0,
        search: '',
        loading: false,
        errorMessage: '',
        retryingClosureId: '',
        reopeningClosureId: '',
        reopenRecord: null
    };

    const notify = (message, type = 'info') => {
        if (typeof window.appToast === 'function') {
            window.appToast(message, { type });
            return;
        }
        console.log(message);
    };

    const escapeHtml = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const parseDate = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
        return Number.isFinite(parsed.getTime()) ? parsed : null;
    };

    const formatDate = (value) => {
        const parsed = parseDate(value);
        if (!parsed) return String(value || '-').trim() || '-';
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric'
        }).format(parsed);
    };

    const formatDateTime = (value) => {
        const parsed = parseDate(value);
        if (!parsed) return String(value || '-').trim() || '-';
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        }).format(parsed);
    };

    const readMoney = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const amount = Number(value);
        return Number.isFinite(amount) ? Number(amount.toFixed(2)) : null;
    };

    const formatMoney = (value) => {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return 'Unavailable';
        return `₱${Math.abs(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const formatBalance = (value) => {
        const amount = readMoney(value);
        if (amount === null) return 'Unavailable';
        return amount < -0.005 ? `${formatMoney(amount)} advance credit` : formatMoney(amount);
    };

    const getInitials = (value) => {
        const words = String(value || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
        return words.length ? words.map((word) => word.charAt(0).toUpperCase()).join('') : 'CA';
    };

    const activateTab = (tabName, { updateHash = true } = {}) => {
        const selected = tabName === 'closed' ? 'closed' : 'deleted';
        tabButtons.forEach((button) => {
            const active = button.dataset.archiveTab === selected;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
            const badge = button.querySelector('.badge');
            if (badge) {
                badge.classList.toggle('bg-primary-lt', active);
                badge.classList.toggle('text-primary', active);
                badge.classList.toggle('bg-secondary-lt', !active);
                badge.classList.toggle('text-secondary', !active);
            }
        });
        tabPanels.forEach((panel) => {
            panel.hidden = panel.dataset.archivePanel !== selected;
        });
        if (updateHash) {
            const nextHash = selected === 'closed' ? '#closed-accounts' : '#deleted-records';
            if (window.location.hash !== nextHash) window.history.replaceState(null, '', nextHash);
        }
        if (selected === 'closed') void loadClosedAccounts();
    };

    const apiFetch = async (url, options = {}) => {
        const response = await fetch(url, {
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || payload?.message || `Request failed (${response.status})`);
        return payload;
    };

    const renderPagination = () => {
        const total = state.total;
        const start = total ? state.offset + 1 : 0;
        const end = total ? Math.min(state.offset + state.items.length, total) : 0;
        const currentPage = total ? Math.floor(state.offset / state.limit) + 1 : 1;
        const pageCount = total ? Math.max(1, Math.ceil(total / state.limit)) : 1;
        if (summary) summary.textContent = total
            ? `Showing ${start}-${end} of ${total} closed accounts`
            : 'Showing 0 of 0 closed accounts';
        if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${pageCount}`;
        if (prevBtn) prevBtn.disabled = state.loading || state.offset <= 0;
        if (nextBtn) nextBtn.disabled = state.loading || state.offset + state.limit >= total;
        if (countBadge) countBadge.textContent = String(total);
    };

    const renderTable = () => {
        if (state.loading) {
            tableBody.innerHTML = '<tr><td colspan="6" class="py-5 text-secondary text-center">Loading closed accounts...</td></tr>';
            renderPagination();
            return;
        }
        if (state.errorMessage) {
            tableBody.innerHTML = `<tr><td colspan="6" class="py-5 text-danger text-center">${escapeHtml(state.errorMessage)}</td></tr>`;
            renderPagination();
            return;
        }
        if (!state.items.length) {
            tableBody.innerHTML = `<tr><td colspan="6" class="py-5 text-secondary text-center">${state.search ? 'No closed accounts matched your search.' : 'No closed accounts found.'}</td></tr>`;
            renderPagination();
            return;
        }

        tableBody.innerHTML = state.items.map((item) => {
            const accountNumber = String(item?.accountNumber || '-').trim() || '-';
            const customerName = String(item?.customerName || `Account ${accountNumber}`).trim();
            const contact = String(item?.contactNumber || 'No contact saved').trim();
            const planName = String(item?.planName || 'No plan').trim();
            const areaName = String(item?.areaName || 'No area').trim();
            const stateLabel = item?.state === 'failed'
                ? 'Needs review'
                : (item?.state === 'closing' ? 'Closing' : 'Closed');
            const stateClass = item?.state === 'failed'
                ? 'badge bg-danger-lt text-danger'
                : 'badge bg-success-lt text-success';
            const legacyFinalBalance = readMoney(item?.finalBalance) ?? 0;
            const requestedFinalBalance = readMoney(item?.requestedFinalBalance);
            // Final Balance is the immutable closure audit snapshot. The live
            // remaining balance may change later through retained-debt payments.
            const closureFinalBalance = readMoney(item?.finalClosedCustomerBalance)
                ?? readMoney(item?.closureFinalBalance)
                ?? requestedFinalBalance
                ?? legacyFinalBalance;
            const liveRemainingBalance = readMoney(item?.remainingBalance);
            const remainingBalance = item?.balanceAvailable === true
                && liveRemainingBalance !== null
                ? liveRemainingBalance
                : legacyFinalBalance;
            const balanceTreatment = String(item?.balanceTreatment || '').trim().toLowerCase();
            const retryFinalBalance = requestedFinalBalance
                ?? (balanceTreatment === 'write-off' ? 0 : closureFinalBalance);
            const liveBalanceChanged = item?.balanceAvailable === true
                && Math.abs(remainingBalance - closureFinalBalance) > 0.005;
            let liveBalanceMeta = '';
            if (item?.balanceAvailable === false) {
                liveBalanceMeta = String(item?.balanceWarning || 'Current balance unavailable; showing closure snapshot');
            } else if (liveBalanceChanged) {
                liveBalanceMeta = remainingBalance < -0.005
                    ? `Current advance credit ${formatMoney(remainingBalance)}`
                    : (balanceTreatment === 'keep' && remainingBalance <= 0.005
                        ? 'Final Closed Balance paid in full'
                        : `Current closed balance ${formatMoney(remainingBalance)}`);
            } else if (balanceTreatment === 'keep') {
                liveBalanceMeta = remainingBalance > 0.005
                    ? 'Available for Closed Account Collection'
                    : 'Final Closed Balance paid in full';
            }
            const retryAction = item?.state === 'failed'
                ? `
                    <button type="button" class="btn btn-icon btn-outline-warning btn-sm" data-action="retry-close" data-closure-id="${escapeHtml(item?.id)}" data-account-number="${escapeHtml(accountNumber)}" data-customer-name="${escapeHtml(customerName)}" data-closure-date="${escapeHtml(item?.closureDate)}" data-reason="${escapeHtml(item?.reason)}" data-final-balance="${escapeHtml(retryFinalBalance.toFixed(2))}" title="Retry account closure" aria-label="Retry account closure for ${escapeHtml(customerName)}" ${state.retryingClosureId === String(item?.id || '').trim() ? 'disabled' : ''}>
                        <i class="ti ti-refresh" aria-hidden="true"></i>
                    </button>
                `
                : '';
            return `
                <tr data-closure-id="${escapeHtml(item?.id)}">
                    <td class="text-nowrap"><span class="badge bg-blue-lt text-blue font-monospace">${escapeHtml(accountNumber)}</span></td>
                    <td>
                        <div class="d-flex align-items-center gap-2 min-w-0">
                            <span class="avatar avatar-sm bg-primary-lt text-primary">${escapeHtml(getInitials(customerName))}</span>
                            <div class="min-w-0">
                                <p class="fw-semibold mb-0 text-truncate">${escapeHtml(customerName)}</p>
                                <p class="d-flex flex-wrap align-items-center gap-1 text-secondary small mt-1 mb-0"><span>${escapeHtml(contact)}</span><span class="${stateClass}">${escapeHtml(stateLabel)}</span></p>
                            </div>
                        </div>
                    </td>
                    <td><p class="fw-semibold mb-0">${escapeHtml(planName)}</p><p class="text-secondary small mt-1 mb-0">${escapeHtml(areaName)}</p></td>
                    <td>
                        <p class="fw-semibold mb-0">${escapeHtml(formatDate(item?.closureDate || item?.closedAt))}</p>
                        <p class="text-secondary small mt-1 mb-0">${escapeHtml(item?.reason || 'No closure reason saved')}</p>
                        ${item?.closedAt ? `<p class="text-secondary small mt-1 mb-0">Saved ${escapeHtml(formatDateTime(item.closedAt))}</p>` : ''}
                        ${item?.warning ? `<p class="text-danger small mt-1 mb-0">${escapeHtml(item.warning)}</p>` : ''}
                    </td>
                    <td>
                        <p class="fw-semibold mb-0">${escapeHtml(formatBalance(closureFinalBalance))}</p>
                        ${liveBalanceMeta ? `<p class="text-secondary small mt-1 mb-0">${escapeHtml(liveBalanceMeta)}</p>` : ''}
                    </td>
                    <td class="text-end text-nowrap">
                        <div class="d-inline-flex gap-1">
                            <a class="btn btn-icon btn-outline-secondary btn-sm" href="payment-breakdown.html?account=${encodeURIComponent(accountNumber)}" title="View preserved billing history" aria-label="View preserved billing history for ${escapeHtml(customerName)}">
                                <i class="ti ti-receipt-2" aria-hidden="true"></i>
                            </a>
                            ${retryAction}
                            <button type="button" class="btn btn-icon btn-outline-success btn-sm" data-action="reopen-closed" data-closure-id="${escapeHtml(item?.id)}" data-account-number="${escapeHtml(accountNumber)}" data-customer-name="${escapeHtml(customerName)}" data-final-balance="${escapeHtml(remainingBalance)}" title="Reopen account" aria-label="Reopen ${escapeHtml(customerName)}" ${state.reopeningClosureId === String(item?.id || '').trim() ? 'disabled' : ''}>
                                <i class="ti ti-user-check" aria-hidden="true"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        renderPagination();
    };

    async function loadClosedAccounts() {
        if (state.loading) return;
        state.loading = true;
        state.errorMessage = '';
        renderTable();
        try {
            while (true) {
                const params = new URLSearchParams({ limit: String(state.limit), offset: String(state.offset) });
                if (state.search) params.set('search', state.search);
                const payload = await apiFetch(`/api/customers/closed-accounts?${params.toString()}`);
                const total = Number(payload?.total || 0);
                if (state.offset > 0 && total > 0 && state.offset >= total) {
                    state.offset = Math.max(0, Math.floor((total - 1) / state.limit) * state.limit);
                    continue;
                }
                state.items = Array.isArray(payload?.items) ? payload.items : [];
                state.total = total;
                break;
            }
        } catch (error) {
            state.items = [];
            state.total = 0;
            state.errorMessage = error?.message || 'Failed to load closed accounts.';
        } finally {
            state.loading = false;
            renderTable();
        }
    }

    const setReopenError = (message = '') => {
        if (!reopenError) return;
        const text = String(message || '').trim();
        reopenError.textContent = text;
        reopenError.hidden = !text;
    };

    const getReopenModalController = () => window.bootstrap?.Modal?.getOrCreateInstance?.(reopenModal, {
        backdrop: 'static',
        keyboard: false
    }) || null;

    const hideReopenModal = () => {
        getReopenModalController()?.hide();
        if (!window.bootstrap?.Modal) {
            reopenModal?.classList.remove('show');
            reopenModal?.setAttribute('aria-hidden', 'true');
            if (reopenModal) reopenModal.style.display = 'none';
        }
    };

    const renderReopenForm = () => {
        const record = state.reopenRecord || {};
        const finalBalance = Number(record.finalBalance) || 0;
        const action = String(reopenBalanceAction?.value || 'collect-first').trim();
        const hasOutstandingBalance = finalBalance > 0.005;
        const hasAdvanceCredit = finalBalance < -0.005;
        const collectFirstOption = reopenBalanceAction?.querySelector('option[value="collect-first"]');
        const keepOption = reopenBalanceAction?.querySelector('option[value="keep"]');
        const writeOffOption = reopenBalanceAction?.querySelector('option[value="write-off"]');
        if (collectFirstOption) {
            collectFirstOption.disabled = hasAdvanceCredit;
            collectFirstOption.textContent = hasAdvanceCredit
                ? 'Collect first — not applicable to advance credit'
                : 'Collect first — keep service stopped';
        }
        if (keepOption) {
            keepOption.textContent = hasAdvanceCredit
                ? 'Keep advance credit — continue to reconnect'
                : 'Keep outstanding — continue to reconnect';
        }
        if (writeOffOption) writeOffOption.disabled = !hasOutstandingBalance;
        if (hasAdvanceCredit && reopenBalanceAction) {
            reopenBalanceAction.value = 'keep';
        } else if (!hasOutstandingBalance && action === 'write-off' && reopenBalanceAction) {
            reopenBalanceAction.value = 'keep';
        }
        const selectedAction = String(reopenBalanceAction?.value || 'collect-first').trim();
        if (reopenBalanceHint) {
            reopenBalanceHint.textContent = hasAdvanceCredit
                ? 'The advance credit remains on the account. Billing opens with Keep selected, and service stays stopped until reconnection is confirmed.'
                : (selectedAction === 'collect-first'
                ? 'The customer returns as Disabled. Record payment first, then reconnect from Billing.'
                : (selectedAction === 'write-off'
                    ? 'The account returns as Disabled, then Billing opens with Write off selected. Service does not resume until that settlement is confirmed.'
                    : 'The account returns as Disabled, then Billing opens with Keep for collection selected. Service does not resume until that settlement is confirmed.'));
        }
        if (reopenConfirmationLabel) {
            reopenConfirmationLabel.textContent = hasAdvanceCredit
                ? 'I confirm the account will reopen as Disabled and the advance credit will remain on the account.'
                : (selectedAction === 'collect-first'
                ? 'I confirm the account will reopen as Disabled and the retained balance will remain for collection.'
                : 'I confirm the account will reopen as Disabled and I must review the Billing settlement before service resumes.');
        }
        const validReason = String(reopenReason?.value || '').trim().length >= 3;
        if (reopenSubmit) {
            reopenSubmit.disabled = Boolean(state.reopeningClosureId) || !validReason || reopenConfirmed?.checked !== true;
            reopenSubmit.innerHTML = state.reopeningClosureId
                ? '<i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i> Reopening...'
                : (selectedAction === 'collect-first'
                    ? '<i class="ti ti-user-check" aria-hidden="true"></i> Reopen Account'
                    : '<i class="ti ti-arrow-right" aria-hidden="true"></i> Reopen & Continue');
        }
        if (reopenClose) reopenClose.disabled = Boolean(state.reopeningClosureId);
        if (reopenCancel) reopenCancel.disabled = Boolean(state.reopeningClosureId);
    };

    const openReopenModal = ({ closureId, accountNumber, customerName, finalBalance }) => {
        if (!closureId || !reopenModal) return;
        const normalizedFinalBalance = Number(finalBalance) || 0;
        const hasAdvanceCredit = normalizedFinalBalance < -0.005;
        state.reopenRecord = { closureId, accountNumber, customerName, finalBalance: normalizedFinalBalance };
        reopenForm?.reset();
        if (reopenBalanceAction) reopenBalanceAction.value = hasAdvanceCredit ? 'keep' : 'collect-first';
        if (reopenCustomerName) reopenCustomerName.textContent = `${customerName} · Account # ${accountNumber}`;
        if (reopenBalanceLabel) reopenBalanceLabel.textContent = hasAdvanceCredit ? 'Advance credit' : 'Retained balance';
        if (reopenBalance) reopenBalance.textContent = formatMoney(normalizedFinalBalance);
        setReopenError('');
        renderReopenForm();
        const controller = getReopenModalController();
        if (controller) {
            controller.show();
        } else {
            reopenModal.style.display = 'block';
            reopenModal.classList.add('show');
            reopenModal.setAttribute('aria-hidden', 'false');
        }
        window.setTimeout(() => reopenBalanceAction?.focus(), 0);
    };

    const submitReopenAccount = async () => {
        const record = state.reopenRecord || {};
        const closureId = String(record.closureId || '').trim();
        const reason = String(reopenReason?.value || '').trim();
        const balanceAction = String(reopenBalanceAction?.value || 'collect-first').trim();
        if (!closureId || state.reopeningClosureId) return;
        if (reason.length < 3) {
            setReopenError('Enter a reason for reopening this account.');
            reopenReason?.focus();
            return;
        }
        if (reopenConfirmed?.checked !== true) {
            setReopenError('Confirm the selected balance and service action.');
            reopenConfirmed?.focus();
            return;
        }
        state.reopeningClosureId = closureId;
        setReopenError('');
        renderReopenForm();
        try {
            const payload = await apiFetch(`/api/customers/closed-accounts/${encodeURIComponent(closureId)}/reopen`, {
                method: 'POST',
                body: JSON.stringify({ reason, balanceAction })
            });
            notify(payload?.message || `${record.customerName} returned to Customers as Disabled.`, 'success');
            if (payload?.warning) notify(payload.warning, 'warning');
            hideReopenModal();
            state.reopenRecord = null;
            if (payload?.nextUrl) {
                window.location.assign(String(payload.nextUrl));
                return;
            }
            await loadClosedAccounts();
        } catch (error) {
            setReopenError(error?.message || 'Failed to reopen account.');
        } finally {
            state.reopeningClosureId = '';
            renderReopenForm();
            renderTable();
        }
    };

    const confirmRetryClose = async (customerName) => {
        const message = `Retry closing ${customerName}? This continues the same closure audit and preserves the original Final Closed Balance.`;
        if (!window.appConfirm) return window.confirm(message);
        const result = await window.appConfirm(message, { title: 'Retry Account Closure', okText: 'Retry Close' });
        return result && typeof result === 'object'
            ? result.ok === true || result.confirmed === true || result.value === true
            : result === true;
    };

    const retryCloseAccount = async ({ closureId, accountNumber, customerName, closureDate, reason, finalBalance }) => {
        if (!closureId || !accountNumber || state.retryingClosureId) return;
        if (!await confirmRetryClose(customerName)) return;
        state.retryingClosureId = closureId;
        renderTable();
        try {
            const payload = await apiFetch(`/api/customers/${encodeURIComponent(accountNumber)}/close-account`, {
                method: 'POST',
                body: JSON.stringify({
                    closureDate,
                    reason,
                    finalBalance
                })
            });
            notify(`${customerName} is closed. Billing stopped and all history was preserved.`, 'success');
            if (payload?.warning) notify(payload.warning, 'warning');
        } catch (error) {
            notify(error?.message || 'Failed to retry account closure.', 'error');
        } finally {
            state.retryingClosureId = '';
            await loadClosedAccounts();
        }
    };

    tabButtons.forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.archiveTab)));
    let searchTimer = null;
    searchInput?.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
            state.search = String(searchInput.value || '').trim();
            state.offset = 0;
            void loadClosedAccounts();
        }, 220);
    });
    pageSizeSelect.addEventListener('change', () => {
        state.limit = Number(pageSizeSelect.value || 10) || 10;
        state.offset = 0;
        void loadClosedAccounts();
    });
    prevBtn?.addEventListener('click', () => {
        if (state.loading || state.offset <= 0) return;
        state.offset = Math.max(0, state.offset - state.limit);
        void loadClosedAccounts();
    });
    nextBtn?.addEventListener('click', () => {
        if (state.loading || state.offset + state.limit >= state.total) return;
        state.offset += state.limit;
        void loadClosedAccounts();
    });
    tableBody.addEventListener('click', (event) => {
        const retryButton = event.target.closest('[data-action="retry-close"]');
        if (retryButton) {
            void retryCloseAccount({
                closureId: String(retryButton.dataset.closureId || '').trim(),
                accountNumber: String(retryButton.dataset.accountNumber || '').trim(),
                customerName: String(retryButton.dataset.customerName || 'this account').trim(),
                closureDate: String(retryButton.dataset.closureDate || '').trim(),
                reason: String(retryButton.dataset.reason || '').trim(),
                finalBalance: Number(retryButton.dataset.finalBalance)
            });
            return;
        }
        const button = event.target.closest('[data-action="reopen-closed"]');
        if (!button) return;
        openReopenModal({
            closureId: String(button.dataset.closureId || '').trim(),
            accountNumber: String(button.dataset.accountNumber || '').trim(),
            customerName: String(button.dataset.customerName || 'this account').trim(),
            finalBalance: Number(button.dataset.finalBalance) || 0
        });
    });

    reopenForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        void submitReopenAccount();
    });
    reopenBalanceAction?.addEventListener('change', () => {
        if (reopenConfirmed) reopenConfirmed.checked = false;
        setReopenError('');
        renderReopenForm();
    });
    reopenReason?.addEventListener('input', renderReopenForm);
    reopenConfirmed?.addEventListener('change', renderReopenForm);
    const clearReopenState = () => {
        if (state.reopeningClosureId) return;
        state.reopenRecord = null;
        setReopenError('');
    };
    const closeReopenModal = () => {
        if (state.reopeningClosureId) return;
        hideReopenModal();
        clearReopenState();
    };
    reopenClose?.addEventListener('click', closeReopenModal);
    reopenCancel?.addEventListener('click', closeReopenModal);
    reopenModal?.addEventListener('hidden.bs.modal', clearReopenState);

    const initialTab = window.location.hash === '#closed-accounts' ? 'closed' : 'deleted';
    activateTab(initialTab, { updateHash: false });
    void loadClosedAccounts();
})();
