document.addEventListener('DOMContentLoaded', () => {
    const queueTableBody = document.getElementById('queueTableBody');
    const gcashHistoryBody = document.getElementById('queueGcashHistoryBody');
    const gcashHistorySummary = document.getElementById('queueGcashHistorySummary');
    const gcashHistoryRefreshButton = document.getElementById('queueGcashHistoryRefreshBtn');
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
    const postGcashAccountSelect = document.getElementById('queuePostGcashAccount');
    const postGcashBillingMonthSelect = document.getElementById('queuePostGcashBillingMonth');
    const postGcashAccountSummary = document.getElementById('queuePostGcashAccountSummary');
    const postGcashAssignmentConfirmed = document.getElementById('queuePostGcashAssignmentConfirmed');
    const postGcashSubmitButton = document.getElementById('queuePostGcashSubmitBtn');
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
        paymentRecords: [],
        activeGcashReference: '',
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

    const getOpenBillingRows = (record = {}) => {
        const rows = Array.isArray(record?.billingSummary?.rows) ? record.billingSummary.rows : [];
        return rows.filter((row) => {
            const month = String(row?.billingMonthKey || '').trim();
            const status = String(row?.paymentStatus || row?.paymentStatusLabel || '').trim().toLowerCase();
            return month && !['paid', 'complimentary'].includes(status);
        }).sort((left, right) => String(right.billingMonthKey).localeCompare(String(left.billingMonthKey)));
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

    const closePostGcashModal = () => {
        if (!postGcashModal) return;
        postGcashModal.classList.remove('show');
        postGcashModal.setAttribute('aria-hidden', 'true');
        postGcashForm?.reset();
        state.activeGcashReference = '';
        if (postGcashBillingMonthSelect) {
            postGcashBillingMonthSelect.innerHTML = '<option value="">Select a customer first</option>';
            postGcashBillingMonthSelect.disabled = true;
        }
        if (postGcashAccountSummary) {
            postGcashAccountSummary.className = 'alert alert-info queue-create-field--full';
            postGcashAccountSummary.textContent = 'Select a customer to review the canonical balance and open billing months.';
        }
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

    const populatePostGcashAccounts = () => {
        if (!postGcashAccountSelect) return;
        const records = state.paymentRecords
            .filter((record) => String(record?.accountNumber || '').trim() && getOpenBillingRows(record).length)
            .sort((left, right) => getPaymentRecordName(left).localeCompare(getPaymentRecordName(right)));
        postGcashAccountSelect.innerHTML = [
            '<option value="">Select a customer account</option>',
            ...records.map((record) => {
                const accountNumber = String(record.accountNumber || '').trim();
                const balance = Number(record?.billingSummary?.endingBalance ?? record.balance);
                const balanceLabel = Number.isFinite(balance) ? ` | Balance: ${formatCurrency(balance)}` : '';
                return `<option value="${escapeHtml(accountNumber)}">${escapeHtml(`${getPaymentRecordName(record)} | Acct: ${accountNumber}${balanceLabel}`)}</option>`;
            })
        ].join('');
    };

    const updatePostGcashBillingMonths = () => {
        if (!postGcashBillingMonthSelect) return;
        const accountNumber = String(postGcashAccountSelect?.value || '').trim();
        const record = state.paymentRecords.find((item) => String(item?.accountNumber || '').trim() === accountNumber) || null;
        const openRows = getOpenBillingRows(record || {});
        if (!record) {
            postGcashBillingMonthSelect.innerHTML = '<option value="">Select a customer first</option>';
            postGcashBillingMonthSelect.disabled = true;
            if (postGcashAccountSummary) {
                postGcashAccountSummary.className = 'alert alert-info queue-create-field--full';
                postGcashAccountSummary.textContent = 'Select a customer to review the canonical balance and open billing months.';
            }
            return;
        }

        postGcashBillingMonthSelect.innerHTML = openRows.length
            ? [
                '<option value="">Select an open billing month</option>',
                ...openRows.map((row) => {
                    const month = String(row.billingMonthKey || '').trim();
                    const status = String(row.paymentStatusLabel || row.paymentStatus || 'Open').trim();
                    const remaining = Number(row.balanceAfterPayment);
                    const remainingLabel = Number.isFinite(remaining) ? ` | Remaining: ${formatCurrency(remaining)}` : '';
                    return `<option value="${escapeHtml(month)}">${escapeHtml(`${formatBillingMonth(month)} | ${status}${remainingLabel}`)}</option>`;
                })
            ].join('')
            : '<option value="">No open billing month available</option>';
        postGcashBillingMonthSelect.disabled = !openRows.length;
        if (postGcashAccountSummary) {
            const balance = Number(record?.billingSummary?.endingBalance ?? record.balance);
            postGcashAccountSummary.className = openRows.length
                ? 'alert alert-info queue-create-field--full'
                : 'alert alert-warning queue-create-field--full';
            postGcashAccountSummary.textContent = openRows.length
                ? `${getPaymentRecordName(record)} | Acct: ${accountNumber} | Canonical balance: ${formatCurrency(balance)}`
                : `${getPaymentRecordName(record)} has no open billing month available for this payment.`;
        }
    };

    const openPostGcashModal = async (transaction) => {
        if (!postGcashModal || !transaction) return;
        const reference = normalizeGcashReference(transaction.reference);
        if (!reference || transaction.assignment || String(transaction.status || '').toLowerCase() !== 'received') return;
        state.activeGcashReference = reference;
        if (postGcashReferenceInput) postGcashReferenceInput.value = reference;
        if (postGcashAmountInput) postGcashAmountInput.value = Number(transaction.credit).toFixed(2);
        if (postGcashTransactionAtInput) postGcashTransactionAtInput.value = formatDateTime(transaction.transactionAt);
        if (postGcashRecipientInput) {
            postGcashRecipientInput.value = [transaction.recipientLabel, transaction.recipient]
                .map((value) => String(value || '').trim())
                .filter(Boolean)
                .join(' | ') || '-';
        }
        if (postGcashAccountSelect) postGcashAccountSelect.innerHTML = '<option value="">Loading customer accounts...</option>';
        if (postGcashBillingMonthSelect) {
            postGcashBillingMonthSelect.innerHTML = '<option value="">Select a customer first</option>';
            postGcashBillingMonthSelect.disabled = true;
        }
        if (postGcashAssignmentConfirmed) postGcashAssignmentConfirmed.checked = false;
        postGcashModal.classList.add('show');
        postGcashModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-active');
        try {
            await loadPaymentRecordsForGcashPosting({ force: true });
            if (state.activeGcashReference !== reference) return;
            populatePostGcashAccounts();
            postGcashAccountSelect?.focus({ preventScroll: true });
        } catch (error) {
            if (postGcashAccountSelect) postGcashAccountSelect.innerHTML = '<option value="">Customer billing records unavailable</option>';
            if (postGcashAccountSummary) {
                postGcashAccountSummary.className = 'alert alert-danger queue-create-field--full';
                postGcashAccountSummary.textContent = error.message || 'Unable to load customer billing records.';
            }
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

    const renderGcashHistoryError = (message) => {
        if (gcashHistorySummary) gcashHistorySummary.textContent = 'Imported history is unavailable.';
        if (gcashHistoryBody) {
            gcashHistoryBody.innerHTML = `
                <tr>
                    <td colspan="9" class="queue-empty">${escapeHtml(message || 'Unable to load imported GCash transactions.')}</td>
                </tr>
            `;
        }
    };

    const renderGcashHistory = (data = {}) => {
        const batches = Array.isArray(data.batches) ? data.batches : [];
        const transactions = Array.isArray(data.transactions) ? data.transactions : [];
        state.gcashTransactionsByReference = new Map(transactions.map((transaction) => [
            normalizeGcashReference(transaction?.reference),
            transaction
        ]));
        const totalTransactions = Number(data.totalTransactions) || transactions.length;
        const latestBatch = batches[0] || null;

        if (gcashHistorySummary) {
            const parts = [
                `${totalTransactions} transaction${totalTransactions === 1 ? '' : 's'} from ${batches.length} imported PDF${batches.length === 1 ? '' : 's'}`
            ];
            if (latestBatch?.importedAt) parts.push(`Last import: ${formatDateTime(latestBatch.importedAt)}`);
            if (latestBatch?.fileName) parts.push(String(latestBatch.fileName));
            gcashHistorySummary.textContent = parts.join(' | ');
        }

        if (!gcashHistoryBody) return;
        if (!transactions.length) {
            gcashHistoryBody.innerHTML = `
                <tr>
                    <td colspan="9" class="queue-empty">No GCash Transaction History has been imported for this branch.</td>
                </tr>
            `;
            return;
        }

        gcashHistoryBody.innerHTML = transactions.map((transaction) => {
            const isReceived = String(transaction.status || '').toLowerCase() === 'received'
                && Number(transaction.credit) > 0;
            const assignment = transaction.assignment && typeof transaction.assignment === 'object'
                ? transaction.assignment
                : null;
            const assignmentAccount = String(assignment?.accountNumber || '').trim();
            const assignmentCustomer = String(assignment?.customerName || '').trim();
            const assignmentMonth = String(assignment?.billingMonth || '').trim();
            const matchBadge = assignment
                ? `<span class="badge ${assignment.status === 'posted' ? 'bg-blue-lt text-blue' : 'bg-orange-lt text-orange'}">${assignment.status === 'posted' ? 'Assigned and Posted' : 'Reserved for approval'}</span>
                   <small class="d-block text-secondary mt-1">${escapeHtml([assignmentCustomer, assignmentAccount ? `Acct: ${assignmentAccount}` : '', assignmentMonth ? formatBillingMonth(assignmentMonth) : ''].filter(Boolean).join(' | ') || 'Assigned customer')}</small>`
                : (isReceived
                    ? '<span class="badge bg-green-lt text-green">Available</span>'
                    : '<span class="badge bg-secondary-lt text-secondary">Not an incoming credit</span>');
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
            const remarkCell = `
                <div class="gcash-remark-editor">
                    <select class="form-select form-select-sm" data-gcash-remark-select data-reference="${escapeHtml(transaction.reference || '')}" aria-label="Remark for GCash reference ${escapeHtml(transaction.reference || '')}">
                        ${remarkOptions}
                    </select>
                    <button type="button" class="btn btn-outline-primary btn-sm" data-action="save-gcash-remark" data-reference="${escapeHtml(transaction.reference || '')}"${remarkCategory ? '' : ' disabled'}>
                        <i class="ti ti-device-floppy" aria-hidden="true"></i> Save
                    </button>
                    ${remarkAudit ? `<small class="text-secondary gcash-remark-audit">${escapeHtml(remarkAudit)}</small>` : ''}
                </div>`;
            const actionCell = !assignment && isReceived
                ? `<button type="button" class="btn btn-primary btn-sm" data-action="post-gcash" data-reference="${escapeHtml(transaction.reference || '')}">
                       <i class="ti ti-link" aria-hidden="true"></i> Bind &amp; Post
                   </button>`
                : '<span class="text-secondary">-</span>';
            return `
                <tr>
                    <td>${escapeHtml(formatDateTime(transaction.transactionAt))}</td>
                    <td class="gcash-history-reference">${escapeHtml(transaction.reference || '-')}</td>
                    <td class="gcash-history-description">${escapeHtml(transaction.description || '-')}</td>
                    <td>${escapeHtml(transaction.sender || '-')}</td>
                    <td class="queue-amount-cell">${amountCell}</td>
                    <td>${recipientCell}</td>
                    <td>${matchBadge}</td>
                    <td>${remarkCell}</td>
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
        const accountNumber = String(postGcashAccountSelect?.value || '').trim();
        const billingMonth = String(postGcashBillingMonthSelect?.value || '').trim();
        const amount = Number(postGcashAmountInput?.value);
        if (!transaction || transaction.assignment) {
            notify('This imported GCash transaction is no longer available.', 'error');
            closePostGcashModal();
            await fetchGcashHistory();
            return;
        }
        if (!accountNumber) {
            notify('Select the customer account.', 'error');
            postGcashAccountSelect?.focus();
            return;
        }
        if (!billingMonth) {
            notify('Select an open billing month.', 'error');
            postGcashBillingMonthSelect?.focus();
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount - Number(transaction.credit)) > 0.009) {
            notify('The payment amount must exactly match the imported GCash credit.', 'error');
            return;
        }
        if (!postGcashAssignmentConfirmed?.checked) {
            notify('Confirm the customer, billing month, reference, recipient, and imported amount.', 'error');
            postGcashAssignmentConfirmed?.focus();
            return;
        }

        setLoadingState(true);
        if (postGcashSubmitButton) postGcashSubmitButton.disabled = true;
        try {
            await postGcashHistoryPayment(reference, {
                accountNumber,
                billingMonth,
                amount: Number(amount.toFixed(2)),
                assignmentConfirmed: true
            });
            closePostGcashModal();
            state.paymentRecords = [];
            notify('Imported GCash transaction assigned and posted to the customer ledger.', 'success');
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
    gcashHistoryRefreshButton?.addEventListener('click', fetchGcashHistory);
    importGcashForm?.addEventListener('submit', onImportGcashSubmit);
    importGcashModal?.addEventListener('click', (event) => {
        const dismissTarget = event.target.closest('[data-dismiss="queue-import-gcash-modal"]');
        if (dismissTarget) closeImportGcashModal();
    });
    postGcashAccountSelect?.addEventListener('change', updatePostGcashBillingMonths);
    postGcashForm?.addEventListener('submit', onPostGcashSubmit);
    postGcashModal?.addEventListener('click', (event) => {
        const dismissTarget = event.target.closest('[data-dismiss="queue-post-gcash-modal"]');
        if (dismissTarget) closePostGcashModal();
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
    fetchGcashHistory();
});
