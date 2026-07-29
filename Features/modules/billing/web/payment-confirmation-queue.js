document.addEventListener('DOMContentLoaded', () => {
    const queueTableBody = document.getElementById('queueTableBody');
    const pageSizeSelect = document.getElementById('queuePageSize');
    const footerSummary = document.getElementById('queueTableSummary');
    const footerPageInfo = document.getElementById('queueTablePageInfo');
    const footerPrevBtn = document.getElementById('queueTablePrev');
    const footerNextBtn = document.getElementById('queueTableNext');
    const queueLiveView = document.getElementById('queueLiveView');
    const queueHistoryView = document.getElementById('queueHistoryView');
    const queueViewQueueBtn = document.getElementById('queueViewQueueBtn');
    const queueViewHistoryBtn = document.getElementById('queueViewHistoryBtn');
    const accountFilter = document.getElementById('queueAccountFilter');
    const historyAccountFilter = document.getElementById('queueHistoryAccountFilter');
    const historyApprovedBody = document.getElementById('queueHistoryApprovedBody');
    const historyRejectedBody = document.getElementById('queueHistoryRejectedBody');
    const historyApprovedCount = document.getElementById('queueHistoryApprovedCount');
    const historyRejectedCount = document.getElementById('queueHistoryRejectedCount');
    const createModal = document.getElementById('queueCreateModal');
    const createForm = document.getElementById('queueCreateForm');
    const createAccountInput = document.getElementById('queueCreateAccountNumber');
    const createCustomerInput = document.getElementById('queueCreateCustomerName');
    const createAmountInput = document.getElementById('queueCreateAmount');
    const createReferenceInput = document.getElementById('queueCreateReference');
    const createMethodInput = document.getElementById('queueCreatePaymentMethod');
    const createProofFileInput = document.getElementById('queueCreateProofFile');
    const createNotesInput = document.getElementById('queueCreateNotes');
    const createSubmitBtn = document.getElementById('queueCreateSubmitBtn');
    const approveModal = document.getElementById('queueApproveModal');
    const approveMeta = document.getElementById('queueApproveMeta');
    const approveProofViewer = document.getElementById('queueApproveProofViewer');
    const approveProofToolbar = document.getElementById('queueApproveProofToolbar');
    const approveProofLink = document.getElementById('queueApproveProofLink');
    const approveProofViewport = document.getElementById('queueApproveProofViewport');
    const approveProofImage = document.getElementById('queueApproveProofImage');
    const approveProofZoomLevel = document.getElementById('queueApproveProofZoomLevel');
    const approveProofEmpty = document.getElementById('queueApproveProofEmpty');
    const approveAmountInput = document.getElementById('queueApproveAmountInput');
    const approveReferenceInput = document.getElementById('queueApproveReferenceInput');
    const approveSubmitBtn = document.getElementById('queueApproveSubmitBtn');
    const duplicatePaymentModal = document.getElementById('queueDuplicatePaymentModal');
    const duplicatePaymentMeta = document.getElementById('queueDuplicatePaymentMeta');
    const duplicateCustomer = document.getElementById('queueDuplicateCustomer');
    const duplicateAccount = document.getElementById('queueDuplicateAccount');
    const duplicateReference = document.getElementById('queueDuplicateReference');
    const duplicateAmount = document.getElementById('queueDuplicateAmount');
    const duplicateDate = document.getElementById('queueDuplicateDate');
    const duplicateRecordedBy = document.getElementById('queueDuplicateRecordedBy');
    const rejectEntryModal = document.getElementById('queueRejectEntryModal');
    const rejectEntryMeta = document.getElementById('queueRejectEntryMeta');
    const rejectReasonInput = document.getElementById('queueRejectReasonInput');
    const rejectSubmitBtn = document.getElementById('queueRejectSubmitBtn');
    const rejectInfoModal = document.getElementById('queueRejectInfoModal');
    const rejectMeta = document.getElementById('queueRejectMeta');
    const rejectReasonText = document.getElementById('queueRejectReasonText');

    const savedPageSize = Number(localStorage.getItem('paymentQueuePageSize'));
    const initialPageSize = Array.from(pageSizeSelect?.options || []).some((option) => Number(option.value) === savedPageSize)
        ? savedPageSize
        : Number(pageSizeSelect?.value || 10);

    const state = {
        currentView: 'queue',
        status: 'pending',
        searchTerm: '',
        historyAccountNumber: '',
        loading: false,
        queueItems: [],
        itemsById: new Map(),
        renderedItems: [],
        activeApprovalId: '',
        activeRejectId: '',
        activeRejectedId: '',
        approveProofZoom: 1,
        approveProofBaseWidth: 0,
        approveProofPanning: false,
        approveProofDragged: false,
        approveProofPanStartX: 0,
        approveProofPanStartY: 0,
        approveProofPanScrollLeft: 0,
        approveProofPanScrollTop: 0,
        pagination: {
            page: 1,
            pageSize: initialPageSize
        }
    };

    const PROOF_ZOOM_MIN = 1;
    const PROOF_ZOOM_MAX = 4;
    const PROOF_ZOOM_STEP = 0.25;

    if (pageSizeSelect) {
        pageSizeSelect.value = String(state.pagination.pageSize);
    }


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

    const escapeHtml = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const getCustomerInitials = (fullName) => {
        const rawName = String(fullName || '').trim();
        if (!rawName) return 'NA';
        const parts = rawName.split(/\s+/).filter(Boolean);
        if (!parts.length) return 'NA';
        if (parts.length === 1) {
            return parts[0].slice(0, 2).toUpperCase();
        }
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
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

    const getQueueItemById = (id) => state.itemsById.get(String(id || '')) || null;

    const getQueueItemByRowIndex = (rowIndexText) => {
        const rowIndex = Number(rowIndexText);
        if (!Number.isInteger(rowIndex) || rowIndex < 0) return null;
        return state.renderedItems[rowIndex] || null;
    };

    const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
        if (!file) {
            reject(new Error('Proof image is required.'));
            return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('Unable to read proof image.'));
        reader.readAsDataURL(file);
    });

    const clampProofZoom = (value) => {
        const zoom = Number(value);
        if (!Number.isFinite(zoom)) return PROOF_ZOOM_MIN;
        return Math.min(PROOF_ZOOM_MAX, Math.max(PROOF_ZOOM_MIN, zoom));
    };

    const getApproveProofBaseWidth = () => {
        if (state.approveProofBaseWidth > 0) return state.approveProofBaseWidth;
        const measuredWidth = approveProofImage?.getBoundingClientRect().width || approveProofViewport?.clientWidth || 0;
        state.approveProofBaseWidth = measuredWidth > 0 ? measuredWidth : 0;
        return state.approveProofBaseWidth;
    };

    const updateApproveProofZoom = (nextZoom, options = {}) => {
        const previousZoom = state.approveProofZoom || PROOF_ZOOM_MIN;
        const zoom = clampProofZoom(nextZoom);
        const viewport = approveProofViewport;
        const centerX = viewport ? viewport.scrollLeft + (viewport.clientWidth / 2) : 0;
        const centerY = viewport ? viewport.scrollTop + (viewport.clientHeight / 2) : 0;

        state.approveProofZoom = zoom;

        if (approveProofImage) {
            if (zoom > PROOF_ZOOM_MIN) {
                const baseWidth = getApproveProofBaseWidth();
                if (baseWidth > 0) {
                    approveProofImage.style.width = `${Math.round(baseWidth * zoom)}px`;
                }
                approveProofImage.classList.add('is-zoomed');
            } else {
                approveProofImage.style.width = '';
                approveProofImage.classList.remove('is-zoomed');
                state.approveProofBaseWidth = 0;
            }
        }

        if (approveProofZoomLevel) {
            approveProofZoomLevel.textContent = `${Math.round(zoom * 100)}%`;
        }
        if (approveProofViewport) {
            approveProofViewport.classList.toggle('is-pannable', zoom > PROOF_ZOOM_MIN);
        }

        if (!viewport) return;
        if (zoom <= PROOF_ZOOM_MIN) {
            viewport.scrollLeft = 0;
            viewport.scrollTop = 0;
            return;
        }
        if (options.preserveCenter === false) return;

        const ratio = previousZoom > 0 ? zoom / previousZoom : zoom;
        viewport.scrollLeft = Math.max(0, (centerX * ratio) - (viewport.clientWidth / 2));
        viewport.scrollTop = Math.max(0, (centerY * ratio) - (viewport.clientHeight / 2));
    };

    const resetApproveProofZoom = () => {
        state.approveProofBaseWidth = 0;
        state.approveProofPanning = false;
        state.approveProofDragged = false;
        approveProofViewport?.classList.remove('is-panning');
        updateApproveProofZoom(PROOF_ZOOM_MIN, { preserveCenter: false });
    };

    const stopApproveProofPan = () => {
        if (!state.approveProofPanning) return;
        state.approveProofPanning = false;
        approveProofViewport?.classList.remove('is-panning');
    };

    const closeCreateModal = () => {
        if (!createModal) return;
        createModal.classList.remove('show');
        createModal.setAttribute('aria-hidden', 'true');
        if (createForm) createForm.reset();
        if (!document.querySelector('.modal.show')) {
            document.body.classList.remove('modal-active');
        }
    };

    const openCreateModal = () => {
        if (!createModal) return;
        createModal.classList.add('show');
        createModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-active');
        window.setTimeout(() => {
            createAccountInput?.focus({ preventScroll: true });
        }, 0);
    };

    const closeApproveModal = () => {
        if (!approveModal) return;
        approveModal.classList.remove('show');
        approveModal.setAttribute('aria-hidden', 'true');
        state.activeApprovalId = '';
        if (approveAmountInput) approveAmountInput.value = '';
        if (approveReferenceInput) approveReferenceInput.value = '';
        if (approveMeta) approveMeta.textContent = '';
        resetApproveProofZoom();
        if (approveProofViewer) approveProofViewer.style.display = '';
        if (approveProofImage) approveProofImage.removeAttribute('src');
        if (approveProofLink) {
            approveProofLink.removeAttribute('href');
            approveProofLink.style.display = '';
        }
        if (approveProofEmpty) approveProofEmpty.hidden = true;
        if (!document.querySelector('.modal.show')) {
            document.body.classList.remove('modal-active');
        }
    };

    const closeDuplicatePaymentModal = () => {
        if (!duplicatePaymentModal) return;
        duplicatePaymentModal.classList.remove('show');
        duplicatePaymentModal.setAttribute('aria-hidden', 'true');
        if (duplicatePaymentMeta) duplicatePaymentMeta.textContent = '';
        if (duplicateCustomer) duplicateCustomer.textContent = '-';
        if (duplicateAccount) duplicateAccount.textContent = '-';
        if (duplicateReference) duplicateReference.textContent = '-';
        if (duplicateAmount) duplicateAmount.textContent = '-';
        if (duplicateDate) duplicateDate.textContent = '-';
        if (duplicateRecordedBy) duplicateRecordedBy.textContent = '-';
        if (!document.querySelector('.modal.show')) {
            document.body.classList.remove('modal-active');
        }
    };

    const openDuplicatePaymentModal = (duplicate = {}) => {
        if (!duplicatePaymentModal) return;
        const customerName = String(duplicate.customerName || '').trim() || 'Unknown customer';
        const accountNumber = String(duplicate.accountNumber || '').trim();
        const reference = String(duplicate.reference || '').trim();
        if (duplicatePaymentMeta) {
            duplicatePaymentMeta.textContent = reference
                ? `Doubled ref: ${reference}`
                : 'Duplicate payment reference';
        }
        if (duplicateCustomer) duplicateCustomer.textContent = customerName;
        if (duplicateAccount) duplicateAccount.textContent = accountNumber || '-';
        if (duplicateReference) duplicateReference.textContent = reference || '-';
        if (duplicateAmount) duplicateAmount.textContent = formatCurrency(Number(duplicate.amount));
        if (duplicateDate) duplicateDate.textContent = formatDateTime(duplicate.recordedAt || duplicate.date);
        if (duplicateRecordedBy) duplicateRecordedBy.textContent = String(duplicate.recordedBy || '').trim() || '-';
        duplicatePaymentModal.classList.add('show');
        duplicatePaymentModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-active');
    };

    const closeRejectEntryModal = () => {
        if (!rejectEntryModal) return;
        rejectEntryModal.classList.remove('show');
        rejectEntryModal.setAttribute('aria-hidden', 'true');
        state.activeRejectId = '';
        if (rejectEntryMeta) rejectEntryMeta.textContent = '';
        if (rejectReasonInput) rejectReasonInput.value = '';
        if (!document.querySelector('.modal.show')) {
            document.body.classList.remove('modal-active');
        }
    };

    const closeRejectInfoModal = () => {
        if (!rejectInfoModal) return;
        rejectInfoModal.classList.remove('show');
        rejectInfoModal.setAttribute('aria-hidden', 'true');
        state.activeRejectedId = '';
        if (rejectMeta) rejectMeta.textContent = '';
        if (rejectReasonText) rejectReasonText.textContent = 'No reason provided.';
        if (!document.querySelector('.modal.show')) {
            document.body.classList.remove('modal-active');
        }
    };

    const openApproveModal = (item) => {
        if (!approveModal || !item) return;
        const itemId = String(item.id || '').trim();
        if (!itemId) return;

        state.activeApprovalId = itemId;
        const customerName = String(item.customerName || '').trim() || 'Unknown customer';
        const accountNumber = String(item.accountNumber || '').trim();
        const resolvedAmount = Number(item.reviewedAmount ?? item.amount);
        const amountLabel = formatCurrency(resolvedAmount);
        if (approveMeta) {
            const parts = [customerName];
            if (accountNumber) parts.push(`Acct: ${accountNumber}`);
            if (amountLabel && amountLabel !== '-') parts.push(amountLabel);
            approveMeta.textContent = parts.join(' | ');
        }

        if (approveAmountInput) {
            approveAmountInput.value = Number.isFinite(resolvedAmount) && resolvedAmount > 0
                ? resolvedAmount.toFixed(2)
                : '';
        }

        if (approveReferenceInput) {
            approveReferenceInput.value = String(item.reviewedReference || '').trim();
        }

        const proofUrl = String(item.proofUrl || '').trim();
        if (proofUrl) {
            if (approveProofViewer) {
                approveProofViewer.style.display = '';
            }
            resetApproveProofZoom();
            if (approveProofLink) {
                approveProofLink.href = proofUrl;
                approveProofLink.style.display = '';
            }
            if (approveProofImage) {
                approveProofImage.src = proofUrl;
            }
            if (approveProofEmpty) approveProofEmpty.hidden = true;
        } else {
            resetApproveProofZoom();
            if (approveProofViewer) {
                approveProofViewer.style.display = 'none';
            }
            if (approveProofLink) {
                approveProofLink.removeAttribute('href');
                approveProofLink.style.display = 'none';
            }
            if (approveProofImage) {
                approveProofImage.removeAttribute('src');
            }
            if (approveProofEmpty) approveProofEmpty.hidden = false;
        }

        approveModal.classList.add('show');
        approveModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-active');
        window.setTimeout(() => {
            approveAmountInput?.focus({ preventScroll: true });
        }, 0);
    };

    const openRejectEntryModal = (item) => {
        if (!rejectEntryModal || !item) return;
        const itemId = String(item.id || '').trim();
        if (!itemId) return;

        state.activeRejectId = itemId;
        const customerName = String(item.customerName || '').trim() || 'Unknown customer';
        const accountNumber = String(item.accountNumber || '').trim();
        const amountLabel = formatCurrency(Number(item.reviewedAmount ?? item.amount));
        if (rejectEntryMeta) {
            const parts = [`Customer: ${customerName}`];
            if (accountNumber) parts.push(`Acct: ${accountNumber}`);
            if (amountLabel && amountLabel !== '-') parts.push(`Amount: ${amountLabel}`);
            rejectEntryMeta.textContent = parts.join(' | ');
        }
        if (rejectReasonInput) {
            rejectReasonInput.value = '';
        }

        rejectEntryModal.classList.add('show');
        rejectEntryModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-active');
        window.setTimeout(() => {
            rejectReasonInput?.focus({ preventScroll: true });
        }, 0);
    };

    const openRejectInfoModal = (item) => {
        if (!rejectInfoModal || !item) return;
        const itemId = String(item.id || '').trim();
        if (!itemId) return;

        state.activeRejectedId = itemId;
        const customerName = String(item.customerName || '').trim() || 'Unknown customer';
        const accountNumber = String(item.accountNumber || '').trim();
        const amountLabel = formatCurrency(Number(item.reviewedAmount ?? item.amount));
        if (rejectMeta) {
            const parts = [customerName];
            if (accountNumber) parts.push(`Acct: ${accountNumber}`);
            if (amountLabel && amountLabel !== '-') parts.push(amountLabel);
            rejectMeta.textContent = parts.join(' | ');
        }

        const reason = String(item.decisionReason || '').trim();
        if (rejectReasonText) {
            rejectReasonText.textContent = reason || 'No reason provided.';
        }

        rejectInfoModal.classList.add('show');
        rejectInfoModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-active');
    };

    const setLoadingState = (loading) => {
        state.loading = loading;
    };

    const renderFooter = (total, pageCount, startIndex, pageItemsLength) => {
        if (footerSummary) {
            if (!total) {
                footerSummary.textContent = 'Showing 0 of 0 requests';
            } else {
                const start = startIndex + 1;
                const end = startIndex + pageItemsLength;
                footerSummary.textContent = `Showing ${start}-${end} of ${total} requests`;
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

    const applyQueueFilters = () => {
        state.status = 'pending';
        state.searchTerm = String(accountFilter?.value || '').trim();
    };

    const buildQueryString = () => {
        const params = new URLSearchParams();
        if (state.status) params.set('status', state.status);
        if (state.searchTerm) params.set('search', state.searchTerm);
        params.set('limit', '1000');
        params.set('offset', '0');
        return params.toString();
    };

    const buildHistoryQueryString = (status) => {
        const params = new URLSearchParams();
        params.set('status', status);
        if (state.historyAccountNumber) params.set('accountNumber', state.historyAccountNumber);
        params.set('limit', '200');
        params.set('offset', '0');
        return params.toString();
    };

    const setQueueView = (view = 'queue') => {
        const target = String(view || '').trim().toLowerCase() === 'history' ? 'history' : 'queue';
        state.currentView = target;

        if (queueLiveView) queueLiveView.style.display = target === 'queue' ? '' : 'none';
        if (queueHistoryView) queueHistoryView.style.display = target === 'history' ? '' : 'none';

        queueViewQueueBtn?.classList.toggle('active', target === 'queue');
        queueViewHistoryBtn?.classList.toggle('active', target === 'history');
        queueViewQueueBtn?.setAttribute('aria-pressed', target === 'queue' ? 'true' : 'false');
        queueViewHistoryBtn?.setAttribute('aria-pressed', target === 'history' ? 'true' : 'false');

        if (target === 'history') {
            fetchHistory();
        } else {
            fetchQueue();
        }
    };

    const fetchQueue = async () => {
        setLoadingState(true);
        try {
            const response = await fetch(`/api/payment-confirmations?${buildQueryString()}`, {
                credentials: 'include',
                cache: 'no-store'
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'Failed to load payment confirmation queue.');
            }
            const fetchedItems = Array.isArray(data.items) ? data.items : [];
            renderRows(fetchedItems);
        } catch (error) {
            renderError(error.message || 'Unable to load queue');
        } finally {
            setLoadingState(false);
        }
    };

    const renderError = (message) => {
        if (!queueTableBody) return;
        state.queueItems = [];
        state.itemsById = new Map();
        state.renderedItems = [];
        state.pagination.page = 1;
        renderFooter(0, 1, 0, 0);
        queueTableBody.innerHTML = `
            <tr>
                <td colspan="5" class="queue-empty">${escapeHtml(message || 'Something went wrong.')}</td>
            </tr>
        `;
    };

    const renderRows = (items) => {
        if (!queueTableBody) return;
        const rows = Array.isArray(items) ? items : [];
        state.queueItems = rows.slice();
        state.itemsById = new Map(
            rows.map((item) => [String(item?.id || ''), item])
        );
        const total = rows.length;
        const pageSize = state.pagination.pageSize || 10;
        const pageCount = total ? Math.ceil(total / pageSize) : 1;
        state.pagination.page = Math.min(Math.max(state.pagination.page, 1), pageCount);
        const startIndex = total ? (state.pagination.page - 1) * pageSize : 0;
        const pageRows = total ? rows.slice(startIndex, startIndex + pageSize) : [];
        state.renderedItems = pageRows.slice();
        renderFooter(total, pageCount, startIndex, pageRows.length);
        if (!pageRows.length) {
            queueTableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="queue-empty">No requests found for this filter.</td>
                </tr>
            `;
            return;
        }

        queueTableBody.innerHTML = pageRows.map((item, rowIndex) => {
            const status = String(item.status || 'pending').toLowerCase();
            const isPending = status === 'pending';
            const isRejected = status === 'rejected';
            const proofUrl = String(item.proofUrl || '').trim();
            const proofCell = proofUrl
                ? `<a class="queue-proof-thumb-link" href="${escapeHtml(proofUrl)}" target="_blank" rel="noopener">
                        <img class="queue-proof-thumb" src="${escapeHtml(proofUrl)}" alt="Payment proof image">
                   </a>`
                : `<span class="queue-empty">No image</span>`;
            const resolvedAmount = Number(item.reviewedAmount ?? item.amount);
            const amountCell = formatCurrency(resolvedAmount);

            const actionCell = (() => {
                if (isPending) {
                    return `<div class="queue-row-actions">
                        <button type="button" class="approve-btn queue-icon-btn" data-action="approve" data-id="${escapeHtml(item.id)}" data-row-index="${rowIndex}" title="Approve" aria-label="Approve payment proof">
                            <i class="fa-solid fa-check"></i>
                        </button>
                        <button type="button" class="reject-btn queue-icon-btn" data-action="reject" data-id="${escapeHtml(item.id)}" data-row-index="${rowIndex}" title="Reject" aria-label="Reject payment proof">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>`;
                }
                if (isRejected) {
                    return `<div class="queue-action-result rejected">
                        <span class="queue-status rejected">Rejected</span>
                        <button type="button" class="view-reason-btn queue-icon-btn" data-action="view-reason" data-id="${escapeHtml(item.id)}" data-row-index="${rowIndex}" title="View reason" aria-label="View rejection reason">
                            <i class="fa-solid fa-circle-info"></i>
                        </button>
                    </div>`;
                }
                return `<div class="queue-action-result approved">
                    <span class="queue-status approved">Approved</span>
                </div>`;
            })();

            const customerName = String(item.customerName || '').trim() || 'Unknown customer';
            const accountNumber = String(item.accountNumber || '').trim();
            const customerInitials = getCustomerInitials(customerName);
            const customerMeta = accountNumber
                ? `<div class="queue-customer-name">${escapeHtml(customerName)}</div><div class="queue-submeta">Acct: ${escapeHtml(accountNumber)}</div>`
                : `<div class="queue-customer-name">${escapeHtml(customerName)}</div>`;
            const customerCell = `
                <div class="queue-customer-cell">
                    <span class="queue-customer-avatar" aria-hidden="true">${escapeHtml(customerInitials)}</span>
                    <div class="queue-customer-meta">${customerMeta}</div>
                </div>
            `;

            return `
                <tr>
                    <td>${customerCell}</td>
                    <td>${escapeHtml(formatDateTime(item.submittedAt))}</td>
                    <td class="queue-amount-cell">${escapeHtml(amountCell)}</td>
                    <td>${proofCell}</td>
                    <td>${actionCell}</td>
                </tr>
            `;
        }).join('');
    };

    const postAction = async (id, action, payload = {}) => {
        const response = await fetch(`/api/payment-confirmations/${encodeURIComponent(id)}/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.error || `Failed to ${action} request.`);
            error.payload = data;
            throw error;
        }
        return data;
    };

    const postCreateQueueRequest = async (payload = {}) => {
        const response = await fetch('/api/payment-confirmations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const rawText = await response.text();
        let data = {};
        try {
            data = rawText ? JSON.parse(rawText) : {};
        } catch {
            data = {};
        }
        if (!response.ok) {
            const fallbackMessage = rawText
                ? rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180)
                : '';
            throw new Error(data.error || fallbackMessage || 'Failed to create queue request.');
        }
        return data;
    };

    const onApprove = async (item) => {
        if (!item) {
            notify('Unable to load payment proof details.', 'error');
            return;
        }
        openApproveModal(item);
    };

    const submitApproveFromModal = async () => {
        if (state.loading) return;
        const id = String(state.activeApprovalId || '').trim();
        if (!id) return;
        const amount = Number(approveAmountInput?.value);
        const reference = String(approveReferenceInput?.value || '').trim();
        if (!Number.isFinite(amount) || amount <= 0) {
            notify('Amount is required.', 'error');
            approveAmountInput?.focus();
            return;
        }
        if (!reference) {
            notify('Reference number is required.', 'error');
            approveReferenceInput?.focus();
            return;
        }

        if (approveSubmitBtn) approveSubmitBtn.disabled = true;
        setLoadingState(true);
        try {
            await postAction(id, 'approve', {
                amount: Number(amount.toFixed(2)),
                reference
            });
            closeApproveModal();
            notify('Payment proof approved successfully.', 'success');
            await fetchQueue();
        } catch (error) {
            if (error?.payload?.code === 'DUPLICATE_PAYMENT_REFERENCE') {
                closeApproveModal();
                openDuplicatePaymentModal(error.payload.duplicatePayment || {});
                return;
            }
            notify(error.message || 'Unable to approve payment proof.', 'error');
        } finally {
            if (approveSubmitBtn) approveSubmitBtn.disabled = false;
            setLoadingState(false);
        }
    };

    const fetchHistoryByStatus = async (status) => {
        const response = await fetch(`/api/payment-confirmations?${buildHistoryQueryString(status)}`, {
            credentials: 'include',
            cache: 'no-store'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Failed to load ${status} history.`);
        }
        return Array.isArray(data.items) ? data.items : [];
    };

    const renderHistoryEmpty = (target, message = 'No records found.') => {
        if (!target) return;
        target.innerHTML = `
            <tr>
                <td colspan="6" class="history-empty">${escapeHtml(message)}</td>
            </tr>
        `;
    };

    const renderApprovedHistory = (items) => {
        const rows = Array.isArray(items) ? items : [];
        if (historyApprovedCount) historyApprovedCount.textContent = String(rows.length);
        if (!rows.length) {
            renderHistoryEmpty(historyApprovedBody, 'No approved requests found.');
            return;
        }

        historyApprovedBody.innerHTML = rows.map((item) => {
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

    const renderRejectedHistory = (items) => {
        const rows = Array.isArray(items) ? items : [];
        if (historyRejectedCount) historyRejectedCount.textContent = String(rows.length);
        if (!rows.length) {
            renderHistoryEmpty(historyRejectedBody, 'No rejected requests found.');
            return;
        }

        historyRejectedBody.innerHTML = rows.map((item) => {
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

    const fetchHistory = async () => {
        setLoadingState(true);
        try {
            const [approvedRows, rejectedRows] = await Promise.all([
                fetchHistoryByStatus('approved'),
                fetchHistoryByStatus('rejected')
            ]);
            renderApprovedHistory(approvedRows);
            renderRejectedHistory(rejectedRows);
        } catch (error) {
            const message = error?.message || 'Unable to load payment queue history.';
            renderHistoryEmpty(historyApprovedBody, message);
            renderHistoryEmpty(historyRejectedBody, message);
            notify(message, 'error');
        } finally {
            setLoadingState(false);
        }
    };

    const submitRejectFromModal = async () => {
        if (state.loading) return;
        const id = String(state.activeRejectId || '').trim();
        if (!id) return;
        const reason = String(rejectReasonInput?.value || '').trim();
        if (!reason) {
            notify('Rejection reason is required.', 'error');
            rejectReasonInput?.focus();
            return;
        }

        if (rejectSubmitBtn) rejectSubmitBtn.disabled = true;
        setLoadingState(true);
        try {
            await postAction(id, 'reject', { reason });
            closeRejectEntryModal();
            notify('Payment proof rejected.', 'success');
            await fetchQueue();
        } catch (error) {
            notify(error.message || 'Unable to reject payment proof.', 'error');
        } finally {
            if (rejectSubmitBtn) rejectSubmitBtn.disabled = false;
            setLoadingState(false);
        }
    };

    const onReject = async (item) => {
        if (!item) {
            notify('Unable to load payment request details.', 'error');
            return;
        }
        openRejectEntryModal(item);
    };

    const onCreateRequestSubmit = async (event) => {
        event.preventDefault();
        if (state.loading) return;

        const accountNumber = String(createAccountInput?.value || '').trim();
        const amount = Number(createAmountInput?.value);
        const customerName = String(createCustomerInput?.value || '').trim();
        const reference = String(createReferenceInput?.value || '').trim();
        const paymentMethod = String(createMethodInput?.value || '').trim();
        const notes = String(createNotesInput?.value || '').trim();
        const proofFile = createProofFileInput?.files?.[0] || null;

        if (!accountNumber) {
            notify('Account number is required.', 'error');
            createAccountInput?.focus();
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            notify('Amount is required.', 'error');
            createAmountInput?.focus();
            return;
        }
        if (!proofFile) {
            notify('Proof image is required.', 'error');
            createProofFileInput?.focus();
            return;
        }
        if (proofFile.size > 4 * 1024 * 1024) {
            notify('Proof image is too large. Max size is 4 MB.', 'error');
            createProofFileInput?.focus();
            return;
        }

        let proofImageData = '';
        try {
            proofImageData = await readFileAsDataUrl(proofFile);
        } catch (error) {
            notify(error.message || 'Unable to read proof image.', 'error');
            return;
        }

        if (!proofImageData) {
            notify('Proof image is required.', 'error');
            return;
        }

        if (createSubmitBtn) createSubmitBtn.disabled = true;
        setLoadingState(true);
        try {
            await postCreateQueueRequest({
                accountNumber,
                customerName,
                amount: Number(amount.toFixed(2)),
                reference,
                paymentMethod,
                notes,
                proofImageData,
                proofMimeType: String(proofFile.type || '').trim(),
                proofFileName: String(proofFile.name || '').trim()
            });
            closeCreateModal();
            notify('Queue request added successfully.', 'success');
            await fetchQueue();
        } catch (error) {
            notify(error.message || 'Unable to add queue request.', 'error');
        } finally {
            if (createSubmitBtn) createSubmitBtn.disabled = false;
            setLoadingState(false);
        }
    };

    const onViewRejectReason = (item) => {
        if (!item) {
            notify('Unable to load rejection details.', 'error');
            return;
        }
        openRejectInfoModal(item);
    };

    queueTableBody?.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action][data-id]');
        if (!button || state.loading) return;
        const action = button.getAttribute('data-action');
        const idFromButton = String(button.getAttribute('data-id') || '').trim();
        const item = getQueueItemByRowIndex(button.getAttribute('data-row-index')) || getQueueItemById(idFromButton);
        const id = String(item?.id || idFromButton).trim();
        if (!id) return;

        if (action === 'approve') {
            await onApprove(item);
            return;
        }
        if (action === 'view-reason') {
            onViewRejectReason(item);
            return;
        }
        if (action === 'reject') {
            await onReject(item);
        }
    });

    queueViewQueueBtn?.addEventListener('click', () => {
        if (state.currentView === 'queue') return;
        setQueueView('queue');
    });

    queueViewHistoryBtn?.addEventListener('click', () => {
        if (state.currentView === 'history') return;
        setQueueView('history');
    });

    historyAccountFilter?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        state.historyAccountNumber = String(historyAccountFilter?.value || '').trim();
        fetchHistory();
    });

    accountFilter?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            applyQueueFilters();
            state.pagination.page = 1;
            fetchQueue();
        }
    });

    accountFilter?.addEventListener('search', () => {
        applyQueueFilters();
        state.pagination.page = 1;
        fetchQueue();
    });

    accountFilter?.addEventListener('change', () => {
        applyQueueFilters();
        state.pagination.page = 1;
        fetchQueue();
    });

    pageSizeSelect?.addEventListener('change', () => {
        const nextSize = Number(pageSizeSelect.value) || 10;
        state.pagination.pageSize = nextSize;
        state.pagination.page = 1;
        localStorage.setItem('paymentQueuePageSize', String(nextSize));
        renderRows(state.queueItems);
    });

    footerPrevBtn?.addEventListener('click', () => {
        if (state.pagination.page <= 1) return;
        state.pagination.page -= 1;
        renderRows(state.queueItems);
    });

    footerNextBtn?.addEventListener('click', () => {
        const total = state.queueItems.length;
        const pageCount = total ? Math.ceil(total / (state.pagination.pageSize || 10)) : 1;
        if (state.pagination.page >= pageCount) return;
        state.pagination.page += 1;
        renderRows(state.queueItems);
    });

    approveProofToolbar?.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-proof-zoom]');
        if (!button) return;
        const action = String(button.getAttribute('data-proof-zoom') || '').trim();
        if (action === 'in') {
            updateApproveProofZoom(state.approveProofZoom + PROOF_ZOOM_STEP);
            return;
        }
        if (action === 'out') {
            updateApproveProofZoom(state.approveProofZoom - PROOF_ZOOM_STEP);
            return;
        }
        if (action === 'reset') {
            resetApproveProofZoom();
        }
    });

    approveProofImage?.addEventListener('click', (event) => {
        if (state.approveProofDragged) {
            event.preventDefault();
            event.stopPropagation();
            state.approveProofDragged = false;
            return;
        }
        if (!String(approveProofImage.getAttribute('src') || '').trim()) return;
        const nextZoom = state.approveProofZoom >= 2.5
            ? PROOF_ZOOM_MIN
            : state.approveProofZoom + 0.5;
        updateApproveProofZoom(nextZoom);
    });

    approveProofImage?.addEventListener('load', () => {
        state.approveProofBaseWidth = 0;
        updateApproveProofZoom(state.approveProofZoom || PROOF_ZOOM_MIN, { preserveCenter: false });
    });

    approveProofViewport?.addEventListener('wheel', (event) => {
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            const direction = event.deltaY < 0 ? 1 : -1;
            updateApproveProofZoom(state.approveProofZoom + (direction * PROOF_ZOOM_STEP));
            return;
        }

        if (state.approveProofZoom <= PROOF_ZOOM_MIN) return;
        const canScrollX = approveProofViewport.scrollWidth > approveProofViewport.clientWidth;
        const canScrollY = approveProofViewport.scrollHeight > approveProofViewport.clientHeight;
        if (!canScrollX && !canScrollY) return;

        event.preventDefault();
        approveProofViewport.scrollLeft += event.deltaX + (event.shiftKey ? event.deltaY : 0);
        approveProofViewport.scrollTop += event.shiftKey ? 0 : event.deltaY;
    }, { passive: false });

    approveProofViewport?.addEventListener('keydown', (event) => {
        if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            updateApproveProofZoom(state.approveProofZoom + PROOF_ZOOM_STEP);
            return;
        }
        if (event.key === '-' || event.key === '_') {
            event.preventDefault();
            updateApproveProofZoom(state.approveProofZoom - PROOF_ZOOM_STEP);
            return;
        }
        if (event.key === '0') {
            event.preventDefault();
            resetApproveProofZoom();
        }
    });

    approveProofViewport?.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || state.approveProofZoom <= PROOF_ZOOM_MIN) return;
        const canScrollX = approveProofViewport.scrollWidth > approveProofViewport.clientWidth;
        const canScrollY = approveProofViewport.scrollHeight > approveProofViewport.clientHeight;
        if (!canScrollX && !canScrollY) return;

        state.approveProofPanning = true;
        state.approveProofDragged = false;
        state.approveProofPanStartX = event.clientX;
        state.approveProofPanStartY = event.clientY;
        state.approveProofPanScrollLeft = approveProofViewport.scrollLeft;
        state.approveProofPanScrollTop = approveProofViewport.scrollTop;
        approveProofViewport.classList.add('is-panning');
        approveProofViewport.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    });

    approveProofViewport?.addEventListener('pointermove', (event) => {
        if (!state.approveProofPanning) return;
        const deltaX = event.clientX - state.approveProofPanStartX;
        const deltaY = event.clientY - state.approveProofPanStartY;
        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
            state.approveProofDragged = true;
        }
        approveProofViewport.scrollLeft = state.approveProofPanScrollLeft - deltaX;
        approveProofViewport.scrollTop = state.approveProofPanScrollTop - deltaY;
        event.preventDefault();
    });

    approveProofViewport?.addEventListener('pointerup', (event) => {
        if (state.approveProofPanning) {
            approveProofViewport.releasePointerCapture?.(event.pointerId);
        }
        stopApproveProofPan();
    });

    approveProofViewport?.addEventListener('pointercancel', stopApproveProofPan);
    approveProofViewport?.addEventListener('lostpointercapture', stopApproveProofPan);

    approveSubmitBtn?.addEventListener('click', () => {
        submitApproveFromModal();
    });

    approveReferenceInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            submitApproveFromModal();
        }
    });

    approveAmountInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            approveReferenceInput?.focus();
        }
    });

    rejectSubmitBtn?.addEventListener('click', () => {
        submitRejectFromModal();
    });

    rejectReasonInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submitRejectFromModal();
        }
    });

    approveModal?.addEventListener('click', (event) => {
        const dismissTarget = event.target.closest('[data-dismiss="queue-approve-modal"]');
        if (dismissTarget || event.target === approveModal) {
            closeApproveModal();
        }
    });

    createModal?.addEventListener('click', (event) => {
        const dismissTarget = event.target.closest('[data-dismiss="queue-create-modal"]');
        if (dismissTarget || event.target === createModal) {
            closeCreateModal();
        }
    });

    createForm?.addEventListener('submit', onCreateRequestSubmit);

    rejectEntryModal?.addEventListener('click', (event) => {
        const dismissTarget = event.target.closest('[data-dismiss="queue-reject-entry-modal"]');
        if (dismissTarget || event.target === rejectEntryModal) {
            closeRejectEntryModal();
        }
    });

    rejectInfoModal?.addEventListener('click', (event) => {
        const dismissTarget = event.target.closest('[data-dismiss="queue-reject-modal"]');
        if (dismissTarget || event.target === rejectInfoModal) {
            closeRejectInfoModal();
        }
    });

    duplicatePaymentModal?.addEventListener('click', (event) => {
        const dismissTarget = event.target.closest('[data-dismiss="queue-duplicate-modal"]');
        if (dismissTarget || event.target === duplicatePaymentModal) {
            closeDuplicatePaymentModal();
        }
    });

    window.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (approveModal?.classList.contains('show')) {
            event.preventDefault();
            closeApproveModal();
            return;
        }
        if (rejectEntryModal?.classList.contains('show')) {
            event.preventDefault();
            closeRejectEntryModal();
            return;
        }
        if (createModal?.classList.contains('show')) {
            event.preventDefault();
            closeCreateModal();
            return;
        }
        if (rejectInfoModal?.classList.contains('show')) {
            event.preventDefault();
            closeRejectInfoModal();
            return;
        }
        if (duplicatePaymentModal?.classList.contains('show')) {
            event.preventDefault();
            closeDuplicatePaymentModal();
        }
    });

    applyQueueFilters();
    fetchQueue();
});

