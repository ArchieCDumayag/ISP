(() => {
    const tableBody = document.getElementById('archiveTableBody');
    const searchInput = document.getElementById('archiveSearch');
    const pageSizeSelect = document.getElementById('archivePageSize');
    const prevBtn = document.getElementById('archivePrev');
    const nextBtn = document.getElementById('archiveNext');
    const pageInfo = document.getElementById('archivePageInfo');
    const summary = document.getElementById('archiveSummary');
    const selectAllInput = document.getElementById('archiveSelectAll');
    const deleteSelectedBtn = document.getElementById('archiveDeleteSelectedBtn');

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
        selectedIds: new Set(),
        selectedMeta: new Map()
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
            deleteSelectedBtn.innerHTML = state.bulkDeleteInProgress
                ? '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...'
                : `<i class="fa-solid fa-trash"></i> Delete selected${selectedCount ? ` (${selectedCount})` : ''}`;
        }
    };

    const renderTable = () => {
        if (state.loading) {
            tableBody.innerHTML = `<tr><td colspan="${COLUMN_COUNT}" class="archive-empty">Loading archived records...</td></tr>`;
            renderSelectionUi();
            return;
        }

        if (state.errorMessage) {
            tableBody.innerHTML = `<tr><td colspan="${COLUMN_COUNT}" class="archive-empty">${escapeHtml(state.errorMessage)}</td></tr>`;
            renderSelectionUi();
            return;
        }

        if (!state.items.length) {
            tableBody.innerHTML = `<tr><td colspan="${COLUMN_COUNT}" class="archive-empty">${
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
            const countdownClass = daysRemaining <= 3 ? 'archive-pill archive-pill--danger' : 'archive-pill archive-pill--warn';
            const restoreConfig = getArchiveRestoreConfig(recordType);
            const isSelected = state.selectedIds.has(archiveId);
            return `
                <tr data-archive-id="${escapeHtml(archiveId)}">
                    <td class="select-col">
                        <input
                            type="checkbox"
                            class="archive-row-select"
                            data-archive-select="${escapeHtml(archiveId)}"
                            aria-label="Select ${escapeHtml(customerName)}"
                            ${isSelected ? 'checked' : ''}
                        >
                    </td>
                    <td class="account-col">
                        <span class="account-tag">${escapeHtml(accountNumber)}</span>
                    </td>
                    <td>
                        <div class="archive-subscriber">
                            <span class="avatar">${escapeHtml(getInitials(customerName))}</span>
                            <div class="archive-subscriber__body">
                                <p class="subscriber-name">${escapeHtml(customerName)}</p>
                                <p class="subscriber-meta">
                                    <span>${escapeHtml(contact)}</span>
                                    <span class="archive-status-pill">${escapeHtml(getArchiveStatusLabel(recordType))}</span>
                                </p>
                            </div>
                        </div>
                    </td>
                    <td>
                        <p class="archive-plan-name">${escapeHtml(planName)}</p>
                        <p class="archive-plan-meta">${escapeHtml(areaName)}</p>
                    </td>
                    <td>
                        <p class="archive-date">${escapeHtml(formatDate(item?.deletedAt))}</p>
                        <p class="archive-time">${escapeHtml(formatTime(item?.deletedAt) || 'Time unavailable')}</p>
                    </td>
                    <td>
                        <span class="${countdownClass}">
                            <i class="fa-regular fa-clock" aria-hidden="true"></i>
                            ${escapeHtml(formatCountdown(daysRemaining))}
                        </span>
                        <p class="archive-countdown-note">
                            Deletes on ${escapeHtml(formatDate(item?.purgeAfter))}${formatTime(item?.purgeAfter) ? `, ${escapeHtml(formatTime(item?.purgeAfter))}` : ''}
                        </p>
                    </td>
                    <td class="actions-col">
                        <div class="archive-actions">
                            <button
                                type="button"
                                class="archive-icon-btn archive-icon-btn--restore"
                                data-action="restore"
                                data-archive-id="${escapeHtml(archiveId)}"
                                data-customer-name="${escapeHtml(customerName)}"
                                data-account-number="${escapeHtml(accountNumber)}"
                                data-record-type="${escapeHtml(recordType)}"
                                title="${escapeHtml(restoreConfig.title)}"
                                aria-label="${escapeHtml(restoreConfig.title)}"
                            >
                                <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
                            </button>
                            <button
                                type="button"
                                class="archive-icon-btn archive-icon-btn--delete"
                                data-action="delete"
                                data-archive-id="${escapeHtml(archiveId)}"
                                data-customer-name="${escapeHtml(customerName)}"
                                data-account-number="${escapeHtml(accountNumber)}"
                                data-record-type="${escapeHtml(recordType)}"
                                title="Delete permanently"
                                aria-label="Delete permanently"
                            >
                                <i class="fa-solid fa-trash" aria-hidden="true"></i>
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
    };

    const render = () => {
        renderTable();
        renderPagination();
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
        if (window.appConfirm) {
            return window.appConfirm(message, options);
        }
        return window.confirm(message);
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

        await apiFetch(`/api/customers/archive/${encodeURIComponent(normalizedId)}`, {
            method: 'DELETE'
        });
        forgetArchiveItem(normalizedId);
        return true;
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
        renderSelectionUi();

        const results = await Promise.allSettled(selectedIds.map(async (archiveId) => {
            const meta = state.selectedMeta.get(archiveId) || { archiveId };
            await deleteArchivedCustomer({
                archiveId,
                customerName: meta.customerName,
                accountNumber: meta.accountNumber,
                skipConfirm: true
            });
            return archiveId;
        }));

        const succeededIds = [];
        const failedResults = [];
        results.forEach((result) => {
            if (result.status === 'fulfilled') {
                succeededIds.push(result.value);
            } else {
                failedResults.push(result.reason);
            }
        });

        succeededIds.forEach((archiveId) => forgetArchiveItem(archiveId));
        state.bulkDeleteInProgress = false;

        if (succeededIds.length && failedResults.length) {
            notify(`${formatArchiveCollection(succeededIds.length)} deleted. ${failedResults.length} failed.`, 'warning');
        } else if (succeededIds.length) {
            notify(`${formatArchiveCollection(succeededIds.length)} deleted.`, 'success');
        } else if (failedResults.length) {
            notify(failedResults[0]?.message || 'Failed to delete selected archived records.', 'error');
        }

        await loadArchives();
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
            const deleted = await deleteArchivedCustomer({ archiveId, customerName, accountNumber });
            if (!deleted) return;
            notify(`${formatArchiveLabel({ customerName, accountNumber })} permanently deleted from archive.`, 'success');
            await loadArchives();
        } catch (error) {
            notify(error.message || 'Failed to permanently delete archived record.', 'error');
        }
    });

    loadArchives();
})();
