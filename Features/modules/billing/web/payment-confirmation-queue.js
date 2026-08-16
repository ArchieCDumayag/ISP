document.addEventListener('DOMContentLoaded', () => {
    const queueTableBody = document.getElementById('queueTableBody');
    const gcashHistoryBody = document.getElementById('queueGcashHistoryBody');
    const gcashHistorySummary = document.getElementById('queueGcashHistorySummary');
    const gcashHistoryRefreshButton = document.getElementById('queueGcashHistoryRefreshBtn');
    const gcashHistorySearch = document.getElementById('queueGcashHistorySearch');
    const gcashHistoryFilter = document.getElementById('queueGcashHistoryFilter');
    const gcashHistoryVisibleCount = document.getElementById('queueGcashVisibleCount');
    const gcashHistoryStatTotal = document.getElementById('queueGcashStatTotal');
    const gcashHistoryStatTotalMeta = document.getElementById('queueGcashStatTotalMeta');
    const gcashHistoryStatAvailable = document.getElementById('queueGcashStatAvailable');
    const gcashHistoryStatAvailableMeta = document.getElementById('queueGcashStatAvailableMeta');
    const gcashHistoryStatPosted = document.getElementById('queueGcashStatPosted');
    const gcashHistoryStatPostedMeta = document.getElementById('queueGcashStatPostedMeta');
    const gcashHistoryStatRemarked = document.getElementById('queueGcashStatRemarked');
    const gcashHistoryStatRemarkedMeta = document.getElementById('queueGcashStatRemarkedMeta');
    const gcashHistoryStatDebit = document.getElementById('queueGcashStatDebit');
    const gcashHistoryStatDebitMeta = document.getElementById('queueGcashStatDebitMeta');
    const gcashPageTabButtons = Array.from(document.querySelectorAll('[data-gcash-page-tab]'));
    const gcashImportedTab = document.getElementById('queueGcashImportedTab');
    const gcashPendingTab = document.getElementById('queueGcashPendingTab');
    const pendingGcashCount = document.getElementById('queuePendingGcashCount');
    const pendingGcashSummary = document.getElementById('queuePendingGcashSummary');
    const pendingGcashBody = document.getElementById('queuePendingGcashBody');
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
    const importGcashButton = document.getElementById('queueImportGcashHistoryBtn');
    const importGcashModal = document.getElementById('queueImportGcashModal');
    const importGcashForm = document.getElementById('queueImportGcashForm');
    const importGcashFileInput = document.getElementById('queueImportGcashFile');
    const importGcashPasswordInput = document.getElementById('queueImportGcashPassword');
    const importGcashSubmitButton = document.getElementById('queueImportGcashSubmitBtn');
    const importGcashResult = document.getElementById('queueImportGcashResult');
    const postGcashModal = document.getElementById('queuePostGcashModal');
    const postGcashForm = document.getElementById('queuePostGcashForm');
    const postGcashReferenceInput = document.getElementById('queuePostGcashReference');
    const postGcashAmountInput = document.getElementById('queuePostGcashAmount');
    const postGcashTransactionAtInput = document.getElementById('queuePostGcashTransactionAt');
    const postGcashRecipientInput = document.getElementById('queuePostGcashRecipient');
    const postGcashAccountSearch = document.getElementById('queuePostGcashAccount');
    const postGcashAllocations = document.getElementById('queuePostGcashAllocations');
    const postGcashAddAllocationButton = document.getElementById('queuePostGcashAddAllocationBtn');
    const postGcashAllocationTotal = document.getElementById('queuePostGcashAllocationTotal');
    const postGcashAssignmentConfirmed = document.getElementById('queuePostGcashAssignmentConfirmed');
    const postGcashSubmitButton = document.getElementById('queuePostGcashSubmitBtn');
    const bindPendingGcashModal = document.getElementById('queueBindPendingGcashModal');
    const bindPendingGcashForm = document.getElementById('queueBindPendingGcashForm');
    const bindPendingGcashCustomer = document.getElementById('queueBindPendingGcashCustomer');
    const bindPendingGcashAmount = document.getElementById('queueBindPendingGcashAmount');
    const bindPendingGcashDate = document.getElementById('queueBindPendingGcashDate');
    const bindPendingGcashEnteredReference = document.getElementById('queueBindPendingGcashEnteredReference');
    const bindPendingGcashReference = document.getElementById('queueBindPendingGcashReference');
    const bindPendingGcashNotice = document.getElementById('queueBindPendingGcashNotice');
    const bindPendingGcashConfirmed = document.getElementById('queueBindPendingGcashConfirmed');
    const bindPendingGcashSubmitButton = document.getElementById('queueBindPendingGcashSubmitBtn');
    const lockGcashModal = document.getElementById('queueLockGcashModal');
    const lockGcashForm = document.getElementById('queueLockGcashForm');
    const lockGcashReferenceInput = document.getElementById('queueLockGcashReference');
    const lockGcashAmountInput = document.getElementById('queueLockGcashAmount');
    const lockGcashRemarkInput = document.getElementById('queueLockGcashRemark');
    const lockGcashSubmitButton = document.getElementById('queueLockGcashSubmitBtn');
    const approveModal = document.getElementById('queueApproveModal');
    const approveMeta = document.getElementById('queueApproveMeta');
    const approveGcashMatch = document.getElementById('queueApproveGcashMatch');
    const approveProofAnalysis = document.getElementById('queueApproveProofAnalysis');
    const approveProofViewer = document.getElementById('queueApproveProofViewer');
    const approveProofToolbar = document.getElementById('queueApproveProofToolbar');
    const approveProofLink = document.getElementById('queueApproveProofLink');
    const approveProofViewport = document.getElementById('queueApproveProofViewport');
    const approveProofImage = document.getElementById('queueApproveProofImage');
    const approveProofZoomLevel = document.getElementById('queueApproveProofZoomLevel');
    const approveProofEmpty = document.getElementById('queueApproveProofEmpty');
    const approveAmountInput = document.getElementById('queueApproveAmountInput');
    const approveReferenceInput = document.getElementById('queueApproveReferenceInput');
    const approveAssignmentGroup = document.getElementById('queueApproveAssignmentGroup');
    const approveAssignmentConfirmed = document.getElementById('queueApproveAssignmentConfirmed');
    const approveAssignmentLabel = document.getElementById('queueApproveAssignmentLabel');
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
    const rejectEntryTitle = document.getElementById('queueRejectEntryModalTitle');
    const rejectEntrySubtitle = document.getElementById('queueRejectEntrySubtitle');
    const rejectEntryMeta = document.getElementById('queueRejectEntryMeta');
    const rejectReasonLabel = document.getElementById('queueRejectReasonLabel');
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
        gcashTransactionsByReference: new Map(),
        gcashHistoryTransactions: [],
        gcashHistoryBatches: [],
        gcashHistoryTotalTransactions: 0,
        gcashHistorySearchTerm: '',
        gcashHistoryFilter: 'all',
        gcashPageTab: 'imported',
        pendingGcashPayments: [],
        activePendingGcash: null,
        paymentRecords: [],
        activeGcashReference: '',
        activeLockGcashReference: '',
        renderedItems: [],
        activeApprovalId: '',
        activeRejectId: '',
        activeReviewAction: 'reject',
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
    const GCASH_REMARK_OPTIONS = Object.freeze([
        { value: 'expense_unclassified', label: 'Expense — Unclassified' },
        { value: 'operating_expense', label: 'Operating Expense' },
        { value: 'transfer', label: 'Transfer' },
        { value: 'refund', label: 'Refund' },
        { value: 'personal_other', label: 'Personal/Other' }
    ]);
    let postGcashAccountPickerSequence = 1;

    if (pageSizeSelect) {
        pageSizeSelect.value = String(state.pagination.pageSize);
    }


    const formatDateTime = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '-';
        const parsed = /^\d{12,}$/.test(raw)
            ? new Date(Number(raw))
            : new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
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

    const normalizeGcashReference = (value) => String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '');

    const setGcashPageTab = (tabName) => {
        const nextTab = tabName === 'pending' ? 'pending' : 'imported';
        state.gcashPageTab = nextTab;
        if (gcashImportedTab) gcashImportedTab.hidden = nextTab !== 'imported';
        if (gcashPendingTab) gcashPendingTab.hidden = nextTab !== 'pending';
        gcashPageTabButtons.forEach((button) => {
            const active = button.dataset.gcashPageTab === nextTab;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    };

    const closeBindPendingGcashModal = () => {
        if (!bindPendingGcashModal) return;
        bindPendingGcashModal.classList.remove('show');
        bindPendingGcashModal.setAttribute('aria-hidden', 'true');
        bindPendingGcashForm?.reset();
        state.activePendingGcash = null;
        if (!document.querySelector('.modal.show')) document.body.classList.remove('modal-active');
    };

    const syncBindPendingGcashSubmit = () => {
        if (!bindPendingGcashSubmitButton) return;
        bindPendingGcashSubmitButton.disabled = state.loading
            || !String(bindPendingGcashReference?.value || '').trim()
            || bindPendingGcashConfirmed?.checked !== true;
    };

    const formatBillingMonth = (value) => {
        const match = String(value || '').trim().match(/^(\d{4})-(\d{2})$/);
        if (!match) return String(value || '').trim() || '-';
        const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
        return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    };

    const getPaymentRecordName = (record = {}) => (
        String(record.name || '').trim()
        || [record.firstName, record.lastName].map((value) => String(value || '').trim()).filter(Boolean).join(' ')
        || String(record.accountNumber || '').trim()
    );

    const getCurrentBillingCycle = (record = {}) => {
        const summary = record?.billingSummary;
        if (summary?.available !== true || !summary.currentCycle) return null;
        const month = String(
            summary.currentCycle.billingMonthKey
            || summary.currentCycle.billDate
            || ''
        ).trim().slice(0, 7);
        return /^\d{4}-\d{2}$/.test(month)
            ? { ...summary.currentCycle, billingMonthKey: month }
            : null;
    };

    const getCanonicalEndingBalance = (record = {}) => {
        const balance = Number(record?.billingSummary?.endingBalance ?? record.endingBalance ?? record.balance);
        return Number.isFinite(balance) ? Number(balance.toFixed(2)) : null;
    };

    const isPostGcashAdvancePaymentRecord = (record = {}) => {
        const endingBalance = getCanonicalEndingBalance(record);
        const paymentStatus = String(
            getCurrentBillingCycle(record)?.paymentStatus
            || record?.billingSummary?.billingStatus
            || ''
        ).trim().toLowerCase();
        return Number.isFinite(endingBalance)
            && (endingBalance <= 0.009 || ['paid', 'settled'].includes(paymentStatus));
    };

    const getPostGcashPaymentLabel = (record = {}) => (
        isPostGcashAdvancePaymentRecord(record)
            ? 'Advance Payment'
            : formatCurrency(getCanonicalEndingBalance(record))
    );

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

    const getGcashMatchPresentation = (match) => {
        const status = String(match?.status || '').trim().toLowerCase();
        const presentations = {
            matched: { label: 'Official match', badgeClass: 'bg-green-lt text-green' },
            reference_not_found: { label: 'Reference not found', badgeClass: 'bg-red-lt text-red' },
            reference_missing: { label: 'Reference missing', badgeClass: 'bg-red-lt text-red' },
            amount_mismatch: { label: 'Amount mismatch', badgeClass: 'bg-red-lt text-red' },
            date_mismatch: { label: 'Date mismatch', badgeClass: 'bg-orange-lt text-orange' },
            date_missing: { label: 'Date missing', badgeClass: 'bg-orange-lt text-orange' },
            recipient_mismatch: { label: 'Recipient mismatch', badgeClass: 'bg-red-lt text-red' },
            recipient_unavailable: { label: 'Recipient unavailable', badgeClass: 'bg-orange-lt text-orange' },
            merchant_not_configured: { label: 'Merchant not configured', badgeClass: 'bg-orange-lt text-orange' },
            not_received: { label: 'Not an incoming credit', badgeClass: 'bg-red-lt text-red' },
            already_assigned: { label: 'Already assigned', badgeClass: 'bg-red-lt text-red' },
            matched_payer_mismatch: { label: 'Match; verify sender', badgeClass: 'bg-orange-lt text-orange' },
            matched_payer_unavailable: { label: 'Match; verify owner', badgeClass: 'bg-orange-lt text-orange' }
        };
        return presentations[status] || { label: 'Awaiting history import', badgeClass: 'bg-secondary-lt text-secondary' };
    };

    const renderGcashMatch = (match, { includeMessage = true } = {}) => {
        const presentation = getGcashMatchPresentation(match);
        const message = String(match?.message || 'Upload the official GCash Transaction History PDF to validate this reference.').trim();
        return `<span class="badge ${presentation.badgeClass}">${escapeHtml(presentation.label)}</span>${includeMessage
            ? `<small class="d-block text-secondary mt-1">${escapeHtml(message)}</small>`
            : ''}`;
    };

    const renderTransactionMatches = (item = {}) => `<div>
        <small class="text-secondary d-block mb-1">Official imported history</small>${renderGcashMatch(item.gcashMatch)}
    </div>`;

    const renderProofAnalysis = (analysis) => {
        if (!analysis || typeof analysis !== 'object') return '';
        const fields = analysis.fields || {};
        const warnings = Array.isArray(analysis.warnings) ? analysis.warnings.filter(Boolean) : [];
        const stateLabel = analysis.historyMatch?.matched
            ? 'Screenshot/history match'
            : (analysis.state === 'complete' ? 'Details extracted' : 'Manual review needed');
        const badgeClass = analysis.historyMatch?.matched
            ? 'bg-green-lt text-green'
            : (analysis.state === 'complete' ? 'bg-blue-lt text-blue' : 'bg-orange-lt text-orange');
        const statusLabel = String(fields.status || 'unknown').replace(/_/g, ' ');
        const ai = analysis.ai || {};
        const sourceLabel = ai.used
            ? (analysis.source === 'vision_ai' ? 'Vision AI fallback' : 'Local OCR + Vision AI')
            : (ai.status === 'failed'
                ? 'Local OCR; AI unavailable'
                : (ai.status === 'not_configured' ? 'Local OCR; AI not configured' : 'Local OCR'));
        const aiLabel = ai.used
            ? `${ai.provider || 'Vision AI'}${ai.model ? ` / ${ai.model}` : ''}${ai.confidence == null ? '' : ` (${ai.confidence}%)`}`
            : (ai.reason || 'Not used');
        return `<div class="alert alert-info mb-0">
            <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
                <strong>Screenshot analysis</strong>
                <span class="badge ${badgeClass}">${escapeHtml(stateLabel)}</span>
            </div>
            <div class="row g-2 small">
                <div class="col-6"><span class="text-secondary d-block">Amount</span>${escapeHtml(formatCurrency(fields.amount))}</div>
                <div class="col-6"><span class="text-secondary d-block">Reference</span>${escapeHtml(fields.reference || '-')}</div>
                <div class="col-6"><span class="text-secondary d-block">Date</span>${escapeHtml(formatDateTime(fields.transactionAt))}</div>
                <div class="col-6"><span class="text-secondary d-block">Recipient</span>${escapeHtml(fields.recipient || fields.recipientNumber || '-')}</div>
                <div class="col-6"><span class="text-secondary d-block">Status</span>${escapeHtml(statusLabel)}</div>
                <div class="col-6"><span class="text-secondary d-block">Confidence</span>${analysis.confidence == null ? '-' : `${escapeHtml(analysis.confidence)}%`}</div>
                <div class="col-6"><span class="text-secondary d-block">Analyzer</span>${escapeHtml(sourceLabel)}</div>
                <div class="col-6"><span class="text-secondary d-block">Vision AI</span>${escapeHtml(aiLabel)}</div>
            </div>
            ${warnings.length ? `<div class="text-danger small mt-2">${warnings.map((warning) => escapeHtml(warning)).join('<br>')}</div>` : ''}
            <small class="d-block text-secondary mt-2">OCR and Vision AI are review assistance only. An official-history match plus explicit Admin approval is required before posting.</small>
        </div>`;
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

    const closeImportGcashModal = () => {
        if (!importGcashModal) return;
        importGcashModal.classList.remove('show');
        importGcashModal.setAttribute('aria-hidden', 'true');
        importGcashForm?.reset();
        if (importGcashPasswordInput) importGcashPasswordInput.value = '';
        if (importGcashResult) {
            importGcashResult.hidden = true;
            importGcashResult.textContent = '';
        }
        if (!document.querySelector('.modal.show')) document.body.classList.remove('modal-active');
    };

    const openImportGcashModal = () => {
        if (!importGcashModal) return;
        importGcashModal.classList.add('show');
        importGcashModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-active');
        window.setTimeout(() => importGcashFileInput?.focus({ preventScroll: true }), 0);
    };

    const closeLockGcashModal = () => {
        if (!lockGcashModal) return;
        lockGcashModal.classList.remove('show');
        lockGcashModal.setAttribute('aria-hidden', 'true');
        lockGcashForm?.reset();
        state.activeLockGcashReference = '';
        if (!document.querySelector('.modal.show')) document.body.classList.remove('modal-active');
    };

    const openLockGcashModal = (transaction) => {
        if (!lockGcashModal || !transaction) return;
        const reference = normalizeGcashReference(transaction.reference);
        const isReceived = String(transaction.status || '').toLowerCase() === 'received'
            && Number(transaction.credit) > 0;
        if (!reference || !isReceived || transaction.assignment || transaction.postingLock) return;
        state.activeLockGcashReference = reference;
        if (lockGcashReferenceInput) lockGcashReferenceInput.value = reference;
        if (lockGcashAmountInput) lockGcashAmountInput.value = formatCurrency(Number(transaction.credit));
        if (lockGcashRemarkInput) lockGcashRemarkInput.value = '';
        lockGcashModal.classList.add('show');
        lockGcashModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-active');
        window.setTimeout(() => lockGcashRemarkInput?.focus({ preventScroll: true }), 0);
    };

    const getPostGcashAllocationRows = () => Array.from(
        postGcashAllocations?.querySelectorAll('[data-gcash-allocation-row]') || []
    );

    const renumberPostGcashAllocationRows = () => {
        getPostGcashAllocationRows().forEach((row, index) => {
            const title = row.querySelector('[data-gcash-allocation-title]');
            if (title) title.textContent = `Allocation ${index + 1}`;
        });
    };

    const renderPostGcashAllocationTotal = () => {
        const importedAmount = Number(postGcashAmountInput?.value);
        const allocatedAmount = Number(getPostGcashAllocationRows().reduce((sum, row) => (
            sum + (Number(row.querySelector('[data-gcash-allocation-amount]')?.value) || 0)
        ), 0).toFixed(2));
        const remaining = Number(((Number.isFinite(importedAmount) ? importedAmount : 0) - allocatedAmount).toFixed(2));
        if (postGcashAllocationTotal) {
            const exact = Number.isFinite(importedAmount) && importedAmount > 0 && Math.abs(remaining) <= 0.009;
            const remainingLabel = exact
                ? new Intl.NumberFormat('en-PH', {
                    style: 'currency',
                    currency: 'PHP',
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }).format(0)
                : formatCurrency(Math.abs(remaining));
            postGcashAllocationTotal.className = `alert ${exact ? 'alert-success' : (remaining < 0 ? 'alert-danger' : 'alert-warning')} mt-3 mb-0`;
            postGcashAllocationTotal.textContent = `Allocated: ${formatCurrency(allocatedAmount)} | ${remaining < 0 ? 'Over' : 'Remaining'}: ${remainingLabel}`;
        }
        if (postGcashAddAllocationButton) {
            postGcashAddAllocationButton.disabled = !state.paymentRecords.length || getPostGcashAllocationRows().length >= 3;
        }
    };

    const resetPostGcashAllocations = () => {
        const rows = getPostGcashAllocationRows();
        rows.slice(1).forEach((row) => row.remove());
        postGcashAccountPickerSequence = 1;
        const firstRow = rows[0];
        if (firstRow) {
            const accountSearch = firstRow.querySelector('[data-gcash-account-search]');
            const accountInput = firstRow.querySelector('[data-gcash-allocation-account]');
            const suggestions = firstRow.querySelector('[data-gcash-account-suggestions]');
            const amountInput = firstRow.querySelector('[data-gcash-allocation-amount]');
            const summary = firstRow.querySelector('[data-gcash-allocation-summary]');
            if (accountSearch) {
                accountSearch.value = '';
                accountSearch.disabled = false;
                accountSearch.placeholder = 'Type client name or account number';
                accountSearch.setAttribute('aria-expanded', 'false');
                accountSearch.removeAttribute('aria-activedescendant');
            }
            if (accountInput) accountInput.value = '';
            if (suggestions) {
                suggestions.innerHTML = '';
                suggestions.hidden = true;
            }
            if (amountInput) {
                amountInput.value = '';
                amountInput.removeAttribute('max');
            }
            if (summary) {
                summary.className = 'alert alert-info mb-0';
                summary.textContent = 'Select a customer to review the amount due or advance payment.';
            }
        }
        renumberPostGcashAllocationRows();
        renderPostGcashAllocationTotal();
    };

    const closePostGcashModal = () => {
        if (!postGcashModal) return;
        postGcashModal.classList.remove('show');
        postGcashModal.setAttribute('aria-hidden', 'true');
        postGcashForm?.reset();
        state.activeGcashReference = '';
        resetPostGcashAllocations();
        if (!document.querySelector('.modal.show')) document.body.classList.remove('modal-active');
    };

    const loadPaymentRecordsForGcashPosting = async ({ force = false } = {}) => {
        if (!force && state.paymentRecords.length) return state.paymentRecords;
        const response = await fetch('/api/payment-records', {
            credentials: 'include',
            cache: 'no-store'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to load customer billing records.');
        state.paymentRecords = Array.isArray(data.records) ? data.records : [];
        return state.paymentRecords;
    };

    const getPostGcashEligibleRecords = () => (
        state.paymentRecords
            .filter((record) => (
                String(record?.accountNumber || '').trim()
                && getCurrentBillingCycle(record)
                && Number.isFinite(getCanonicalEndingBalance(record))
            ))
            .sort((left, right) => (
                getPaymentRecordName(left).localeCompare(getPaymentRecordName(right))
                || String(left.accountNumber || '').localeCompare(String(right.accountNumber || ''))
            ))
    );

    const normalizePostGcashAccountSearch = (value) => (
        String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
    );

    const getPostGcashAccountDisplay = (record = {}) => {
        return `${getPaymentRecordName(record)} — ${getPostGcashPaymentLabel(record)}`;
    };

    const getPostGcashSelectedAccount = (row) => (
        String(row?.querySelector('[data-gcash-allocation-account]')?.value || '').trim()
    );

    const getPostGcashSelectedAccounts = (excludedRow = null) => new Set(
        getPostGcashAllocationRows()
            .filter((row) => row !== excludedRow)
            .map((row) => getPostGcashSelectedAccount(row))
            .filter(Boolean)
    );

    const closePostGcashAccountSuggestions = (targetRow = null) => {
        const rows = targetRow ? [targetRow] : getPostGcashAllocationRows();
        rows.forEach((row) => {
            const searchInput = row.querySelector('[data-gcash-account-search]');
            const suggestions = row.querySelector('[data-gcash-account-suggestions]');
            if (suggestions) {
                suggestions.hidden = true;
                suggestions.querySelectorAll('[data-gcash-account-option]').forEach((option) => {
                    option.classList.remove('active');
                    option.setAttribute('aria-selected', 'false');
                });
            }
            searchInput?.setAttribute('aria-expanded', 'false');
            searchInput?.removeAttribute('aria-activedescendant');
        });
    };

    const renderPostGcashAccountSuggestions = (row) => {
        const searchInput = row?.querySelector('[data-gcash-account-search]');
        const suggestions = row?.querySelector('[data-gcash-account-suggestions]');
        if (!searchInput || !suggestions || searchInput.disabled) return;
        const terms = normalizePostGcashAccountSearch(searchInput.value).split(' ').filter(Boolean);
        const selectedElsewhere = getPostGcashSelectedAccounts(row);
        const matches = getPostGcashEligibleRecords().filter((record) => {
            const accountNumber = String(record.accountNumber || '').trim();
            if (selectedElsewhere.has(accountNumber)) return false;
            const searchable = normalizePostGcashAccountSearch(`${getPaymentRecordName(record)} ${accountNumber}`);
            return terms.every((term) => searchable.includes(term));
        });
        const visibleMatches = matches.slice(0, 8);
        const listboxId = suggestions.id || `queuePostGcashAccountSuggestions${postGcashAccountPickerSequence}`;
        if (!suggestions.id) suggestions.id = listboxId;
        searchInput.setAttribute('aria-controls', listboxId);
        suggestions.innerHTML = visibleMatches.length
            ? visibleMatches.map((record, index) => {
                const accountNumber = String(record.accountNumber || '').trim();
                return `<button class="queue-gcash-account-option" type="button" role="option" id="${escapeHtml(`${listboxId}Option${index + 1}`)}" data-gcash-account-option data-account-number="${escapeHtml(accountNumber)}" aria-selected="false">
                    <span class="queue-gcash-account-option__name">${escapeHtml(getPaymentRecordName(record))}</span>
                    <span class="queue-gcash-account-option__amount">${escapeHtml(getPostGcashPaymentLabel(record))}</span>
                </button>`;
            }).join('')
            : '<div class="queue-gcash-account-empty" role="status">No matching client.</div>';
        if (matches.length > visibleMatches.length) {
            suggestions.insertAdjacentHTML('beforeend', `<div class="queue-gcash-account-more">Keep typing to narrow ${matches.length} clients.</div>`);
        }
        suggestions.hidden = false;
        searchInput.setAttribute('aria-expanded', 'true');
        searchInput.removeAttribute('aria-activedescendant');
    };

    const selectPostGcashAccount = (row, accountNumber) => {
        const normalizedAccount = String(accountNumber || '').trim();
        const accountInput = row?.querySelector('[data-gcash-allocation-account]');
        const searchInput = row?.querySelector('[data-gcash-account-search]');
        const record = getPostGcashEligibleRecords().find((item) => (
            String(item.accountNumber || '').trim() === normalizedAccount
        )) || null;
        if (!row || !accountInput || !searchInput || !record) return;
        if (getPostGcashSelectedAccounts(row).has(normalizedAccount)) {
            notify('This customer account is already used in another allocation.', 'error');
            renderPostGcashAccountSuggestions(row);
            return;
        }
        accountInput.value = normalizedAccount;
        searchInput.value = getPostGcashAccountDisplay(record);
        closePostGcashAccountSuggestions();
        updatePostGcashCurrentMonth(row);
        renderPostGcashAllocationTotal();
    };

    const populatePostGcashAccounts = (targetRow = null) => {
        const rows = targetRow ? [targetRow] : getPostGcashAllocationRows();
        const eligibleRecords = getPostGcashEligibleRecords();
        rows.forEach((row) => {
            const searchInput = row.querySelector('[data-gcash-account-search]');
            const accountInput = row.querySelector('[data-gcash-allocation-account]');
            const selectedAccount = getPostGcashSelectedAccount(row);
            const selectedRecord = eligibleRecords.find((record) => (
                String(record.accountNumber || '').trim() === selectedAccount
            )) || null;
            if (!searchInput || !accountInput) return;
            searchInput.disabled = !eligibleRecords.length;
            searchInput.placeholder = eligibleRecords.length
                ? 'Type client name or account number'
                : 'No clients with a current billing cycle';
            if (selectedRecord) {
                searchInput.value = getPostGcashAccountDisplay(selectedRecord);
            } else {
                accountInput.value = '';
                searchInput.value = '';
            }
            closePostGcashAccountSuggestions(row);
        });
        renderPostGcashAllocationTotal();
    };

    const updatePostGcashCurrentMonth = (targetRow = null) => {
        const row = targetRow || getPostGcashAllocationRows()[0];
        if (!row) return;
        const amountInput = row.querySelector('[data-gcash-allocation-amount]');
        const summary = row.querySelector('[data-gcash-allocation-summary]');
        const accountNumber = getPostGcashSelectedAccount(row);
        const record = state.paymentRecords.find((item) => String(item?.accountNumber || '').trim() === accountNumber) || null;
        const currentCycle = getCurrentBillingCycle(record || {});
        const endingBalance = getCanonicalEndingBalance(record || {});
        if (!record) {
            amountInput?.removeAttribute('max');
            if (summary) {
                summary.className = 'alert alert-info mb-0';
                summary.textContent = 'Select a customer to review the amount due or advance payment.';
            }
            return;
        }

        const isAdvancePayment = isPostGcashAdvancePaymentRecord(record);
        if (amountInput && !isAdvancePayment && Number.isFinite(endingBalance) && endingBalance > 0) {
            amountInput.max = endingBalance.toFixed(2);
        } else {
            amountInput?.removeAttribute('max');
        }
        if (summary) {
            const available = currentCycle && Number.isFinite(endingBalance);
            summary.className = `alert ${available ? 'alert-info' : 'alert-warning'} mb-0`;
            summary.textContent = available
                ? (isAdvancePayment
                    ? `${getPaymentRecordName(record)} | Advance Payment`
                    : `${getPaymentRecordName(record)} | Amount due: ${formatCurrency(endingBalance)}`)
                : `${getPaymentRecordName(record)} has no current billing cycle available.`;
        }
    };

    const addPostGcashAllocation = () => {
        if (!postGcashAllocations || getPostGcashAllocationRows().length >= 3) return;
        const allocationNumber = getPostGcashAllocationRows().length + 1;
        postGcashAccountPickerSequence += 1;
        const suggestionId = `queuePostGcashAccountSuggestions${postGcashAccountPickerSequence}`;
        postGcashAllocations.insertAdjacentHTML('beforeend', `
            <section class="card queue-gcash-allocation" data-gcash-allocation-row>
                <div class="card-body">
                    <div class="d-flex align-items-center justify-content-between gap-2 mb-3">
                        <strong data-gcash-allocation-title>Allocation ${allocationNumber}</strong>
                        <button type="button" class="btn btn-outline-danger btn-sm" data-action="remove-gcash-allocation">
                            <i class="ti ti-trash" aria-hidden="true"></i> Remove
                        </button>
                    </div>
                    <div class="row g-3">
                        <div class="col-lg-8">
                            <label class="form-label">Customer Account</label>
                            <div class="queue-gcash-account-picker" data-gcash-account-picker>
                                <input class="form-control" type="search" data-gcash-account-search role="combobox" aria-label="Customer Account" aria-autocomplete="list" aria-expanded="false" aria-controls="${suggestionId}" autocomplete="off" placeholder="Type client name or account number">
                                <input type="hidden" data-gcash-allocation-account>
                                <div class="queue-gcash-account-suggestions" id="${suggestionId}" data-gcash-account-suggestions role="listbox" hidden></div>
                            </div>
                            <div class="form-hint">Type a client name or account number, then choose a suggestion.</div>
                        </div>
                        <div class="col-lg-4">
                            <label class="form-label">Amount</label>
                            <input class="form-control" type="number" data-gcash-allocation-amount min="0.01" step="0.01" required>
                        </div>
                        <div class="col-12">
                            <div class="alert alert-info mb-0" data-gcash-allocation-summary role="status">
                                Select a customer to review the amount due or advance payment.
                            </div>
                        </div>
                    </div>
                </div>
            </section>`);
        const newRow = getPostGcashAllocationRows().at(-1);
        populatePostGcashAccounts(newRow);
        renumberPostGcashAllocationRows();
        renderPostGcashAllocationTotal();
        newRow?.querySelector('[data-gcash-account-search]')?.focus({ preventScroll: true });
    };

    const openPostGcashModal = async (transaction) => {
        if (!postGcashModal || !transaction) return;
        const reference = normalizeGcashReference(transaction.reference);
        if (!reference || transaction.assignment || transaction.postingLock || String(transaction.status || '').toLowerCase() !== 'received') return;
        resetPostGcashAllocations();
        state.activeGcashReference = reference;
        if (postGcashReferenceInput) postGcashReferenceInput.value = reference;
        if (postGcashAmountInput) postGcashAmountInput.value = Number(transaction.credit).toFixed(2);
        const firstAmountInput = getPostGcashAllocationRows()[0]?.querySelector('[data-gcash-allocation-amount]');
        if (firstAmountInput) firstAmountInput.value = Number(transaction.credit).toFixed(2);
        if (postGcashTransactionAtInput) postGcashTransactionAtInput.value = formatDateTime(transaction.transactionAt);
        if (postGcashRecipientInput) {
            postGcashRecipientInput.value = [transaction.recipientLabel, transaction.recipient]
                .map((value) => String(value || '').trim())
                .filter(Boolean)
                .join(' | ') || '-';
        }
        if (postGcashAccountSearch) {
            postGcashAccountSearch.value = '';
            postGcashAccountSearch.disabled = true;
            postGcashAccountSearch.placeholder = 'Loading customer accounts...';
        }
        if (postGcashAssignmentConfirmed) postGcashAssignmentConfirmed.checked = false;
        renderPostGcashAllocationTotal();
        postGcashModal.classList.add('show');
        postGcashModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-active');
        try {
            await loadPaymentRecordsForGcashPosting({ force: true });
            if (state.activeGcashReference !== reference) return;
            populatePostGcashAccounts();
            postGcashAccountSearch?.focus({ preventScroll: true });
        } catch (error) {
            getPostGcashAllocationRows().forEach((row) => {
                const accountSearch = row.querySelector('[data-gcash-account-search]');
                const accountInput = row.querySelector('[data-gcash-allocation-account]');
                const summary = row.querySelector('[data-gcash-allocation-summary]');
                if (accountSearch) {
                    accountSearch.value = '';
                    accountSearch.disabled = true;
                    accountSearch.placeholder = 'Customer billing records unavailable';
                }
                if (accountInput) accountInput.value = '';
                closePostGcashAccountSuggestions(row);
                if (summary) {
                    summary.className = 'alert alert-danger mb-0';
                    summary.textContent = error.message || 'Unable to load customer billing records.';
                }
            });
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
        if (approveAmountInput) approveAmountInput.readOnly = false;
        if (approveReferenceInput) approveReferenceInput.readOnly = false;
        if (approveAssignmentConfirmed) approveAssignmentConfirmed.checked = false;
        if (approveAssignmentGroup) approveAssignmentGroup.hidden = false;
        if (approveMeta) approveMeta.textContent = '';
        if (approveGcashMatch) {
            approveGcashMatch.hidden = true;
            approveGcashMatch.innerHTML = '';
        }
        if (approveProofAnalysis) {
            approveProofAnalysis.hidden = true;
            approveProofAnalysis.innerHTML = '';
        }
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
        state.activeReviewAction = 'reject';
        if (rejectEntryTitle) rejectEntryTitle.textContent = 'Reject Payment Proof';
        if (rejectEntrySubtitle) rejectEntrySubtitle.textContent = 'Reject this proof without posting a payment.';
        if (rejectEntryMeta) rejectEntryMeta.textContent = '';
        if (rejectReasonLabel) rejectReasonLabel.textContent = 'Rejection Reason';
        if (rejectReasonInput) rejectReasonInput.value = '';
        if (rejectSubmitBtn) rejectSubmitBtn.innerHTML = '<i class="ti ti-x" aria-hidden="true"></i> Reject';
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
        const isGcash = String(item.paymentMethod || '').trim().toLowerCase() === 'gcash';
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
            approveAmountInput.readOnly = isGcash;
        }

        if (approveReferenceInput) {
            approveReferenceInput.value = String(item.reviewedReference || item.reference || '').trim();
            approveReferenceInput.readOnly = isGcash;
        }

        if (approveAssignmentGroup) approveAssignmentGroup.hidden = !isGcash;
        if (approveAssignmentConfirmed) approveAssignmentConfirmed.checked = false;
        if (approveAssignmentLabel) {
            approveAssignmentLabel.textContent = accountNumber
                ? `I verified that this transaction belongs to ${customerName} (account ${accountNumber}) and this bill.`
                : 'I verified that this transaction belongs to the displayed customer account and bill.';
        }

        if (approveGcashMatch) {
            approveGcashMatch.hidden = !isGcash;
            approveGcashMatch.innerHTML = isGcash ? renderTransactionMatches(item) : '';
        }
        if (approveProofAnalysis) {
            const hasAnalysis = item.proofAnalysis && typeof item.proofAnalysis === 'object';
            approveProofAnalysis.hidden = !hasAnalysis;
            approveProofAnalysis.innerHTML = hasAnalysis ? renderProofAnalysis(item.proofAnalysis) : '';
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

    const openRejectEntryModal = (item, action = 'reject') => {
        if (!rejectEntryModal || !item) return;
        const itemId = String(item.id || '').trim();
        if (!itemId) return;

        state.activeRejectId = itemId;
        state.activeReviewAction = action === 'request-new-proof' ? 'request-new-proof' : 'reject';
        const requestsNewProof = state.activeReviewAction === 'request-new-proof';
        if (rejectEntryTitle) {
            rejectEntryTitle.textContent = requestsNewProof ? 'Request New Payment Proof' : 'Reject Payment Proof';
        }
        if (rejectEntrySubtitle) {
            rejectEntrySubtitle.textContent = requestsNewProof
                ? 'Tell the customer what must be corrected. No payment will be posted.'
                : 'Reject this proof without posting a payment.';
        }
        if (rejectReasonLabel) {
            rejectReasonLabel.textContent = requestsNewProof ? 'Instructions for Customer' : 'Rejection Reason';
        }
        if (rejectSubmitBtn) {
            rejectSubmitBtn.innerHTML = requestsNewProof
                ? '<i class="ti ti-photo-plus" aria-hidden="true"></i> Request New Proof'
                : '<i class="ti ti-x" aria-hidden="true"></i> Reject';
        }
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
                <td colspan="6" class="queue-empty">${escapeHtml(message || 'Something went wrong.')}</td>
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
                    <td colspan="6" class="queue-empty">No pending customer proof submissions. Imported GCash transactions are shown below.</td>
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
            const isGcash = String(item.paymentMethod || '').trim().toLowerCase() === 'gcash';
            const officialHistoryCell = isGcash
                ? renderTransactionMatches(item)
                : '<span class="text-secondary">Not applicable</span>';

            const actionCell = (() => {
                if (isPending) {
                    return `<div class="queue-row-actions">
                        <button type="button" class="approve-btn queue-icon-btn" data-action="approve" data-id="${escapeHtml(item.id)}" data-row-index="${rowIndex}" title="Approve &amp; Post" aria-label="Approve and post payment proof">
                            <i class="fa-solid fa-check"></i>
                        </button>
                        <button type="button" class="request-proof-btn queue-icon-btn" data-action="request-new-proof" data-id="${escapeHtml(item.id)}" data-row-index="${rowIndex}" title="Request New Proof" aria-label="Request a new payment proof">
                            <i class="ti ti-photo-plus"></i>
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
                    <span class="queue-status approved">Approved &amp; Posted</span>
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
                    <td>${officialHistoryCell}</td>
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

    const postGcashHistoryImport = async (file, password) => {
        const response = await fetch('/api/payment-confirmations/gcash-history/import', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/pdf',
                'X-PDF-Password': password,
                'X-PDF-File-Name': encodeURIComponent(String(file?.name || 'gcash-transaction-history.pdf'))
            },
            credentials: 'include',
            body: file
        });
        const rawText = await response.text();
        let data = {};
        try {
            data = rawText ? JSON.parse(rawText) : {};
        } catch {
            data = {};
        }
        if (!response.ok) {
            throw new Error(data.error || 'Unable to import the GCash Transaction History PDF.');
        }
        return data;
    };

    const postGcashHistoryPayment = async (reference, payload = {}) => {
        const response = await fetch(`/api/payment-confirmations/gcash-history/${encodeURIComponent(reference)}/post-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.error || 'Unable to post the imported GCash payment.');
            error.payload = data;
            throw error;
        }
        return data;
    };

    const putGcashHistoryRemark = async (reference, category) => {
        const response = await fetch(`/api/payment-confirmations/gcash-history/${encodeURIComponent(reference)}/remark`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ category })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to save the transaction remark.');
        return data;
    };

    const lockGcashHistoryPosting = async (reference, remark) => {
        const response = await fetch(`/api/payment-confirmations/gcash-history/${encodeURIComponent(reference)}/lock-posting`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ remark })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to mark this GCash credit Not for Posting.');
        return data;
    };

    const unlockGcashHistoryPosting = async (reference) => {
        const response = await fetch(`/api/payment-confirmations/gcash-history/${encodeURIComponent(reference)}/unlock-posting`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to unlock this GCash credit.');
        return data;
    };

    const getGcashHistoryCategory = (transaction = {}) => {
        const isReceived = String(transaction.status || '').toLowerCase() === 'received'
            && Number(transaction.credit) > 0;
        if (!isReceived) return 'debit';
        if (transaction.postingLock) return 'remarked';
        const assignment = transaction.assignment && typeof transaction.assignment === 'object'
            ? transaction.assignment
            : null;
        if (!assignment) return 'available';
        return String(assignment.status || '').toLowerCase() === 'posted' ? 'posted' : 'reserved';
    };

    const getGcashHistorySearchText = (transaction = {}) => {
        const assignment = transaction.assignment && typeof transaction.assignment === 'object'
            ? transaction.assignment
            : null;
        const allocations = Array.isArray(assignment?.allocations) && assignment.allocations.length
            ? assignment.allocations
            : (assignment ? [assignment] : []);
        const paymentHistoryAllocations = Array.isArray(transaction.paymentHistoryMatch?.allocations)
            ? transaction.paymentHistoryMatch.allocations
            : [];
        return [
            transaction.reference,
            transaction.description,
            transaction.sender,
            transaction.recipient,
            transaction.recipientLabel,
            transaction.status,
            transaction.remark?.category,
            transaction.postingLock?.remark,
            transaction.postingLock?.lockedBy?.name,
            transaction.postingLock?.lockedBy?.username,
            ...allocations.flatMap((allocation) => [allocation?.customerName, allocation?.accountNumber]),
            ...paymentHistoryAllocations.flatMap((allocation) => [allocation?.customerName, allocation?.accountNumber])
        ].map((value) => String(value || '').trim()).filter(Boolean).join(' ').toLowerCase();
    };

    const sumGcashHistoryAmount = (transactions, field) => transactions.reduce((total, transaction) => {
        const amount = Number(transaction?.[field]);
        return total + (Number.isFinite(amount) ? Math.abs(amount) : 0);
    }, 0);

    const renderGcashHistoryStats = (transactions, batches, totalTransactions) => {
        const grouped = {
            available: [],
            posted: [],
            remarked: [],
            debit: []
        };
        transactions.forEach((transaction) => {
            const category = getGcashHistoryCategory(transaction);
            if (grouped[category]) grouped[category].push(transaction);
        });
        const importedCount = Number.isFinite(Number(totalTransactions))
            ? Number(totalTransactions)
            : transactions.length;
        if (gcashHistoryStatTotal) gcashHistoryStatTotal.textContent = String(importedCount);
        if (gcashHistoryStatTotalMeta) {
            gcashHistoryStatTotalMeta.textContent = `${batches.length} official PDF${batches.length === 1 ? '' : 's'}`;
        }
        if (gcashHistoryStatAvailable) gcashHistoryStatAvailable.textContent = String(grouped.available.length);
        if (gcashHistoryStatAvailableMeta) {
            gcashHistoryStatAvailableMeta.textContent = `(${formatCurrency(sumGcashHistoryAmount(grouped.available, 'credit'))})`;
        }
        if (gcashHistoryStatPosted) gcashHistoryStatPosted.textContent = String(grouped.posted.length);
        if (gcashHistoryStatPostedMeta) {
            gcashHistoryStatPostedMeta.textContent = `(${formatCurrency(sumGcashHistoryAmount(grouped.posted, 'credit'))})`;
        }
        if (gcashHistoryStatRemarked) gcashHistoryStatRemarked.textContent = String(grouped.remarked.length);
        if (gcashHistoryStatRemarkedMeta) {
            gcashHistoryStatRemarkedMeta.textContent = `(${formatCurrency(sumGcashHistoryAmount(grouped.remarked, 'credit'))})`;
        }
        if (gcashHistoryStatDebit) gcashHistoryStatDebit.textContent = String(grouped.debit.length);
        if (gcashHistoryStatDebitMeta) {
            gcashHistoryStatDebitMeta.textContent = `(${formatCurrency(sumGcashHistoryAmount(grouped.debit, 'debit'))})`;
        }
    };

    const setGcashHistoryStatsUnavailable = () => {
        [gcashHistoryStatTotal, gcashHistoryStatAvailable, gcashHistoryStatPosted, gcashHistoryStatRemarked, gcashHistoryStatDebit]
            .filter(Boolean)
            .forEach((element) => { element.textContent = '—'; });
        [gcashHistoryStatTotalMeta, gcashHistoryStatAvailableMeta, gcashHistoryStatPostedMeta, gcashHistoryStatRemarkedMeta, gcashHistoryStatDebitMeta]
            .filter(Boolean)
            .forEach((element) => { element.textContent = 'History unavailable'; });
    };

    const getFilteredGcashHistoryTransactions = (transactions) => transactions.filter((transaction) => {
        const matchesFilter = state.gcashHistoryFilter === 'all'
            || getGcashHistoryCategory(transaction) === state.gcashHistoryFilter;
        const matchesSearch = !state.gcashHistorySearchTerm
            || getGcashHistorySearchText(transaction).includes(state.gcashHistorySearchTerm);
        return matchesFilter && matchesSearch;
    });

    const renderGcashHistoryError = (message) => {
        if (gcashHistorySummary) gcashHistorySummary.textContent = 'Imported history is unavailable.';
        if (gcashHistoryVisibleCount) gcashHistoryVisibleCount.textContent = 'Unable to load records';
        setGcashHistoryStatsUnavailable();
        if (gcashHistoryBody) {
            gcashHistoryBody.innerHTML = `
                <tr>
                    <td colspan="8" class="queue-empty">${escapeHtml(message || 'Unable to load imported GCash transactions.')}</td>
                </tr>
            `;
        }
    };

    const renderGcashHistory = (data = {}) => {
        const batches = Array.isArray(data.batches) ? data.batches : [];
        const transactions = Array.isArray(data.transactions) ? data.transactions : [];
        state.gcashHistoryBatches = batches;
        state.gcashHistoryTransactions = transactions;
        state.gcashTransactionsByReference = new Map(transactions.map((transaction) => [
            normalizeGcashReference(transaction?.reference),
            transaction
        ]));
        const totalTransactions = Number(data.totalTransactions) || transactions.length;
        state.gcashHistoryTotalTransactions = totalTransactions;
        const latestBatch = batches[0] || null;
        const visibleTransactions = getFilteredGcashHistoryTransactions(transactions);
        renderGcashHistoryStats(transactions, batches, totalTransactions);

        if (gcashHistoryVisibleCount) {
            const isFiltered = Boolean(state.gcashHistorySearchTerm) || state.gcashHistoryFilter !== 'all';
            gcashHistoryVisibleCount.textContent = isFiltered
                ? `Showing ${visibleTransactions.length} of ${transactions.length} records`
                : `Showing all ${transactions.length} records`;
        }

        if (gcashHistorySummary) {
            gcashHistorySummary.textContent = latestBatch?.importedAt
                ? `Last import: ${formatDateTime(latestBatch.importedAt)}`
                : 'No official PDF history imported yet.';
        }

        if (!gcashHistoryBody) return;
        if (!transactions.length) {
            gcashHistoryBody.innerHTML = `
                <tr>
                    <td colspan="8" class="queue-empty">No GCash Transaction History has been imported for this branch.</td>
                </tr>
            `;
            return;
        }

        if (!visibleTransactions.length) {
            gcashHistoryBody.innerHTML = `
                <tr>
                    <td colspan="8" class="queue-empty">No imported transactions match the current search and status filter.</td>
                </tr>
            `;
            return;
        }

        gcashHistoryBody.innerHTML = visibleTransactions.map((transaction) => {
            const isReceived = String(transaction.status || '').toLowerCase() === 'received'
                && Number(transaction.credit) > 0;
            const assignment = transaction.assignment && typeof transaction.assignment === 'object'
                ? transaction.assignment
                : null;
            const postingLock = transaction.postingLock && typeof transaction.postingLock === 'object'
                ? transaction.postingLock
                : null;
            const assignmentAllocations = assignment
                ? (Array.isArray(assignment.allocations) && assignment.allocations.length
                    ? assignment.allocations
                    : [{
                        accountNumber: assignment.accountNumber,
                        customerName: assignment.customerName,
                        billingMonth: assignment.billingMonth,
                        amount: assignment.amount
                    }])
                : [];
            const assignmentDetails = assignmentAllocations.map((allocation) => {
                const customerName = String(allocation?.customerName || '').trim();
                const amount = Number(allocation?.amount);
                return `<div class="gcash-match-allocation">
                    <span class="gcash-match-name">${escapeHtml(customerName || 'Assigned customer')}</span>
                    <span class="gcash-match-amount">${escapeHtml(Number.isFinite(amount) ? formatCurrency(amount) : '-')}</span>
                </div>`;
            }).join('');
            const paymentHistoryMatch = !assignment
                && !postingLock
                && transaction.paymentHistoryMatch
                && typeof transaction.paymentHistoryMatch === 'object'
                ? transaction.paymentHistoryMatch
                : null;
            const suggestedAllocations = Array.isArray(paymentHistoryMatch?.allocations)
                ? paymentHistoryMatch.allocations
                : [];
            const suggestionDetails = suggestedAllocations.map((allocation) => {
                const customerName = String(allocation?.customerName || '').trim();
                const amount = Number(allocation?.amount);
                return `<div class="gcash-match-allocation">
                    <span class="gcash-match-name">${escapeHtml(customerName || 'Suggested customer')}</span>
                    <span class="gcash-match-amount">${escapeHtml(Number.isFinite(amount) ? formatCurrency(amount) : '-')}</span>
                </div>`;
            }).join('');
            const postingLockAdmin = String(
                postingLock?.lockedBy?.name
                || postingLock?.lockedBy?.username
                || ''
            ).trim();
            const postingLockAudit = postingLock?.lockedAt
                ? `Locked ${formatDateTime(postingLock.lockedAt)}${postingLockAdmin ? ` by ${postingLockAdmin}` : ''}`
                : '';
            const matchBadge = postingLock
                ? `<div class="gcash-posting-lock-detail">
                       <span class="badge bg-purple-lt text-purple">Not for Posting</span>
                       <span class="gcash-posting-lock-remark">${escapeHtml(postingLock.remark || '-')}</span>
                       ${postingLockAudit ? `<small class="text-secondary">${escapeHtml(postingLockAudit)}</small>` : ''}
                   </div>`
                : (assignment
                    ? `<div class="gcash-match-list">${assignmentDetails}</div>`
                : (suggestionDetails
                    ? `<div class="gcash-match-list" title="${escapeHtml(paymentHistoryMatch.reason || 'Suggested from Payment History for Admin review.')}">${suggestionDetails}</div>`
                    : (isReceived
                        ? '<span class="badge bg-green-lt text-green">Available</span>'
                        : '<span class="text-secondary">-</span>')));
            const recipientLabel = String(transaction.recipientLabel || '').trim();
            const recipient = String(transaction.recipient || '').trim();
            const recipientCell = recipientLabel
                ? `<div>${escapeHtml(recipientLabel)}</div><small class="d-block text-secondary">${escapeHtml(recipient || '-')}</small>`
                : escapeHtml(recipient || '-');
            const debitAmount = Number(transaction.debit);
            const creditAmount = Number(transaction.credit);
            const direction = isReceived ? 'Credit' : 'Debit';
            const displayAmount = isReceived ? creditAmount : debitAmount;
            const amountCell = `<div class="fw-bold ${isReceived ? 'text-green' : 'text-red'}">${escapeHtml(formatCurrency(Math.abs(displayAmount)))}</div>
                <small class="d-block text-secondary">${direction}</small>`;
            const remarkCategory = String(transaction.remark?.category || '').trim();
            const remarkOptions = [
                '<option value="">Select remark</option>',
                ...GCASH_REMARK_OPTIONS.map((option) => (
                    `<option value="${option.value}"${option.value === remarkCategory ? ' selected' : ''}>${escapeHtml(option.label)}</option>`
                ))
            ].join('');
            const remarkAdmin = String(
                transaction.remark?.updatedBy?.name
                || transaction.remark?.updatedBy?.username
                || ''
            ).trim();
            const remarkUpdatedAt = String(transaction.remark?.updatedAt || '').trim();
            const remarkAudit = remarkUpdatedAt
                ? `Updated ${formatDateTime(remarkUpdatedAt)}${remarkAdmin ? ` by ${remarkAdmin}` : ''}`
                : '';
            const debitRemarkAction = `
                <div class="gcash-remark-editor gcash-remark-editor--compact">
                    <select class="form-select form-select-sm" data-gcash-remark-select data-reference="${escapeHtml(transaction.reference || '')}" aria-label="Remark for GCash reference ${escapeHtml(transaction.reference || '')}">
                        ${remarkOptions}
                    </select>
                    <button type="button" class="btn btn-icon btn-outline-primary btn-sm" data-action="save-gcash-remark" data-reference="${escapeHtml(transaction.reference || '')}" title="Save remark" aria-label="Save remark for GCash reference ${escapeHtml(transaction.reference || '')}"${remarkCategory ? '' : ' disabled'}>
                        <i class="ti ti-device-floppy" aria-hidden="true"></i>
                    </button>
                    ${remarkAudit ? `<small class="text-secondary gcash-remark-audit">${escapeHtml(remarkAudit)}</small>` : ''}
                </div>`;
            const creditAction = postingLock
                ? `<div class="gcash-credit-actions">
                       <span class="badge bg-purple-lt text-purple">Not for Posting</span>
                       <button type="button" class="btn btn-icon btn-outline-secondary btn-sm" data-action="unlock-gcash" data-reference="${escapeHtml(transaction.reference || '')}" title="Unlock for posting" aria-label="Unlock GCash reference ${escapeHtml(transaction.reference || '')} for posting">
                           <i class="ti ti-lock-open" aria-hidden="true"></i>
                       </button>
                   </div>`
                : (!assignment
                    ? `<div class="gcash-credit-actions">
                           <button type="button" class="btn btn-icon btn-primary btn-sm" data-action="post-gcash" data-reference="${escapeHtml(transaction.reference || '')}" title="Bind &amp; Post" aria-label="Bind and post GCash reference ${escapeHtml(transaction.reference || '')}">
                               <i class="ti ti-link" aria-hidden="true"></i>
                           </button>
                           <button type="button" class="btn btn-icon btn-outline-warning btn-sm" data-action="lock-gcash" data-reference="${escapeHtml(transaction.reference || '')}" title="Remark &amp; Lock" aria-label="Remark and lock GCash reference ${escapeHtml(transaction.reference || '')} as not for posting">
                               <i class="ti ti-message-lock" aria-hidden="true"></i>
                           </button>
                       </div>`
                    : `<span class="badge ${assignment.status === 'posted' ? 'bg-blue-lt text-blue' : 'bg-orange-lt text-orange'}">${assignment.status === 'posted' ? 'Posted' : 'Reserved'}</span>`);
            const actionCell = isReceived ? creditAction : debitRemarkAction;
            return `
                <tr>
                    <td>${escapeHtml(formatDateTime(transaction.transactionAt))}</td>
                    <td class="gcash-history-reference">${escapeHtml(transaction.reference || '-')}</td>
                    <td class="gcash-history-description">${escapeHtml(transaction.description || '-')}</td>
                    <td>${escapeHtml(transaction.sender || '-')}</td>
                    <td class="queue-amount-cell">${amountCell}</td>
                    <td>${recipientCell}</td>
                    <td>${matchBadge}</td>
                    <td>${actionCell}</td>
                </tr>
            `;
        }).join('');
    };

    const fetchGcashHistory = async () => {
        if (gcashHistoryRefreshButton) gcashHistoryRefreshButton.disabled = true;
        try {
            const response = await fetch('/api/payment-confirmations/gcash-history?limit=500', {
                credentials: 'include',
                cache: 'no-store'
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Unable to load imported GCash transactions.');
            renderGcashHistory(data);
        } catch (error) {
            renderGcashHistoryError(error.message || 'Unable to load imported GCash transactions.');
        } finally {
            if (gcashHistoryRefreshButton) gcashHistoryRefreshButton.disabled = false;
        }
    };

    const renderPendingGcashPayments = (payments = []) => {
        const rows = Array.isArray(payments) ? payments : [];
        state.pendingGcashPayments = rows;
        if (pendingGcashCount) pendingGcashCount.textContent = String(rows.length);
        if (pendingGcashSummary) {
            pendingGcashSummary.textContent = rows.length
                ? `${rows.length} manual GCash payment${rows.length === 1 ? '' : 's'} awaiting exact imported proof. No pending amount is included in billing.`
                : 'No manual GCash payments are awaiting imported proof.';
        }
        if (!pendingGcashBody) return;
        if (!rows.length) {
            pendingGcashBody.innerHTML = '<tr><td colspan="6" class="queue-empty">No pending GCash payments.</td></tr>';
            return;
        }
        pendingGcashBody.innerHTML = rows.map((payment) => `
            <tr>
                <td>${escapeHtml(payment.paymentDate || '-')}</td>
                <td>
                    <div class="fw-semibold">${escapeHtml(payment.customerName || 'Customer')}</div>
                    <small class="text-secondary">Account ${escapeHtml(payment.accountNumber || '-')}</small>
                </td>
                <td class="queue-amount-cell"><span class="fw-bold text-warning">${escapeHtml(formatCurrency(payment.amount))}</span></td>
                <td class="gcash-history-reference">${escapeHtml(payment.enteredReference || 'No entered reference')}</td>
                <td><span class="badge bg-warning-lt text-warning">Pending</span><small class="d-block text-secondary mt-1">Not posted</small></td>
                <td>
                    <button type="button" class="btn btn-primary btn-sm" data-action="bind-pending-gcash" data-account-number="${escapeHtml(payment.accountNumber || '')}" data-entry-id="${escapeHtml(payment.entryId || '')}">
                        <i class="ti ti-link" aria-hidden="true"></i> Bind proof
                    </button>
                </td>
            </tr>
        `).join('');
    };

    const renderPendingGcashError = (message) => {
        if (pendingGcashCount) pendingGcashCount.textContent = '—';
        if (pendingGcashSummary) pendingGcashSummary.textContent = 'Pending GCash payments are unavailable.';
        if (pendingGcashBody) {
            pendingGcashBody.innerHTML = `<tr><td colspan="6" class="queue-empty">${escapeHtml(message || 'Unable to load pending GCash payments.')}</td></tr>`;
        }
    };

    const fetchPendingGcashPayments = async () => {
        try {
            const response = await fetch('/api/payments/gcash-pending', {
                credentials: 'include',
                cache: 'no-store'
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || data.error || 'Unable to load pending GCash payments.');
            renderPendingGcashPayments(data.payments || []);
        } catch (error) {
            renderPendingGcashError(error.message);
        }
    };

    const openBindPendingGcashModal = async (payment) => {
        if (!bindPendingGcashModal || !payment) return;
        state.activePendingGcash = payment;
        bindPendingGcashForm?.reset();
        if (bindPendingGcashCustomer) {
            bindPendingGcashCustomer.value = `${payment.customerName || 'Customer'} | ${payment.accountNumber || '-'}`;
        }
        if (bindPendingGcashAmount) bindPendingGcashAmount.value = formatCurrency(payment.amount);
        if (bindPendingGcashDate) bindPendingGcashDate.value = payment.paymentDate || '-';
        if (bindPendingGcashEnteredReference) bindPendingGcashEnteredReference.value = payment.enteredReference || 'No entered reference';
        if (bindPendingGcashReference) {
            bindPendingGcashReference.disabled = true;
            bindPendingGcashReference.innerHTML = '<option value="">Loading exact matches...</option>';
        }
        if (bindPendingGcashNotice) {
            bindPendingGcashNotice.className = 'alert alert-warning mb-0';
            bindPendingGcashNotice.textContent = 'This pending entry has not changed the customer\'s billing balance.';
        }
        syncBindPendingGcashSubmit();
        bindPendingGcashModal.classList.add('show');
        bindPendingGcashModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-active');

        try {
            const response = await fetch(
                `/api/payments/gcash-pending/${encodeURIComponent(payment.accountNumber)}/${encodeURIComponent(payment.entryId)}/options`,
                { credentials: 'include', cache: 'no-store' }
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || data.error || 'Unable to load exact imported matches.');
            if (state.activePendingGcash?.entryId !== payment.entryId) return;
            const transactions = Array.isArray(data.transactions) ? data.transactions : [];
            if (bindPendingGcashReference) {
                bindPendingGcashReference.innerHTML = transactions.length
                    ? '<option value="">Select exact imported proof</option>' + transactions.map((transaction) => (
                        `<option value="${escapeHtml(transaction.reference || '')}">${escapeHtml(transaction.reference || '')} · ${escapeHtml(formatDateTime(transaction.transactionAt || transaction.transactionDate))} · ${escapeHtml(formatCurrency(transaction.amount))}</option>`
                    )).join('')
                    : '<option value="">No exact imported match available</option>';
                const enteredReference = normalizeGcashReference(payment.enteredReference);
                const exactReference = transactions.find((transaction) => (
                    normalizeGcashReference(transaction.reference) === enteredReference
                ));
                if (exactReference) bindPendingGcashReference.value = exactReference.reference;
                bindPendingGcashReference.disabled = !transactions.length;
            }
            if (bindPendingGcashNotice) {
                bindPendingGcashNotice.className = transactions.length
                    ? 'alert alert-info mb-0'
                    : 'alert alert-warning mb-0';
                bindPendingGcashNotice.textContent = transactions.length
                    ? `${transactions.length} exact imported match${transactions.length === 1 ? '' : 'es'} found. Select the official proof before posting.`
                    : 'No unassigned imported incoming credit has the exact amount and payment date. Import the official statement or correct the pending entry first.';
            }
            syncBindPendingGcashSubmit();
            bindPendingGcashReference?.focus({ preventScroll: true });
        } catch (error) {
            if (bindPendingGcashNotice) {
                bindPendingGcashNotice.className = 'alert alert-danger mb-0';
                bindPendingGcashNotice.textContent = error.message || 'Unable to load exact imported matches.';
            }
            if (bindPendingGcashReference) bindPendingGcashReference.disabled = true;
            syncBindPendingGcashSubmit();
        }
    };

    const submitBindPendingGcash = async (event) => {
        event.preventDefault();
        const payment = state.activePendingGcash;
        const reference = String(bindPendingGcashReference?.value || '').trim();
        if (!payment || !reference || bindPendingGcashConfirmed?.checked !== true || state.loading) return;
        setLoadingState(true);
        syncBindPendingGcashSubmit();
        try {
            const response = await fetch(
                `/api/payments/gcash-pending/${encodeURIComponent(payment.accountNumber)}/${encodeURIComponent(payment.entryId)}/bind`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        gcashReference: reference,
                        assignmentConfirmed: true
                    })
                }
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || data.error || 'Unable to verify and post this GCash payment.');
            closeBindPendingGcashModal();
            notify(data.message || 'Pending GCash payment verified and posted.', 'success');
            await Promise.all([fetchPendingGcashPayments(), fetchGcashHistory(), fetchQueue()]);
        } catch (error) {
            if (bindPendingGcashNotice) {
                bindPendingGcashNotice.className = 'alert alert-danger mb-0';
                bindPendingGcashNotice.textContent = error.message || 'Unable to verify and post this GCash payment.';
            }
        } finally {
            setLoadingState(false);
            syncBindPendingGcashSubmit();
        }
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
        const activeItem = getQueueItemById(id);
        const isGcash = String(activeItem?.paymentMethod || '').trim().toLowerCase() === 'gcash';
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
        if (isGcash && !approveAssignmentConfirmed?.checked) {
            notify('Confirm that this transaction belongs to the displayed customer account before approval.', 'error');
            approveAssignmentConfirmed?.focus();
            return;
        }

        if (approveSubmitBtn) approveSubmitBtn.disabled = true;
        setLoadingState(true);
        try {
            await postAction(id, 'approve', {
                amount: Number(amount.toFixed(2)),
                reference,
                assignmentConfirmed: isGcash ? true : undefined
            });
            closeApproveModal();
            notify('Payment approved and posted to the ledger.', 'success');
            await Promise.all([fetchQueue(), fetchGcashHistory()]);
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
        const action = state.activeReviewAction === 'request-new-proof' ? 'request-new-proof' : 'reject';
        const requestsNewProof = action === 'request-new-proof';
        if (!reason) {
            notify(requestsNewProof ? 'Instructions for the customer are required.' : 'Rejection reason is required.', 'error');
            rejectReasonInput?.focus();
            return;
        }

        if (rejectSubmitBtn) rejectSubmitBtn.disabled = true;
        setLoadingState(true);
        try {
            await postAction(id, action, { reason });
            closeRejectEntryModal();
            notify(requestsNewProof ? 'Customer was asked to submit new proof.' : 'Payment proof rejected.', 'success');
            await fetchQueue();
        } catch (error) {
            notify(error.message || (requestsNewProof ? 'Unable to request new proof.' : 'Unable to reject payment proof.'), 'error');
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
        openRejectEntryModal(item, 'reject');
    };

    const onRequestNewProof = async (item) => {
        if (!item) {
            notify('Unable to load payment request details.', 'error');
            return;
        }
        openRejectEntryModal(item, 'request-new-proof');
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

    const onImportGcashSubmit = async (event) => {
        event.preventDefault();
        if (state.loading) return;
        const file = importGcashFileInput?.files?.[0] || null;
        const password = String(importGcashPasswordInput?.value || '');
        if (!file) {
            notify('Select the GCash Transaction History PDF.', 'error');
            importGcashFileInput?.focus();
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            notify('The PDF is too large. Maximum size is 8 MB.', 'error');
            importGcashFileInput?.focus();
            return;
        }
        if (!password) {
            notify('Enter the PDF password.', 'error');
            importGcashPasswordInput?.focus();
            return;
        }

        setLoadingState(true);
        if (importGcashSubmitButton) importGcashSubmitButton.disabled = true;
        if (importGcashResult) {
            importGcashResult.className = 'alert alert-info queue-create-field--full';
            importGcashResult.textContent = 'Reading and validating the official GCash transactions...';
            importGcashResult.hidden = false;
        }
        try {
            const data = await postGcashHistoryImport(file, password);
            if (importGcashPasswordInput) importGcashPasswordInput.value = '';
            const importedCount = Number(data?.batch?.importedCount) || 0;
            const duplicateCount = Number(data?.duplicateCount) || 0;
            closeImportGcashModal();
            notify(`${importedCount} official GCash transaction(s) imported${duplicateCount ? `; ${duplicateCount} existing reference(s) skipped` : ''}.`, 'success');
            await Promise.all([fetchQueue(), fetchGcashHistory()]);
        } catch (error) {
            if (importGcashPasswordInput) importGcashPasswordInput.value = '';
            if (importGcashResult) {
                importGcashResult.className = 'alert alert-danger queue-create-field--full';
                importGcashResult.textContent = error.message || 'Unable to import the GCash history.';
                importGcashResult.hidden = false;
            }
            importGcashPasswordInput?.focus();
        } finally {
            if (importGcashSubmitButton) importGcashSubmitButton.disabled = false;
            setLoadingState(false);
        }
    };

    const onPostGcashSubmit = async (event) => {
        event.preventDefault();
        if (state.loading) return;
        const reference = normalizeGcashReference(state.activeGcashReference);
        const transaction = state.gcashTransactionsByReference.get(reference) || null;
        const amount = Number(postGcashAmountInput?.value);
        const allocationRows = getPostGcashAllocationRows();
        const allocations = allocationRows.map((row) => ({
            accountNumber: String(row.querySelector('[data-gcash-allocation-account]')?.value || '').trim(),
            amount: Number(row.querySelector('[data-gcash-allocation-amount]')?.value)
        }));
        if (!transaction || transaction.assignment || transaction.postingLock) {
            notify('This imported GCash transaction is no longer available.', 'error');
            closePostGcashModal();
            await fetchGcashHistory();
            return;
        }
        if (allocations.length < 1 || allocations.length > 3) {
            notify('Provide one to three customer allocations.', 'error');
            return;
        }
        const invalidIndex = allocations.findIndex((allocation) => (
            !allocation.accountNumber
            || !Number.isFinite(allocation.amount)
            || allocation.amount <= 0
        ));
        if (invalidIndex >= 0) {
            notify(`Complete the account and amount for allocation ${invalidIndex + 1}.`, 'error');
            const row = allocationRows[invalidIndex];
            row?.querySelector(
                !allocations[invalidIndex].accountNumber
                    ? '[data-gcash-account-search]'
                    : '[data-gcash-allocation-amount]'
            )?.focus();
            return;
        }
        if (new Set(allocations.map((allocation) => allocation.accountNumber)).size !== allocations.length) {
            notify('Each allocation must use a different customer account.', 'error');
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount - Number(transaction.credit)) > 0.009) {
            notify('The payment amount must exactly match the imported GCash credit.', 'error');
            return;
        }
        allocations.forEach((allocation) => {
            allocation.amount = Number(allocation.amount.toFixed(2));
        });
        const unavailableAccountIndex = allocations.findIndex((allocation) => {
            const record = state.paymentRecords.find((item) => (
                String(item?.accountNumber || '').trim() === allocation.accountNumber
            ));
            const endingBalance = getCanonicalEndingBalance(record || {});
            return !record || !getCurrentBillingCycle(record) || !Number.isFinite(endingBalance);
        });
        if (unavailableAccountIndex >= 0) {
            notify(`Allocation ${unavailableAccountIndex + 1} has no available current billing cycle.`, 'error');
            allocationRows[unavailableAccountIndex]?.querySelector('[data-gcash-account-search]')?.focus();
            return;
        }
        const overBalanceIndex = allocations.findIndex((allocation) => {
            const record = state.paymentRecords.find((item) => (
                String(item?.accountNumber || '').trim() === allocation.accountNumber
            ));
            const endingBalance = getCanonicalEndingBalance(record || {});
            return !isPostGcashAdvancePaymentRecord(record || {})
                && allocation.amount - endingBalance > 0.009;
        });
        if (overBalanceIndex >= 0) {
            const allocation = allocations[overBalanceIndex];
            const record = state.paymentRecords.find((item) => (
                String(item?.accountNumber || '').trim() === allocation.accountNumber
            ));
            notify(`Allocation ${overBalanceIndex + 1} cannot exceed the ending balance of ${formatCurrency(getCanonicalEndingBalance(record || {}))}.`, 'error');
            allocationRows[overBalanceIndex]?.querySelector('[data-gcash-allocation-amount]')?.focus();
            return;
        }
        const allocatedTotal = Number(allocations.reduce((sum, allocation) => sum + allocation.amount, 0).toFixed(2));
        if (Math.abs(allocatedTotal - amount) > 0.009) {
            notify(`Allocation total must equal ${formatCurrency(amount)}.`, 'error');
            return;
        }
        if (!postGcashAssignmentConfirmed?.checked) {
            notify('Confirm every allocation and the imported GCash total.', 'error');
            postGcashAssignmentConfirmed?.focus();
            return;
        }

        setLoadingState(true);
        if (postGcashSubmitButton) postGcashSubmitButton.disabled = true;
        try {
            await postGcashHistoryPayment(reference, {
                amount: Number(amount.toFixed(2)),
                allocations,
                assignmentConfirmed: true
            });
            closePostGcashModal();
            state.paymentRecords = [];
            notify(`Imported GCash transaction posted across ${allocations.length} customer ledger${allocations.length === 1 ? '' : 's'}.`, 'success');
            await Promise.all([fetchQueue(), fetchGcashHistory()]);
        } catch (error) {
            if (error?.payload?.code === 'DUPLICATE_PAYMENT_REFERENCE') {
                closePostGcashModal();
                openDuplicatePaymentModal(error.payload.duplicatePayment || {});
            } else {
                notify(error.message || 'Unable to post the imported GCash payment.', 'error');
            }
        } finally {
            if (postGcashSubmitButton) postGcashSubmitButton.disabled = false;
            setLoadingState(false);
        }
    };

    const onLockGcashSubmit = async (event) => {
        event.preventDefault();
        if (state.loading) return;
        const reference = normalizeGcashReference(state.activeLockGcashReference);
        const transaction = state.gcashTransactionsByReference.get(reference) || null;
        const remark = String(lockGcashRemarkInput?.value || '').trim();
        if (!transaction || transaction.assignment || transaction.postingLock) {
            notify('This imported GCash credit is no longer available to remark and lock.', 'error');
            closeLockGcashModal();
            await fetchGcashHistory();
            return;
        }
        if (!remark) {
            notify('Enter a remark before locking this GCash credit.', 'error');
            lockGcashRemarkInput?.focus();
            return;
        }

        setLoadingState(true);
        if (lockGcashSubmitButton) lockGcashSubmitButton.disabled = true;
        try {
            await lockGcashHistoryPosting(reference, remark);
            closeLockGcashModal();
            notify('GCash credit marked Not for Posting.', 'success');
            await Promise.all([fetchQueue(), fetchGcashHistory()]);
        } catch (error) {
            notify(error.message || 'Unable to mark this GCash credit Not for Posting.', 'error');
        } finally {
            if (lockGcashSubmitButton) lockGcashSubmitButton.disabled = false;
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
        if (action === 'request-new-proof') {
            await onRequestNewProof(item);
            return;
        }
        if (action === 'reject') {
            await onReject(item);
        }
    });

    gcashHistoryBody?.addEventListener('change', (event) => {
        const select = event.target.closest('select[data-gcash-remark-select][data-reference]');
        if (!select) return;
        const editor = select.closest('.gcash-remark-editor');
        const saveButton = editor?.querySelector('button[data-action="save-gcash-remark"]');
        if (saveButton) saveButton.disabled = !String(select.value || '').trim();
    });

    gcashHistoryBody?.addEventListener('click', async (event) => {
        const remarkButton = event.target.closest('button[data-action="save-gcash-remark"][data-reference]');
        if (remarkButton) {
            if (state.loading || remarkButton.disabled) return;
            const reference = normalizeGcashReference(remarkButton.getAttribute('data-reference'));
            const editor = remarkButton.closest('.gcash-remark-editor');
            const select = editor?.querySelector('select[data-gcash-remark-select]');
            const category = String(select?.value || '').trim();
            if (!reference || !category) {
                notify('Select a transaction remark before saving.', 'error');
                return;
            }
            remarkButton.disabled = true;
            try {
                await putGcashHistoryRemark(reference, category);
                notify('Transaction remark saved.', 'success');
                await fetchGcashHistory();
            } catch (error) {
                notify(error.message || 'Unable to save the transaction remark.', 'error');
                remarkButton.disabled = false;
            }
            return;
        }

        const lockButton = event.target.closest('button[data-action="lock-gcash"][data-reference]');
        if (lockButton) {
            if (state.loading) return;
            const reference = normalizeGcashReference(lockButton.getAttribute('data-reference'));
            const transaction = state.gcashTransactionsByReference.get(reference) || null;
            if (!transaction) {
                notify('Unable to load this imported transaction.', 'error');
                return;
            }
            openLockGcashModal(transaction);
            return;
        }

        const unlockButton = event.target.closest('button[data-action="unlock-gcash"][data-reference]');
        if (unlockButton) {
            if (state.loading) return;
            const reference = normalizeGcashReference(unlockButton.getAttribute('data-reference'));
            const transaction = state.gcashTransactionsByReference.get(reference) || null;
            if (!transaction?.postingLock) {
                notify('This GCash credit is already available for posting.', 'error');
                await fetchGcashHistory();
                return;
            }
            const confirmed = window.confirm(
                `Unlock GCash reference ${reference} and allow it to be assigned as a customer payment?`
            );
            if (!confirmed) return;
            setLoadingState(true);
            unlockButton.disabled = true;
            try {
                await unlockGcashHistoryPosting(reference);
                notify('GCash credit unlocked and available for posting.', 'success');
                await Promise.all([fetchQueue(), fetchGcashHistory()]);
            } catch (error) {
                notify(error.message || 'Unable to unlock this GCash credit.', 'error');
                unlockButton.disabled = false;
            } finally {
                setLoadingState(false);
            }
            return;
        }

        const postButton = event.target.closest('button[data-action="post-gcash"][data-reference]');
        if (!postButton || state.loading) return;
        const reference = normalizeGcashReference(postButton.getAttribute('data-reference'));
        const transaction = state.gcashTransactionsByReference.get(reference) || null;
        if (!transaction) {
            notify('Unable to load this imported transaction.', 'error');
            return;
        }
        await openPostGcashModal(transaction);
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

    importGcashButton?.addEventListener('click', openImportGcashModal);
    gcashHistoryRefreshButton?.addEventListener('click', () => {
        Promise.all([fetchGcashHistory(), fetchPendingGcashPayments()]);
    });
    gcashPageTabButtons.forEach((button) => {
        button.addEventListener('click', () => setGcashPageTab(button.dataset.gcashPageTab));
    });
    pendingGcashBody?.addEventListener('click', (event) => {
        const bindButton = event.target.closest('button[data-action="bind-pending-gcash"]');
        if (!bindButton) return;
        const payment = state.pendingGcashPayments.find((item) => (
            String(item?.accountNumber || '') === String(bindButton.dataset.accountNumber || '')
            && String(item?.entryId || '') === String(bindButton.dataset.entryId || '')
        ));
        if (payment) openBindPendingGcashModal(payment);
    });
    bindPendingGcashReference?.addEventListener('change', syncBindPendingGcashSubmit);
    bindPendingGcashConfirmed?.addEventListener('change', syncBindPendingGcashSubmit);
    bindPendingGcashForm?.addEventListener('submit', submitBindPendingGcash);
    bindPendingGcashModal?.addEventListener('click', (event) => {
        const dismissTarget = event.target.closest('[data-dismiss="queue-bind-pending-gcash-modal"]');
        if (dismissTarget || event.target === bindPendingGcashModal) closeBindPendingGcashModal();
    });
    gcashHistorySearch?.addEventListener('input', () => {
        state.gcashHistorySearchTerm = String(gcashHistorySearch.value || '').trim().toLowerCase();
        renderGcashHistory({
            batches: state.gcashHistoryBatches,
            transactions: state.gcashHistoryTransactions,
            totalTransactions: state.gcashHistoryTotalTransactions
        });
    });
    gcashHistoryFilter?.addEventListener('change', () => {
        state.gcashHistoryFilter = String(gcashHistoryFilter.value || 'all').trim().toLowerCase();
        renderGcashHistory({
            batches: state.gcashHistoryBatches,
            transactions: state.gcashHistoryTransactions,
            totalTransactions: state.gcashHistoryTotalTransactions
        });
    });
    importGcashForm?.addEventListener('submit', onImportGcashSubmit);
    importGcashModal?.addEventListener('click', (event) => {
        const dismissTarget = event.target.closest('[data-dismiss="queue-import-gcash-modal"]');
        if (dismissTarget) closeImportGcashModal();
    });
    lockGcashForm?.addEventListener('submit', onLockGcashSubmit);
    lockGcashModal?.addEventListener('click', (event) => {
        const dismissTarget = event.target.closest('[data-dismiss="queue-lock-gcash-modal"]');
        if (dismissTarget) closeLockGcashModal();
    });
    postGcashAddAllocationButton?.addEventListener('click', addPostGcashAllocation);
    postGcashAllocations?.addEventListener('focusin', (event) => {
        const searchInput = event.target.closest('[data-gcash-account-search]');
        if (!searchInput) return;
        const row = searchInput.closest('[data-gcash-allocation-row]');
        if (row) renderPostGcashAccountSuggestions(row);
    });
    postGcashAllocations?.addEventListener('input', (event) => {
        const row = event.target.closest('[data-gcash-allocation-row]');
        if (!row) return;
        if (event.target.matches('[data-gcash-account-search]')) {
            const accountInput = row.querySelector('[data-gcash-allocation-account]');
            if (accountInput) accountInput.value = '';
            updatePostGcashCurrentMonth(row);
            renderPostGcashAccountSuggestions(row);
        }
        if (event.target.matches('[data-gcash-allocation-amount]')) {
            renderPostGcashAllocationTotal();
        }
    });
    postGcashAllocations?.addEventListener('keydown', (event) => {
        const searchInput = event.target.closest('[data-gcash-account-search]');
        if (!searchInput) return;
        const row = searchInput.closest('[data-gcash-allocation-row]');
        const suggestions = row?.querySelector('[data-gcash-account-suggestions]');
        if (!row || !suggestions) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closePostGcashAccountSuggestions(row);
            return;
        }
        if (event.key === 'Tab') {
            closePostGcashAccountSuggestions(row);
            return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
        event.preventDefault();
        if (suggestions.hidden) renderPostGcashAccountSuggestions(row);
        const options = Array.from(suggestions.querySelectorAll('[data-gcash-account-option]'));
        if (!options.length) return;
        const activeId = searchInput.getAttribute('aria-activedescendant');
        const activeIndex = options.findIndex((option) => option.id === activeId);
        if (event.key === 'Enter') {
            const selectedOption = options[activeIndex >= 0 ? activeIndex : 0];
            selectPostGcashAccount(row, selectedOption.dataset.accountNumber);
            return;
        }
        const nextIndex = event.key === 'ArrowDown'
            ? (activeIndex + 1) % options.length
            : (activeIndex <= 0 ? options.length - 1 : activeIndex - 1);
        options.forEach((option, index) => {
            const active = index === nextIndex;
            option.classList.toggle('active', active);
            option.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        searchInput.setAttribute('aria-activedescendant', options[nextIndex].id);
        options[nextIndex].scrollIntoView({ block: 'nearest' });
    });
    postGcashAllocations?.addEventListener('pointerdown', (event) => {
        if (event.target.closest('[data-gcash-account-option]')) event.preventDefault();
    });
    postGcashAllocations?.addEventListener('click', (event) => {
        const accountOption = event.target.closest('[data-gcash-account-option]');
        if (accountOption) {
            const row = accountOption.closest('[data-gcash-allocation-row]');
            if (row) selectPostGcashAccount(row, accountOption.dataset.accountNumber);
            return;
        }
        const removeButton = event.target.closest('[data-action="remove-gcash-allocation"]');
        if (!removeButton) return;
        removeButton.closest('[data-gcash-allocation-row]')?.remove();
        renumberPostGcashAllocationRows();
        renderPostGcashAllocationTotal();
    });
    postGcashForm?.addEventListener('submit', onPostGcashSubmit);
    postGcashModal?.addEventListener('click', (event) => {
        const dismissTarget = event.target.closest('[data-dismiss="queue-post-gcash-modal"]');
        if (dismissTarget) closePostGcashModal();
        if (!event.target.closest('[data-gcash-account-picker]')) closePostGcashAccountSuggestions();
    });

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
        if (bindPendingGcashModal?.classList.contains('show')) {
            event.preventDefault();
            closeBindPendingGcashModal();
            return;
        }
        if (lockGcashModal?.classList.contains('show')) {
            event.preventDefault();
            closeLockGcashModal();
            return;
        }
        if (postGcashModal?.classList.contains('show')) {
            event.preventDefault();
            closePostGcashModal();
            return;
        }
        if (importGcashModal?.classList.contains('show')) {
            event.preventDefault();
            closeImportGcashModal();
            return;
        }
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
    setGcashPageTab('imported');
    fetchQueue();
    fetchGcashHistory();
    fetchPendingGcashPayments();
});
