document.addEventListener('DOMContentLoaded', () => {
    const API_BASE = '/api/messenger-reminders';
    const state = {
        entries: [],
        stats: {},
        view: 'active',
        selectedId: '',
        loading: false
    };

    const elements = {
        generateQueueBtn: document.getElementById('generateQueueBtn'),
        businessInboxBtn: document.getElementById('businessInboxBtn'),
        metaModeBadge: document.getElementById('metaModeBadge'),
        pendingMetric: document.getElementById('pendingMetric'),
        readyMetric: document.getElementById('readyMetric'),
        setupMetric: document.getElementById('setupMetric'),
        sentMetric: document.getElementById('sentMetric'),
        queueSearch: document.getElementById('queueSearch'),
        stageFilter: document.getElementById('stageFilter'),
        setupFilter: document.getElementById('setupFilter'),
        queueSummary: document.getElementById('queueSummary'),
        lastGeneratedText: document.getElementById('lastGeneratedText'),
        reminderRows: document.getElementById('reminderRows'),
        queueEmpty: document.getElementById('queueEmpty'),
        setupModal: document.getElementById('setupModal'),
        setupForm: document.getElementById('setupForm'),
        setupAccountNumber: document.getElementById('setupAccountNumber'),
        setupCustomerLabel: document.getElementById('setupCustomerLabel'),
        messengerLinkInput: document.getElementById('messengerLinkInput'),
        consentAllowedInput: document.getElementById('consentAllowedInput'),
        saveSetupBtn: document.getElementById('saveSetupBtn'),
        messageModal: document.getElementById('messageModal'),
        messageStageLabel: document.getElementById('messageStageLabel'),
        messageCustomerLabel: document.getElementById('messageCustomerLabel'),
        messageSetupStatus: document.getElementById('messageSetupStatus'),
        messagePreviewText: document.getElementById('messagePreviewText'),
        copyMessageBtn: document.getElementById('copyMessageBtn'),
        openMessengerBtn: document.getElementById('openMessengerBtn'),
        markSentBtn: document.getElementById('markSentBtn')
    };

    const escapeHtml = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const formatMoney = (value) => `₱${Number(value || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;

    const formatDateTime = (value, fallback = 'Never') => {
        if (!value) return fallback;
        const parsed = new Date(value);
        if (!Number.isFinite(parsed.getTime())) return String(value);
        return new Intl.DateTimeFormat('en-PH', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        }).format(parsed);
    };

    const showToast = (message, type = 'info') => {
        if (typeof window.appToast === 'function') {
            window.appToast(message, { type });
            return;
        }
        if (type === 'error') window.alert(message);
    };

    const requestJson = async (url, options = {}) => {
        const response = await fetch(url, {
            credentials: 'include',
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...(options.headers || {})
            }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || payload.message || `Request failed (${response.status}).`);
        }
        return payload;
    };

    const selectedEntry = () => state.entries.find((entry) => entry.id === state.selectedId) || null;

    const setModalOpen = (modal, open) => {
        if (!modal) return;
        modal.classList.toggle('is-open', open);
        modal.setAttribute('aria-hidden', open ? 'false' : 'true');
        document.body.style.overflow = open ? 'hidden' : '';
    };

    const stageBadgeClass = (stage) => ({
        advance: 'bg-blue-lt',
        due: 'bg-yellow-lt',
        overdue: 'bg-orange-lt',
        final: 'bg-red-lt',
        payment_confirmation: 'bg-green-lt'
    }[stage] || 'bg-secondary-lt');

    const statusBadge = (status) => {
        const config = {
            pending: ['Pending', 'bg-blue-lt'],
            sent: ['Sent', 'bg-green-lt'],
            skipped: ['Skipped', 'bg-yellow-lt'],
            resolved: ['Resolved', 'bg-secondary-lt'],
            superseded: ['Superseded', 'bg-secondary-lt']
        }[status] || [status || 'Unknown', 'bg-secondary-lt'];
        return `<span class="badge ${config[1]}">${escapeHtml(config[0])}</span>`;
    };

    const filterEntries = () => {
        const search = String(elements.queueSearch?.value || '').trim().toLowerCase();
        const stage = String(elements.stageFilter?.value || '');
        const setup = String(elements.setupFilter?.value || '');
        return state.entries.filter((entry) => {
            const haystack = [entry.customerName, entry.accountNumber, entry.area, entry.stageLabel]
                .join(' ')
                .toLowerCase();
            if (search && !haystack.includes(search)) return false;
            if (stage && entry.stage !== stage) return false;
            if (setup === 'ready' && !entry.canSend) return false;
            if (setup === 'setup' && !entry.setupRequired) return false;
            return true;
        });
    };

    const renderMetrics = () => {
        if (elements.pendingMetric) elements.pendingMetric.textContent = Number(state.stats.pending || 0);
        if (elements.readyMetric) elements.readyMetric.textContent = Number(state.stats.ready || 0);
        if (elements.setupMetric) elements.setupMetric.textContent = Number(state.stats.setupRequired || 0);
        if (elements.sentMetric) elements.sentMetric.textContent = Number(state.stats.sent || 0);
    };

    const renderRows = () => {
        const entries = filterEntries();
        if (elements.queueSummary) {
            elements.queueSummary.textContent = `${entries.length} reminder${entries.length === 1 ? '' : 's'} shown in ${state.view === 'active' ? 'the active queue' : 'history'}.`;
        }
        if (elements.queueEmpty) elements.queueEmpty.hidden = entries.length > 0;
        if (!elements.reminderRows) return;
        elements.reminderRows.innerHTML = entries.map((entry) => {
            const setupLines = [
                `<span class="messenger-setup-line ${entry.messengerLink ? 'is-ready' : 'is-missing'}"><i class="ti ${entry.messengerLink ? 'ti-link' : 'ti-link-off'}" aria-hidden="true"></i>${entry.messengerLink ? 'Messenger link ready' : 'Messenger link missing'}</span>`,
                `<span class="messenger-setup-line ${entry.consentAllowed ? 'is-ready' : 'is-missing'}"><i class="ti ${entry.consentAllowed ? 'ti-shield-check' : 'ti-shield-question'}" aria-hidden="true"></i>${entry.consentAllowed ? 'Consent recorded' : 'Consent not confirmed'}</span>`
            ].join('');
            const activeActions = entry.status === 'pending'
                ? `
                    <button class="btn btn-outline-secondary btn-sm messenger-action-btn" type="button" data-action="setup" data-id="${escapeHtml(entry.id)}"><i class="ti ti-settings" aria-hidden="true"></i> Setup</button>
                    <button class="btn btn-primary btn-sm messenger-action-btn" type="button" data-action="preview" data-id="${escapeHtml(entry.id)}"><i class="ti ti-message" aria-hidden="true"></i> Review</button>
                    <button class="btn btn-outline-warning btn-sm messenger-action-btn" type="button" data-action="skip" data-id="${escapeHtml(entry.id)}"><i class="ti ti-player-skip-forward" aria-hidden="true"></i> Skip</button>`
                : `
                    <button class="btn btn-outline-primary btn-sm messenger-action-btn" type="button" data-action="preview" data-id="${escapeHtml(entry.id)}"><i class="ti ti-eye" aria-hidden="true"></i> View</button>
                    ${['sent', 'skipped'].includes(entry.status) ? `<button class="btn btn-outline-secondary btn-sm messenger-action-btn" type="button" data-action="reopen" data-id="${escapeHtml(entry.id)}"><i class="ti ti-restore" aria-hidden="true"></i> Reopen</button>` : ''}`;
            const billingAmount = entry.stage === 'payment_confirmation'
                ? `Paid ${formatMoney(entry.paymentAmount)}`
                : formatMoney(entry.amountDue);
            const billingSubtext = entry.stage === 'payment_confirmation'
                ? `Remaining: ${formatMoney(entry.currentBalance)}`
                : `Due: ${escapeHtml(entry.dueDate || 'Not specified')}`;
            return `
                <tr data-reminder-id="${escapeHtml(entry.id)}">
                    <td class="messenger-customer-cell" data-label="Customer">
                        <div class="messenger-customer">
                            <strong title="${escapeHtml(entry.customerName)}">${escapeHtml(entry.customerName)}</strong>
                            <span>${escapeHtml(entry.accountNumber)} · ${escapeHtml(entry.area || 'Unassigned area')}</span>
                        </div>
                    </td>
                    <td class="messenger-billing-cell" data-label="Billing">
                        <div class="messenger-billing">
                            <strong>${billingAmount}</strong>
                            <span class="messenger-subtext">${billingSubtext}</span>
                        </div>
                    </td>
                    <td class="messenger-reminder-cell" data-label="Reminder">
                        <div class="messenger-stage">
                            <span class="badge ${stageBadgeClass(entry.stage)}">${escapeHtml(entry.stageLabel)}</span>
                            ${statusBadge(entry.status)}
                        </div>
                    </td>
                    <td class="messenger-setup-cell" data-label="Messenger &amp; consent"><div class="messenger-setup-state">${setupLines}</div></td>
                    <td class="messenger-last-sent-cell" data-label="Last sent">
                        <div class="messenger-billing">
                            <strong>${escapeHtml(formatDateTime(entry.lastReminderSent))}</strong>
                            <span class="messenger-subtext">${entry.sentBy?.name ? `By ${escapeHtml(entry.sentBy.name)}` : 'Audit history retained'}</span>
                        </div>
                    </td>
                    <td class="messenger-actions-cell" data-label="Actions"><div class="messenger-row-actions">${activeActions}</div></td>
                </tr>`;
        }).join('');
    };

    const applyQueuePayload = (payload = {}) => {
        state.entries = Array.isArray(payload.entries) ? payload.entries : [];
        state.stats = payload.stats || {};
        renderMetrics();
        renderRows();
        if (elements.lastGeneratedText) {
            elements.lastGeneratedText.textContent = payload.lastGeneratedAt
                ? `Last prepared ${formatDateTime(payload.lastGeneratedAt)}`
                : 'Not generated yet';
        }
    };

    const setGenerateBusy = (busy) => {
        state.loading = busy;
        if (!elements.generateQueueBtn) return;
        elements.generateQueueBtn.disabled = busy;
        elements.generateQueueBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
        elements.generateQueueBtn.innerHTML = busy
            ? '<i class="ti ti-loader-2 messenger-spin" aria-hidden="true"></i> Preparing…'
            : '<i class="ti ti-refresh" aria-hidden="true"></i> Prepare Queue';
    };

    const loadQueue = async () => {
        const payload = await requestJson(`${API_BASE}?view=${encodeURIComponent(state.view)}`);
        applyQueuePayload(payload);
    };

    const generateQueue = async ({ silent = false } = {}) => {
        if (state.loading) return;
        setGenerateBusy(true);
        try {
            const payload = await requestJson(`${API_BASE}/generate`, {
                method: 'POST',
                body: JSON.stringify({})
            });
            if (state.view === 'active') applyQueuePayload(payload);
            else await loadQueue();
            if (!silent) {
                const created = Number(payload.generated?.createdCount || 0);
                showToast(created ? `${created} Messenger reminder${created === 1 ? '' : 's'} added to the queue.` : 'Messenger reminder queue is up to date.', 'success');
            }
        } catch (error) {
            showToast(error.message || 'Unable to prepare the Messenger reminder queue.', 'error');
        } finally {
            setGenerateBusy(false);
        }
    };

    const loadMetaStatus = async () => {
        try {
            const payload = await requestJson(`${API_BASE}/meta-status`);
            if (elements.metaModeBadge) {
                elements.metaModeBadge.textContent = 'Manual review mode';
                elements.metaModeBadge.className = 'badge bg-blue-lt';
            }
            if (elements.businessInboxBtn && payload.businessInboxUrl) {
                elements.businessInboxBtn.href = payload.businessInboxUrl;
            }
        } catch (error) {
            if (elements.metaModeBadge) {
                elements.metaModeBadge.textContent = 'Setup unavailable';
                elements.metaModeBadge.className = 'badge bg-yellow-lt';
            }
        }
    };

    const openSetupModal = (entry) => {
        state.selectedId = entry.id;
        if (elements.setupAccountNumber) elements.setupAccountNumber.value = entry.accountNumber;
        if (elements.setupCustomerLabel) elements.setupCustomerLabel.textContent = `${entry.customerName} · ${entry.accountNumber}`;
        if (elements.messengerLinkInput) elements.messengerLinkInput.value = entry.messengerLink || '';
        if (elements.consentAllowedInput) elements.consentAllowedInput.checked = Boolean(entry.consentAllowed);
        setModalOpen(elements.setupModal, true);
        window.setTimeout(() => elements.messengerLinkInput?.focus(), 50);
    };

    const openMessageModal = (entry) => {
        state.selectedId = entry.id;
        if (elements.messageStageLabel) elements.messageStageLabel.textContent = entry.stageLabel || 'Reminder preview';
        if (elements.messageCustomerLabel) elements.messageCustomerLabel.textContent = `${entry.customerName} · ${entry.accountNumber}`;
        if (elements.messagePreviewText) elements.messagePreviewText.value = entry.message || '';
        if (elements.messageSetupStatus) {
            const ready = Boolean(entry.canSend);
            elements.messageSetupStatus.className = `message-preview-status ${ready ? 'is-ready' : 'is-warning'}`;
            elements.messageSetupStatus.textContent = ready
                ? 'Ready: Messenger link and customer consent are recorded.'
                : 'Setup required: add a Messenger link and record customer consent before marking this reminder as sent.';
        }
        if (elements.openMessengerBtn) elements.openMessengerBtn.disabled = !entry.messengerLink;
        if (elements.markSentBtn) {
            elements.markSentBtn.disabled = !entry.canSend || entry.status !== 'pending';
            elements.markSentBtn.hidden = entry.status !== 'pending';
        }
        setModalOpen(elements.messageModal, true);
    };

    const saveSetup = async (event) => {
        event.preventDefault();
        const accountNumber = String(elements.setupAccountNumber?.value || '').trim();
        if (!accountNumber) return;
        if (elements.saveSetupBtn) elements.saveSetupBtn.disabled = true;
        try {
            await requestJson(`${API_BASE}/preferences/${encodeURIComponent(accountNumber)}`, {
                method: 'PUT',
                body: JSON.stringify({
                    messengerLink: elements.messengerLinkInput?.value || '',
                    consentAllowed: Boolean(elements.consentAllowedInput?.checked)
                })
            });
            setModalOpen(elements.setupModal, false);
            await generateQueue({ silent: true });
            showToast('Messenger link and consent settings saved.', 'success');
        } catch (error) {
            showToast(error.message || 'Unable to save Messenger settings.', 'error');
        } finally {
            if (elements.saveSetupBtn) elements.saveSetupBtn.disabled = false;
        }
    };

    const copyMessage = async () => {
        const text = elements.messagePreviewText?.value || '';
        try {
            await navigator.clipboard.writeText(text);
            showToast('Messenger message copied.', 'success');
        } catch {
            elements.messagePreviewText?.select();
            document.execCommand('copy');
            showToast('Messenger message copied.', 'success');
        }
    };

    const openMessenger = () => {
        const entry = selectedEntry();
        if (!entry?.messengerLink) {
            showToast('Add a Messenger link first.', 'warning');
            return;
        }
        window.open(entry.messengerLink, '_blank', 'noopener,noreferrer');
        requestJson(`${API_BASE}/${encodeURIComponent(entry.id)}/opened`, {
            method: 'POST',
            body: JSON.stringify({})
        }).catch(() => {});
    };

    const markSent = async () => {
        const entry = selectedEntry();
        if (!entry) return;
        const confirmed = window.appConfirm
            ? await window.appConfirm('Confirm that you already sent this exact message through Messenger.', {
                title: 'Mark reminder as sent',
                okText: 'Mark as sent',
                cancelText: 'Cancel'
            })
            : window.confirm('Confirm that this exact message was sent through Messenger.');
        if (!confirmed) return;
        if (elements.markSentBtn) elements.markSentBtn.disabled = true;
        try {
            await requestJson(`${API_BASE}/${encodeURIComponent(entry.id)}/sent`, {
                method: 'POST',
                body: JSON.stringify({})
            });
            setModalOpen(elements.messageModal, false);
            await loadQueue();
            showToast('Reminder marked as sent.', 'success');
        } catch (error) {
            showToast(error.message || 'Unable to mark the reminder as sent.', 'error');
        } finally {
            if (elements.markSentBtn) elements.markSentBtn.disabled = false;
        }
    };

    const skipReminder = async (entry) => {
        const reason = window.prompt('Reason for skipping this reminder:', 'Customer already contacted through another channel.');
        if (reason === null) return;
        try {
            await requestJson(`${API_BASE}/${encodeURIComponent(entry.id)}/skip`, {
                method: 'POST',
                body: JSON.stringify({ reason })
            });
            await loadQueue();
            showToast('Reminder skipped.', 'success');
        } catch (error) {
            showToast(error.message || 'Unable to skip the reminder.', 'error');
        }
    };

    const reopenReminder = async (entry) => {
        try {
            await requestJson(`${API_BASE}/${encodeURIComponent(entry.id)}/reopen`, {
                method: 'POST',
                body: JSON.stringify({})
            });
            await loadQueue();
            showToast('Reminder returned to the active queue.', 'success');
        } catch (error) {
            showToast(error.message || 'Unable to reopen the reminder.', 'error');
        }
    };

    elements.generateQueueBtn?.addEventListener('click', () => generateQueue());
    elements.setupForm?.addEventListener('submit', saveSetup);
    elements.copyMessageBtn?.addEventListener('click', copyMessage);
    elements.openMessengerBtn?.addEventListener('click', openMessenger);
    elements.markSentBtn?.addEventListener('click', markSent);
    [elements.queueSearch, elements.stageFilter, elements.setupFilter].forEach((control) => {
        control?.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', renderRows);
    });

    document.querySelectorAll('.messenger-view-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            state.view = button.dataset.view || 'active';
            document.querySelectorAll('.messenger-view-btn').forEach((item) => {
                const active = item === button;
                item.classList.toggle('active', active);
                item.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
            try {
                await loadQueue();
            } catch (error) {
                showToast(error.message || 'Unable to load reminder history.', 'error');
            }
        });
    });

    elements.reminderRows?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-action][data-id]');
        if (!button) return;
        const entry = state.entries.find((item) => item.id === button.dataset.id);
        if (!entry) return;
        const action = button.dataset.action;
        if (action === 'setup') openSetupModal(entry);
        if (action === 'preview') openMessageModal(entry);
        if (action === 'skip') skipReminder(entry);
        if (action === 'reopen') reopenReminder(entry);
    });

    document.querySelectorAll('[data-close-modal]').forEach((button) => {
        button.addEventListener('click', () => {
            const modal = document.getElementById(button.dataset.closeModal);
            setModalOpen(modal, false);
        });
    });
    [elements.setupModal, elements.messageModal].forEach((modal) => {
        modal?.addEventListener('click', (event) => {
            if (event.target === modal) setModalOpen(modal, false);
        });
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        setModalOpen(elements.setupModal, false);
        setModalOpen(elements.messageModal, false);
    });

    Promise.all([loadMetaStatus(), generateQueue({ silent: true })]).catch(() => {});
});
