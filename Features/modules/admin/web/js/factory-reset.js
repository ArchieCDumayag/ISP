document.addEventListener('DOMContentLoaded', () => {
    const panel = document.getElementById('data-reset');
    if (!panel) return;

    const refreshButton = document.getElementById('factory-reset-refresh');
    const form = document.getElementById('factory-reset-form');
    const passwordInput = document.getElementById('factory-reset-password');
    const confirmationInput = document.getElementById('factory-reset-confirmation');
    const acknowledgeInput = document.getElementById('factory-reset-acknowledge');
    const submitButton = document.getElementById('factory-reset-submit');
    const recordCount = document.getElementById('factory-reset-record-count');
    const fileCount = document.getElementById('factory-reset-file-count');
    const storageDriver = document.getElementById('factory-reset-storage-driver');
    const categoryList = document.getElementById('factory-reset-category-list');
    const preservedList = document.getElementById('factory-reset-preserved-list');
    const resultBox = document.getElementById('factory-reset-result');
    const confirmationPhrase = 'CLEAR ALL DATA';
    let previewLoaded = false;
    let resetRunning = false;

    const formatCount = (value) => new Intl.NumberFormat('en-PH').format(Number(value || 0));

    const showResult = (message, tone = 'error') => {
        resultBox.textContent = String(message || '');
        resultBox.hidden = !message;
        resultBox.classList.toggle('factory-reset-result--error', tone === 'error');
        resultBox.classList.toggle('factory-reset-result--success', tone === 'success');
    };

    const updateSubmitState = () => {
        const ready = previewLoaded
            && !resetRunning
            && Boolean(passwordInput.value)
            && confirmationInput.value.trim() === confirmationPhrase
            && acknowledgeInput.checked;
        submitButton.disabled = !ready;
    };

    const fetchJson = async (url, options = {}) => {
        const response = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
        return payload;
    };

    const renderPreview = (preview) => {
        recordCount.textContent = formatCount(preview.recordCount);
        fileCount.textContent = formatCount(preview.fileCount);
        storageDriver.textContent = String(preview.storageDriver || 'unknown').toUpperCase();

        const categories = Array.isArray(preview.categories) ? preview.categories : [];
        categoryList.replaceChildren(...categories
            .filter((item) => Number(item.count || 0) > 0)
            .map((item) => {
                const row = document.createElement('li');
                const label = document.createElement('span');
                const count = document.createElement('strong');
                label.textContent = item.label || item.key || 'Records';
                count.textContent = formatCount(item.count);
                row.append(label, count);
                return row;
            }));
        if (!categoryList.children.length) {
            const empty = document.createElement('li');
            empty.textContent = 'No operational records are currently stored.';
            categoryList.append(empty);
        }

        const preserved = Array.isArray(preview.preserved) ? preview.preserved : [];
        preservedList.replaceChildren(...preserved.map((text) => {
            const row = document.createElement('li');
            row.textContent = text;
            return row;
        }));
        previewLoaded = true;
        updateSubmitState();
    };

    const loadPreview = async ({ preserveResult = false } = {}) => {
        previewLoaded = false;
        updateSubmitState();
        if (!preserveResult) showResult('');
        const unlock = window.withButtonLock
            ? window.withButtonLock(refreshButton, { label: '<i class="ti ti-loader-2 ti-spin"></i> Checking…' })
            : null;
        if (window.withButtonLock && !unlock) return;
        try {
            renderPreview(await fetchJson('/api/admin-data-reset/preview'));
        } catch (error) {
            categoryList.innerHTML = '<li>Unable to load reset scope.</li>';
            showResult(error.message || 'Unable to inspect project records.');
        } finally {
            if (unlock) unlock();
        }
    };

    [passwordInput, confirmationInput, acknowledgeInput].forEach((input) => {
        input.addEventListener('input', updateSubmitState);
        input.addEventListener('change', updateSubmitState);
    });

    refreshButton.addEventListener('click', loadPreview);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        updateSubmitState();
        if (submitButton.disabled) return;

        const finalQuestion = 'Permanently clear every project record and stored backup now? Admin accounts and system configuration will remain.';
        const confirmed = window.appConfirm
            ? await window.appConfirm(finalQuestion, { title: 'Clear All Project Data', confirmText: 'Clear Everything', danger: true })
            : window.confirm(finalQuestion);
        if (!confirmed) return;

        resetRunning = true;
        showResult('');
        updateSubmitState();
        const originalLabel = submitButton.innerHTML;
        submitButton.innerHTML = '<i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i> Clearing data…';
        try {
            const result = await fetchJson('/api/admin-data-reset', {
                method: 'POST',
                body: JSON.stringify({
                    password: passwordInput.value,
                    confirmation: confirmationInput.value.trim(),
                    acknowledgeIrreversible: acknowledgeInput.checked
                })
            });
            passwordInput.value = '';
            confirmationInput.value = '';
            acknowledgeInput.checked = false;
            showResult(
                `${result.message} Cleared ${formatCount(result.recordsCleared)} record entries and ${formatCount(result.filesCleared)} stored files.`,
                result.warnings?.length ? 'error' : 'success'
            );
            await loadPreview({ preserveResult: true });
        } catch (error) {
            showResult(error.message || 'Factory reset failed.');
        } finally {
            resetRunning = false;
            submitButton.innerHTML = originalLabel;
            updateSubmitState();
        }
    });

    const resetTabButton = document.getElementById('settings-tab-data-reset');
    resetTabButton?.addEventListener('click', () => {
        if (!previewLoaded) loadPreview();
    });
    if (window.location.hash === '#data-reset') loadPreview();
});
