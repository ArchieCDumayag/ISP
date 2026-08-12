(function () {
    const MAX_PROOF_BYTES = 4 * 1024 * 1024;
    const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const state = {
        amountDue: 0,
        configured: false,
        proofDataUrl: '',
        submissions: [],
        proofAnalysis: null,
        analyzing: false,
        analysisRequestId: 0,
        referenceTouched: false,
        paymentDateTouched: false
    };

    const nodes = {
        account: document.getElementById('proofPageAccount'),
        alert: document.getElementById('proofPageAlert'),
        merchantName: document.getElementById('proofMerchantName'),
        merchantNumber: document.getElementById('proofMerchantNumber'),
        exactAmount: document.getElementById('proofExactAmount'),
        dueDate: document.getElementById('proofDueDate'),
        qrImage: document.getElementById('proofQrImage'),
        qrEmpty: document.getElementById('proofQrEmpty'),
        form: document.getElementById('customerPaymentProofForm'),
        reference: document.getElementById('proofReference'),
        paymentDate: document.getElementById('proofPaymentDate'),
        amount: document.getElementById('proofAmount'),
        screenshot: document.getElementById('proofScreenshot'),
        notes: document.getElementById('proofNotes'),
        confirmation: document.getElementById('proofConfirmation'),
        previewWrap: document.getElementById('proofPreviewWrap'),
        previewImage: document.getElementById('proofPreviewImage'),
        removeImage: document.getElementById('proofRemoveImage'),
        analysisPanel: document.getElementById('proofAnalysisPanel'),
        analysisMessage: document.getElementById('proofAnalysisMessage'),
        analysisBadge: document.getElementById('proofAnalysisBadge'),
        analysisAmount: document.getElementById('proofAnalysisAmount'),
        analysisReference: document.getElementById('proofAnalysisReference'),
        analysisDate: document.getElementById('proofAnalysisDate'),
        analysisRecipient: document.getElementById('proofAnalysisRecipient'),
        analysisStatus: document.getElementById('proofAnalysisStatus'),
        analysisHistory: document.getElementById('proofAnalysisHistory'),
        analysisSource: document.getElementById('proofAnalysisSource'),
        analysisWarnings: document.getElementById('proofAnalysisWarnings'),
        submit: document.getElementById('proofSubmitButton'),
        refresh: document.getElementById('proofRefreshButton'),
        historyBody: document.getElementById('proofHistoryBody')
    };

    const currency = new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2
    });

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const formatCurrency = (value) => currency.format(Number(value) || 0);

    const formatDateTime = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '-';
        const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
        if (!Number.isFinite(parsed.getTime())) return raw;
        return parsed.toLocaleString('en-PH', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    };

    const statusPresentation = (status) => {
        const normalized = String(status || 'pending').toLowerCase();
        if (normalized === 'approved') return { label: 'Approved', className: 'bg-green-lt text-green' };
        if (normalized === 'rejected') return { label: 'Rejected', className: 'bg-red-lt text-red' };
        if (normalized === 'needs_new_proof') return { label: 'New proof requested', className: 'bg-orange-lt text-orange' };
        return { label: 'Pending review', className: 'bg-yellow-lt text-yellow' };
    };

    const analysisPresentation = (analysis) => {
        if (!analysis) return { label: 'Not analyzed', className: 'bg-secondary-lt text-secondary' };
        if (analysis.historyMatch?.matched) return { label: 'History match', className: 'bg-green-lt text-green' };
        if (analysis.state === 'error' || analysis.state === 'unreadable') return { label: 'Manual review', className: 'bg-orange-lt text-orange' };
        const checks = analysis.checks || {};
        if (Object.values(checks).some((value) => value === false)) return { label: 'Needs review', className: 'bg-red-lt text-red' };
        if (analysis.state === 'complete') return { label: 'Details extracted', className: 'bg-blue-lt text-blue' };
        return { label: 'Partially extracted', className: 'bg-yellow-lt text-yellow' };
    };

    const formatAnalysisStatus = (value) => {
        const status = String(value || 'unknown').toLowerCase();
        if (status === 'successful') return 'Successful';
        if (status === 'pending') return 'Pending';
        if (status === 'failed') return 'Failed';
        return 'Not detected';
    };

    const formatAnalysisSource = (analysis) => {
        const ai = analysis?.ai || {};
        if (ai.used) {
            const label = analysis?.source === 'vision_ai' ? 'Vision AI fallback' : 'Local OCR + Vision AI';
            return ai.confidence == null ? label : `${label} (${ai.confidence}% AI confidence)`;
        }
        if (ai.status === 'failed') return 'Local OCR (AI unavailable)';
        if (ai.status === 'not_configured') return 'Local OCR (AI not configured)';
        if (ai.status === 'skipped') return 'Local OCR (AI not needed)';
        return 'Local OCR';
    };

    const showAlert = (message, type = 'danger') => {
        const text = String(message || '').trim();
        if (!nodes.alert) return;
        nodes.alert.className = `alert alert-${type}`;
        nodes.alert.textContent = text;
        nodes.alert.hidden = !text;
        if (text) nodes.alert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    const apiJson = async (url, options = {}) => {
        const response = await fetch(url, {
            credentials: 'include',
            cache: 'no-store',
            ...options
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401) {
            window.location.href = '/customer-login.html';
            throw new Error('Customer login required.');
        }
        if (!response.ok || payload.ok === false) {
            throw new Error(payload.error || payload.message || `Request failed (${response.status})`);
        }
        return payload;
    };

    const setDefaultPaymentDate = () => {
        if (!nodes.paymentDate || nodes.paymentDate.value) return;
        const now = new Date();
        const local = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
        nodes.paymentDate.value = local.toISOString().slice(0, 16);
    };

    const resetAnalysis = () => {
        state.proofAnalysis = null;
        state.analyzing = false;
        state.analysisRequestId += 1;
        if (nodes.analysisPanel) nodes.analysisPanel.hidden = true;
        if (nodes.analysisWarnings) {
            nodes.analysisWarnings.hidden = true;
            nodes.analysisWarnings.textContent = '';
        }
    };

    const setAnalyzing = (analyzing) => {
        state.analyzing = Boolean(analyzing);
        if (nodes.analysisPanel) nodes.analysisPanel.hidden = false;
        if (nodes.analysisBadge) {
            nodes.analysisBadge.className = 'badge bg-blue-lt text-blue';
            nodes.analysisBadge.innerHTML = analyzing
                ? '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>Reading'
                : 'Waiting';
        }
        if (analyzing && nodes.analysisMessage) {
            nodes.analysisMessage.textContent = 'Running local OCR and using the configured Vision AI fallback only if needed...';
        }
        if (nodes.submit) {
            nodes.submit.disabled = Boolean(analyzing) || !state.configured || state.amountDue <= 0;
        }
    };

    const renderAnalysis = (analysis, message = '') => {
        state.proofAnalysis = analysis || null;
        state.analyzing = false;
        if (nodes.analysisPanel) nodes.analysisPanel.hidden = false;
        const presentation = analysisPresentation(analysis);
        if (nodes.analysisBadge) {
            nodes.analysisBadge.className = `badge ${presentation.className}`;
            nodes.analysisBadge.textContent = presentation.label;
        }
        if (nodes.analysisMessage) {
            nodes.analysisMessage.textContent = message || 'Screenshot details are available for review.';
        }
        const fields = analysis?.fields || {};
        if (nodes.analysisAmount) nodes.analysisAmount.textContent = fields.amount != null ? formatCurrency(fields.amount) : '-';
        if (nodes.analysisReference) nodes.analysisReference.textContent = fields.reference || '-';
        if (nodes.analysisDate) nodes.analysisDate.textContent = fields.transactionAt ? formatDateTime(fields.transactionAt) : '-';
        if (nodes.analysisRecipient) nodes.analysisRecipient.textContent = fields.recipient || fields.recipientNumber || '-';
        if (nodes.analysisStatus) nodes.analysisStatus.textContent = formatAnalysisStatus(fields.status);
        if (nodes.analysisHistory) {
            nodes.analysisHistory.textContent = analysis?.historyMatch?.matched
                ? 'Found and matched'
                : (analysis?.historyMatch?.message || 'Not matched yet');
        }
        if (nodes.analysisSource) nodes.analysisSource.textContent = formatAnalysisSource(analysis);
        const warnings = Array.isArray(analysis?.warnings) ? analysis.warnings.filter(Boolean) : [];
        if (nodes.analysisWarnings) {
            nodes.analysisWarnings.hidden = !warnings.length;
            nodes.analysisWarnings.innerHTML = warnings.length
                ? `<div class="fw-semibold mb-1">Needs Admin review</div><ul class="mb-0 ps-3">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
                : '';
        }
        if (fields.reference && nodes.reference && !String(nodes.reference.value || '').trim()) {
            nodes.reference.value = fields.reference;
        }
        if (fields.transactionAt && nodes.paymentDate && !state.paymentDateTouched) {
            nodes.paymentDate.value = String(fields.transactionAt).slice(0, 16);
        }
        if (nodes.submit) nodes.submit.disabled = !state.configured || state.amountDue <= 0;
    };

    const renderHistory = () => {
        if (!nodes.historyBody) return;
        if (!state.submissions.length) {
            nodes.historyBody.innerHTML = '<tr><td colspan="7" class="text-center text-secondary py-4">No payment proof submitted yet.</td></tr>';
            return;
        }
        nodes.historyBody.innerHTML = state.submissions.map((item) => {
            const status = statusPresentation(item.status);
            const analysis = analysisPresentation(item.proofAnalysis);
            const message = String(item.decisionReason || '').trim() || (item.status === 'pending' ? 'Waiting for Admin review.' : '-');
            return `
                <tr>
                    <td>${escapeHtml(formatDateTime(item.submittedAt))}</td>
                    <td class="fw-semibold">${escapeHtml(item.reference || '-')}</td>
                    <td>${escapeHtml(formatCurrency(item.amount))}</td>
                    <td>${escapeHtml(formatDateTime(item.paymentDate))}</td>
                    <td><span class="badge ${analysis.className}">${escapeHtml(analysis.label)}</span></td>
                    <td><span class="badge ${status.className}">${escapeHtml(status.label)}</span></td>
                    <td class="text-secondary">${escapeHtml(message)}</td>
                </tr>`;
        }).join('');
    };

    const applyContext = (payload) => {
        const customer = payload.customer || {};
        const gcash = payload.gcash || {};
        state.amountDue = Number(customer.amountDue) || 0;
        state.configured = Boolean(gcash.configured);
        state.submissions = Array.isArray(payload.submissions) ? payload.submissions : [];
        if (nodes.account) nodes.account.textContent = customer.accountNumber ? `Account ${customer.accountNumber}` : 'Customer account';
        if (nodes.merchantName) nodes.merchantName.textContent = gcash.accountName || 'Not configured';
        if (nodes.merchantNumber) nodes.merchantNumber.textContent = gcash.accountNumber || 'Not configured';
        if (nodes.exactAmount) nodes.exactAmount.textContent = formatCurrency(state.amountDue);
        if (nodes.amount) nodes.amount.value = state.amountDue.toFixed(2);
        if (nodes.dueDate) nodes.dueDate.textContent = customer.dueDate ? formatDateTime(customer.dueDate) : '-';
        if (nodes.qrImage && gcash.qrCodeImageData) {
            nodes.qrImage.src = gcash.qrCodeImageData;
            nodes.qrImage.hidden = false;
            if (nodes.qrEmpty) nodes.qrEmpty.hidden = true;
        } else {
            if (nodes.qrImage) {
                nodes.qrImage.hidden = true;
                nodes.qrImage.removeAttribute('src');
            }
            if (nodes.qrEmpty) nodes.qrEmpty.hidden = false;
        }
        if (nodes.submit) nodes.submit.disabled = !state.configured || state.amountDue <= 0;
        if (!state.configured) {
            showAlert('GCash merchant details are not configured. Please contact the ISP Admin before paying.', 'warning');
        } else if (state.amountDue <= 0) {
            showAlert('Your account has no payable balance right now.', 'success');
        } else {
            showAlert('');
        }
        renderHistory();
        setDefaultPaymentDate();
    };

    const loadContext = async () => {
        if (nodes.refresh) nodes.refresh.disabled = true;
        try {
            const payload = await apiJson('/api/customers/payments/proof/context');
            applyContext(payload);
        } catch (error) {
            showAlert(error.message || 'Unable to load payment details.');
            if (nodes.historyBody) {
                nodes.historyBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-4">Unable to load submissions.</td></tr>';
            }
        } finally {
            if (nodes.refresh) nodes.refresh.disabled = false;
        }
    };

    const clearSelectedImage = () => {
        state.proofDataUrl = '';
        resetAnalysis();
        if (nodes.screenshot) nodes.screenshot.value = '';
        if (nodes.previewImage) nodes.previewImage.removeAttribute('src');
        if (nodes.previewWrap) nodes.previewWrap.hidden = true;
    };

    const readSelectedImage = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Unable to read the selected screenshot.'));
        reader.readAsDataURL(file);
    });

    const analyzeSelectedImage = async (file, proofDataUrl) => {
        const requestId = state.analysisRequestId + 1;
        state.analysisRequestId = requestId;
        setAnalyzing(true);
        try {
            const payload = await apiJson('/api/customers/payments/proof/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reference: state.referenceTouched ? String(nodes.reference?.value || '').trim() : '',
                    paymentDate: state.paymentDateTouched ? (nodes.paymentDate?.value || '') : '',
                    proofImageData: proofDataUrl,
                    proofMimeType: file.type,
                    proofFileName: file.name
                })
            });
            if (requestId !== state.analysisRequestId) return;
            renderAnalysis(payload.analysis, payload.message);
        } catch (error) {
            if (requestId !== state.analysisRequestId) return;
            renderAnalysis({
                state: 'error',
                fields: { status: 'unknown' },
                warnings: [error.message || 'Screenshot analysis is unavailable. Admin will review it manually.']
            }, 'The screenshot could not be analyzed automatically.');
        }
    };

    const handleScreenshotChange = async () => {
        showAlert('');
        const file = nodes.screenshot?.files?.[0];
        if (!file) {
            clearSelectedImage();
            return;
        }
        if (!ALLOWED_TYPES.has(String(file.type || '').toLowerCase())) {
            clearSelectedImage();
            showAlert('Select a JPEG, PNG, or WebP screenshot.');
            return;
        }
        if (file.size > MAX_PROOF_BYTES) {
            clearSelectedImage();
            showAlert('The screenshot is larger than 4 MB.');
            return;
        }
        try {
            if (!state.referenceTouched && nodes.reference) nodes.reference.value = '';
            state.proofDataUrl = await readSelectedImage(file);
            if (nodes.previewImage) nodes.previewImage.src = state.proofDataUrl;
            if (nodes.previewWrap) nodes.previewWrap.hidden = false;
            await analyzeSelectedImage(file, state.proofDataUrl);
        } catch (error) {
            clearSelectedImage();
            showAlert(error.message);
        }
    };

    const setSubmitting = (submitting) => {
        if (!nodes.submit) return;
        nodes.submit.disabled = Boolean(submitting) || state.analyzing || !state.configured || state.amountDue <= 0;
        nodes.submit.innerHTML = submitting
            ? '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Submitting...'
            : '<i class="ti ti-upload me-1" aria-hidden="true"></i>Submit proof';
    };

    const submitProof = async (event) => {
        event.preventDefault();
        showAlert('');
        if (!nodes.form?.checkValidity()) {
            nodes.form?.classList.add('was-validated');
            return;
        }
        const file = nodes.screenshot?.files?.[0];
        if (!file || !state.proofDataUrl) {
            showAlert('Select a payment screenshot before submitting.');
            return;
        }
        if (state.analyzing) {
            showAlert('Wait for the screenshot analysis to finish before submitting.', 'warning');
            return;
        }
        if (!state.configured || state.amountDue <= 0) return;
        setSubmitting(true);
        try {
            const payload = await apiJson('/api/customers/payments/proof', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: state.amountDue,
                    reference: String(nodes.reference?.value || '').trim(),
                    paymentDate: nodes.paymentDate?.value || '',
                    notes: String(nodes.notes?.value || '').trim(),
                    proofImageData: state.proofDataUrl,
                    proofMimeType: file.type,
                    proofFileName: file.name
                })
            });
            nodes.form.reset();
            nodes.form.classList.remove('was-validated');
            state.referenceTouched = false;
            state.paymentDateTouched = false;
            clearSelectedImage();
            setDefaultPaymentDate();
            await loadContext();
            showAlert(payload.message || 'Payment proof submitted for review.', 'success');
        } catch (error) {
            showAlert(error.message || 'Unable to submit payment proof.');
        } finally {
            setSubmitting(false);
        }
    };

    nodes.form?.addEventListener('submit', submitProof);
    nodes.screenshot?.addEventListener('change', handleScreenshotChange);
    nodes.reference?.addEventListener('input', () => {
        state.referenceTouched = true;
    });
    nodes.paymentDate?.addEventListener('change', () => {
        state.paymentDateTouched = true;
    });
    nodes.removeImage?.addEventListener('click', clearSelectedImage);
    nodes.refresh?.addEventListener('click', loadContext);
    loadContext();
})();
