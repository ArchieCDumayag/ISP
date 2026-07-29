(() => {
    const openBtn = document.getElementById('openPushModalBtn');
    const modal = document.getElementById('pushNotificationModal');
    const historyModal = document.getElementById('pushHistoryModal');
    const closeBtn = document.getElementById('closePushModalBtn');
    const closeHistoryBtn = document.getElementById('closePushHistoryModalBtn');
    const cancelBtn = document.getElementById('cancelPushModalBtn');
    const form = document.getElementById('pushNotificationForm');
    const saveBtn = document.getElementById('savePushNotificationBtn');
    const modalTitle = document.getElementById('pushModalTitle');
    const historyTitle = document.getElementById('pushHistoryTitle');
    const historyList = document.getElementById('pushHistoryList');
    const historyEmpty = document.getElementById('pushHistoryEmpty');
    const statusEl = document.getElementById('pushModalStatus');
    const pushPageButtons = Array.from(document.querySelectorAll('[data-push-page]'));
    const pushPagePanels = Array.from(document.querySelectorAll('[data-push-page-panel]'));
    const ruleList = document.getElementById('pushRuleList');
    const emptyState = document.getElementById('pushEmptyState');
    const activeCount = document.getElementById('pushActiveCount');
    const completedRuleList = document.getElementById('pushCompletedRuleList');
    const completedEmptyState = document.getElementById('pushCompletedEmptyState');
    const completedCount = document.getElementById('pushCompletedCount');
    const pushConfigState = document.getElementById('pushConfigState');
    const pushDeviceCount = document.getElementById('pushDeviceCount');

    const templateInput = document.getElementById('pushTemplate');
    const titleInput = document.getElementById('pushTitle');
    const messageInput = document.getElementById('pushMessage');
    const areaSelect = document.getElementById('pushAreas');
    const customerSelect = document.getElementById('pushCustomers');
    const areaSearchInput = document.getElementById('pushAreaSearch');
    const customerSearchInput = document.getElementById('pushCustomerSearch');
    const areaList = document.getElementById('pushAreaList');
    const customerList = document.getElementById('pushCustomerList');
    const areaCount = document.getElementById('pushAreaCount');
    const customerCount = document.getElementById('pushCustomerCount');
    const areaSelectField = document.getElementById('areaSelectField');
    const customerSelectField = document.getElementById('customerSelectField');
    const scheduleAtField = document.getElementById('scheduleAtField');
    const eventFields = document.getElementById('eventFields');
    const scheduleAtInput = document.getElementById('pushScheduleAt');
    const eventTypeInput = document.getElementById('pushEventType');
    const delayDirectionInput = document.getElementById('pushDelayDirection');
    const delayAmountInput = document.getElementById('pushDelayAmount');
    const delayUnitInput = document.getElementById('pushDelayUnit');

    const state = {
        notifications: [],
        customers: [],
        areas: [],
        editingNotificationId: ''
    };
    const MAX_PICKER_ITEMS = 120;

    const PUSH_TEMPLATES = [
        {
            id: 'billing-reminder',
            name: 'Billing Reminder',
            title: 'Billing Reminder',
            triggerMode: 'event',
            eventType: 'due-date',
            delayDirection: 'before',
            delayAmount: 1,
            delayUnit: 'days',
            message: 'Hi {customer_name}, your internet bill of {amount_due} is due on {due_date}. Please settle before your due date to keep your fiber connection active.'
        },
        {
            id: 'payment-received',
            name: 'Payment Received',
            title: 'Payment Received',
            triggerMode: 'schedule',
            message: 'Hi {customer_name}, we received your payment of {amount} on {payment_date}. Your remaining balance is {balance}. Thank you for staying current.'
        },
        {
            id: 'overdue-balance',
            name: 'Overdue Balance',
            title: 'Overdue Account Notice',
            triggerMode: 'event',
            eventType: 'overdue',
            delayDirection: 'after',
            delayAmount: 0,
            delayUnit: 'days',
            message: 'Hi {customer_name}, your account has an overdue balance of {amount_due}. Kindly settle within {grace_period} to avoid temporary internet service interruption.'
        },
        {
            id: 'fiber-maintenance',
            name: 'Fiber Maintenance',
            title: 'Scheduled Fiber Maintenance',
            triggerMode: 'schedule',
            message: 'Hi {customer_name}, scheduled fiber maintenance may affect service in {area_name} on {date}. Our team will restore connectivity as soon as work is complete.'
        },
        {
            id: 'fiber-outage',
            name: 'Fiber Outage Advisory',
            title: 'Fiber Service Advisory',
            triggerMode: 'schedule',
            message: 'Hi {customer_name}, we detected a fiber service issue affecting {area_name}. Our technical team is already checking the line and will update you once service is stable.'
        },
        {
            id: 'service-restored',
            name: 'Service Restored',
            title: 'Internet Service Restored',
            triggerMode: 'schedule',
            message: 'Good news {customer_name}, fiber service in {area_name} has been restored. Please restart your router if your internet connection has not returned yet.'
        },
        {
            id: 'technician-visit',
            name: 'Technician Visit',
            title: 'Technician Visit Schedule',
            triggerMode: 'schedule',
            message: 'Hi {customer_name}, our technician is scheduled to visit your location for account {account_number} on {date}. Please keep your contact line available.'
        },
        {
            id: 'job-order-created',
            name: 'Job Order Created',
            title: 'Job Order Created',
            triggerMode: 'schedule',
            message: 'Hi {customer_name}, a job order has been created for your fiber account {account_number}. Our support team will contact you for the schedule.'
        },
        {
            id: 'plan-update',
            name: 'Plan Update',
            title: 'Plan Update',
            triggerMode: 'schedule',
            message: 'Hi {customer_name}, your current internet plan is {plan_name}. Please contact our office if you want to request a speed upgrade or plan adjustment.'
        },
        {
            id: 'app-update',
            name: 'Customer App Notice',
            title: 'Customer App Notice',
            triggerMode: 'schedule',
            message: 'Hi {customer_name}, please keep your customer app updated so you can receive billing reminders, payment notices, and fiber service advisories.'
        }
    ];

    const setStatus = (message, type = 'success') => {
        if (!statusEl) return;
        statusEl.textContent = message || '';
        statusEl.classList.toggle('is-error', type === 'error');
    };

    const setBusy = (button, busy) => {
        if (!button) return;
        button.disabled = Boolean(busy);
        if (busy) {
            button.setAttribute('aria-busy', 'true');
        } else {
            button.removeAttribute('aria-busy');
        }
    };

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const titleCase = (value) => String(value || '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());

    const getCheckedValue = (name, fallback) => {
        const checked = form?.querySelector(`input[name="${name}"]:checked`);
        return String(checked?.value || fallback || '').trim();
    };

    const getSelectedValues = (select) => Array.from(select?.selectedOptions || [])
        .map((option) => option.value)
        .filter(Boolean);

    const getSelectedSet = (select) => new Set(getSelectedValues(select));

    const setSelectedValues = (select, values = []) => {
        const selected = new Set((Array.isArray(values) ? values : []).map((value) => String(value)));
        Array.from(select?.options || []).forEach((option) => {
            option.selected = selected.has(option.value);
        });
    };

    const apiJson = async (url, options = {}) => {
        const response = await fetch(url, {
            credentials: 'include',
            cache: 'no-store',
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...(options.headers || {})
            }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Request failed with ${response.status}`);
        }
        return data;
    };

    const formatDateTime = (value) => {
        if (!value) return 'Not scheduled';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return String(value);
        return parsed.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    };

    const formatHistoryMode = (mode) => {
        const value = String(mode || '').trim().toLowerCase();
        if (value === 'manual') return 'Manual send';
        if (value === 'event') return 'Event trigger';
        return 'Scheduled send';
    };

    const setDefaultScheduleDate = () => {
        if (!scheduleAtInput) return;
        const date = new Date(Date.now() + 60 * 60 * 1000);
        date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
        scheduleAtInput.value = date.toISOString().slice(0, 16);
    };

    const setRadioValue = (name, value) => {
        const input = form?.querySelector(`input[name="${name}"][value="${value}"]`);
        if (input) input.checked = true;
    };

    const setSaveButtonMode = (mode = 'create') => {
        if (modalTitle) {
            modalTitle.textContent = mode === 'edit' ? 'Edit App Notification' : 'Add App Notification';
        }
        if (saveBtn) {
            saveBtn.innerHTML = mode === 'edit'
                ? '<i class="fa-solid fa-floppy-disk"></i> Update Push'
                : '<i class="fa-solid fa-floppy-disk"></i> Save Push';
        }
    };

    const toDateTimeLocalValue = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return raw.slice(0, 16);
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return '';
        parsed.setMinutes(parsed.getMinutes() - parsed.getTimezoneOffset());
        return parsed.toISOString().slice(0, 16);
    };

    const getTemplateById = (id) =>
        PUSH_TEMPLATES.find((template) => template.id === String(id || '').trim()) || null;

    const showPushPage = (name = 'active') => {
        const page = String(name || 'active').trim();
        pushPageButtons.forEach((button) => {
            const active = button.dataset.pushPage === page;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        pushPagePanels.forEach((panel) => {
            panel.hidden = panel.dataset.pushPagePanel !== page;
        });
    };

    const applyTemplate = (templateId) => {
        const template = getTemplateById(templateId);
        if (!template) return;

        if (titleInput) titleInput.value = template.title || 'Billing Reminder';
        if (messageInput) messageInput.value = template.message || '';

        const triggerMode = template.triggerMode || 'schedule';
        setRadioValue('triggerMode', triggerMode);
        if (triggerMode === 'schedule') {
            setDefaultScheduleDate();
        } else {
            if (eventTypeInput) eventTypeInput.value = template.eventType || 'due-date';
            if (delayDirectionInput) delayDirectionInput.value = template.delayDirection || 'after';
            if (delayAmountInput) delayAmountInput.value = String(Number(template.delayAmount || 0));
            if (delayUnitInput) delayUnitInput.value = template.delayUnit || 'days';
        }
        syncConditionalFields();
    };

    const populateTemplates = () => {
        if (!templateInput) return;
        const currentValue = templateInput.value;
        templateInput.innerHTML = '<option value="">Custom message</option>';
        PUSH_TEMPLATES.forEach((template) => {
            templateInput.add(new Option(template.name, template.id));
        });
        templateInput.value = currentValue && getTemplateById(currentValue) ? currentValue : '';
    };

    const matchesSearch = (value, query) =>
        !query || String(value || '').toLowerCase().includes(query);

    const renderPickerLimitNote = (listEl, total, visible) => {
        if (!listEl || total <= visible) return;
        listEl.insertAdjacentHTML(
            'beforeend',
            `<p class="recipient-picker__note">Showing ${visible} of ${total}. Refine search to see more.</p>`
        );
    };

    const renderAreaPicker = () => {
        if (!areaList || !areaSelect) return;
        const selected = getSelectedSet(areaSelect);
        const query = String(areaSearchInput?.value || '').trim().toLowerCase();
        const areas = state.areas.filter((area) => matchesSearch(area, query));
        const visibleAreas = areas.slice(0, MAX_PICKER_ITEMS);

        areaList.innerHTML = visibleAreas.length
            ? visibleAreas.map((area) => {
                const isSelected = selected.has(area);
                return `
                    <button class="recipient-option${isSelected ? ' is-selected' : ''}" type="button" role="option" aria-selected="${isSelected ? 'true' : 'false'}" data-recipient-value="${escapeHtml(area)}">
                        <span class="recipient-option__icon"><i class="fa-solid fa-location-dot" aria-hidden="true"></i></span>
                        <span class="recipient-option__body">
                            <strong>${escapeHtml(area)}</strong>
                            <small>${isSelected ? 'Selected area' : 'Tap to select'}</small>
                        </span>
                        <i class="fa-solid fa-check recipient-option__check" aria-hidden="true"></i>
                    </button>
                `;
            }).join('')
            : '<p class="recipient-picker__empty">No areas found.</p>';
        renderPickerLimitNote(areaList, areas.length, visibleAreas.length);
        if (areaCount) areaCount.textContent = `${selected.size} selected`;
    };

    const renderCustomerPicker = () => {
        if (!customerList || !customerSelect) return;
        const selected = getSelectedSet(customerSelect);
        const query = String(customerSearchInput?.value || '').trim().toLowerCase();
        const customers = state.customers.filter((customer) => {
            const text = [customer.name, customer.accountNumber, customer.area].filter(Boolean).join(' ');
            return matchesSearch(text, query);
        });
        const visibleCustomers = customers.slice(0, MAX_PICKER_ITEMS);

        customerList.innerHTML = visibleCustomers.length
            ? visibleCustomers.map((customer) => {
                const accountNumber = String(customer.accountNumber || '').trim();
                const isSelected = selected.has(accountNumber);
                const name = String(customer.name || '').trim() || `Account ${accountNumber}`;
                const meta = [accountNumber ? `#${accountNumber}` : '', customer.area].filter(Boolean).join(' - ');
                return `
                    <button class="recipient-option${isSelected ? ' is-selected' : ''}" type="button" role="option" aria-selected="${isSelected ? 'true' : 'false'}" data-recipient-value="${escapeHtml(accountNumber)}">
                        <span class="recipient-option__icon"><i class="fa-solid fa-user" aria-hidden="true"></i></span>
                        <span class="recipient-option__body">
                            <strong>${escapeHtml(name)}</strong>
                            <small>${escapeHtml(meta || 'Customer account')}</small>
                        </span>
                        <i class="fa-solid fa-check recipient-option__check" aria-hidden="true"></i>
                    </button>
                `;
            }).join('')
            : '<p class="recipient-picker__empty">No customers found.</p>';
        renderPickerLimitNote(customerList, customers.length, visibleCustomers.length);
        if (customerCount) customerCount.textContent = `${selected.size} selected`;
    };

    const renderRecipientPickers = () => {
        renderAreaPicker();
        renderCustomerPicker();
    };

    const populateChoices = () => {
        if (areaSelect) {
            areaSelect.innerHTML = '';
            state.areas.forEach((area) => {
                areaSelect.add(new Option(area, area));
            });
        }
        if (customerSelect) {
            customerSelect.innerHTML = '';
            state.customers.forEach((customer) => {
                const label = [customer.name, customer.accountNumber, customer.area].filter(Boolean).join(' - ');
                customerSelect.add(new Option(label, customer.accountNumber));
            });
        }
        renderRecipientPickers();
    };

    const syncConditionalFields = () => {
        const recipientMode = getCheckedValue('recipientMode', 'all');
        const triggerMode = getCheckedValue('triggerMode', 'schedule');
        if (areaSelectField) areaSelectField.hidden = recipientMode !== 'area';
        if (customerSelectField) customerSelectField.hidden = recipientMode !== 'customer';
        if (scheduleAtField) scheduleAtField.hidden = triggerMode !== 'schedule';
        if (eventFields) eventFields.hidden = triggerMode !== 'event';
    };

    const applyNotificationToForm = (notification = {}) => {
        if (templateInput) templateInput.value = '';
        if (titleInput) titleInput.value = notification.title || 'Billing Reminder';
        if (messageInput) messageInput.value = notification.message || '';

        const recipientMode = notification.recipientMode || 'all';
        setRadioValue('recipientMode', recipientMode);
        setSelectedValues(areaSelect, Array.isArray(notification.areaNames) ? notification.areaNames : []);
        setSelectedValues(customerSelect, Array.isArray(notification.accountNumbers) ? notification.accountNumbers : []);

        const triggerMode = notification.triggerMode || 'schedule';
        setRadioValue('triggerMode', triggerMode);
        if (scheduleAtInput) scheduleAtInput.value = toDateTimeLocalValue(notification.scheduleAt);
        if (eventTypeInput) eventTypeInput.value = notification.eventType || 'due-date';
        if (delayDirectionInput) delayDirectionInput.value = notification.delayDirection || 'after';
        if (delayAmountInput) delayAmountInput.value = String(Number(notification.delayAmount || 0));
        if (delayUnitInput) delayUnitInput.value = notification.delayUnit || 'days';
    };

    const openModal = (notification = null) => {
        form?.reset();
        if (areaSearchInput) areaSearchInput.value = '';
        if (customerSearchInput) customerSearchInput.value = '';
        populateTemplates();
        state.editingNotificationId = String(notification?.id || '').trim();
        setSaveButtonMode(state.editingNotificationId ? 'edit' : 'create');

        if (state.editingNotificationId) {
            applyNotificationToForm(notification);
        } else {
            setSelectedValues(areaSelect, []);
            setSelectedValues(customerSelect, []);
            if (templateInput) templateInput.value = 'billing-reminder';
            if (eventTypeInput) eventTypeInput.value = 'due-date';
            if (delayDirectionInput) delayDirectionInput.value = 'after';
            if (delayAmountInput) delayAmountInput.value = '0';
            if (delayUnitInput) delayUnitInput.value = 'days';
            setDefaultScheduleDate();
            applyTemplate(templateInput?.value || '');
        }
        renderRecipientPickers();
        syncConditionalFields();
        setStatus('');
        modal?.classList.add('show');
        modal?.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-active');
        titleInput?.focus();
    };

    const closeModal = () => {
        modal?.classList.remove('show');
        modal?.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-active');
        state.editingNotificationId = '';
        setSaveButtonMode('create');
        openBtn?.focus();
    };

    const closeHistoryModal = () => {
        historyModal?.classList.remove('show');
        historyModal?.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-active');
    };

    const renderHistoryRecipients = (recipients = []) => {
        const list = Array.isArray(recipients) ? recipients : [];
        if (!list.length) {
            return '<p class="push-history-empty-recipients">No accepted customers recorded for this run.</p>';
        }
        return `
            <div class="push-history-recipients">
                ${list.map((recipient) => {
                    const name = String(recipient.name || '').trim() || `Account ${recipient.accountNumber}`;
                    const meta = [recipient.accountNumber ? `#${recipient.accountNumber}` : '', recipient.area].filter(Boolean).join(' - ');
                    return `
                        <div class="push-history-recipient">
                            <i class="fa-solid fa-user-check" aria-hidden="true"></i>
                            <span>
                                <strong>${escapeHtml(name)}</strong>
                                <small>${escapeHtml(meta || 'Customer')}</small>
                            </span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    };

    const openHistoryModal = (notification = {}) => {
        const history = Array.isArray(notification.history) ? notification.history : [];
        if (historyTitle) historyTitle.textContent = `${notification.title || 'Notification'} History`;
        if (historyEmpty) historyEmpty.style.display = history.length ? 'none' : '';
        if (historyList) {
            historyList.innerHTML = history.map((entry) => `
                <article class="push-history-card">
                    <div class="push-history-card__head">
                        <div>
                            <strong>${escapeHtml(formatDateTime(entry.ranAt))}</strong>
                            <small>${escapeHtml(formatHistoryMode(entry.mode))}</small>
                        </div>
                        <div class="push-history-stats">
                            <span><i class="fa-solid fa-paper-plane" aria-hidden="true"></i>${Number(entry.successCount || 0)} sent</span>
                            <span><i class="fa-solid fa-users" aria-hidden="true"></i>${Array.isArray(entry.recipients) ? entry.recipients.length : 0} customers</span>
                            ${Number(entry.failureCount || 0) ? `<span class="is-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>${Number(entry.failureCount || 0)} failed</span>` : ''}
                        </div>
                    </div>
                    ${entry.error ? `<p class="push-history-error">${escapeHtml(entry.error)}</p>` : ''}
                    ${renderHistoryRecipients(entry.recipients)}
                </article>
            `).join('');
        }
        historyModal?.classList.add('show');
        historyModal?.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-active');
        closeHistoryBtn?.focus();
    };

    const toggleRecipientValue = (select, value) => {
        const option = Array.from(select?.options || [])
            .find((item) => item.value === String(value || '').trim());
        if (!option) return;
        option.selected = !option.selected;
    };

    const handleRecipientOptionClick = (event) => {
        const button = event.target.closest('[data-recipient-value]');
        if (!button) return;
        const picker = button.closest('[data-recipient-picker]')?.dataset.recipientPicker;
        const select = picker === 'area' ? areaSelect : customerSelect;
        toggleRecipientValue(select, button.dataset.recipientValue);
        renderRecipientPickers();
    };

    const handleRecipientClear = (event) => {
        const button = event.target.closest('[data-recipient-clear]');
        if (!button) return;
        const type = button.dataset.recipientClear;
        const select = type === 'area' ? areaSelect : customerSelect;
        setSelectedValues(select, []);
        renderRecipientPickers();
    };

    const formatRecipients = (notification) => {
        if (notification.recipientMode === 'area') {
            const areas = Array.isArray(notification.areaNames) ? notification.areaNames : [];
            return areas.length ? `Area: ${areas.join(', ')}` : 'Area not selected';
        }
        if (notification.recipientMode === 'customer') {
            const accounts = Array.isArray(notification.accountNumbers) ? notification.accountNumbers : [];
            return accounts.length ? `${accounts.length} customer${accounts.length === 1 ? '' : 's'}` : 'No customer selected';
        }
        return 'All app devices';
    };

    const formatTrigger = (notification) => {
        if (notification.triggerMode === 'event') {
            const amount = Number(notification.delayAmount || 0);
            const unit = notification.delayUnit || 'days';
            const direction = notification.delayDirection || 'after';
            const delay = amount ? `${amount} ${unit} ${direction}` : `Immediately ${direction}`;
            return `${titleCase(notification.eventType)} - ${delay}`;
        }
        return formatDateTime(notification.scheduleAt);
    };

    const formatLastResult = (notification) => {
        const result = notification.lastResult;
        if (!result) return 'No run yet';
        if (result.ok) return `${Number(result.successCount || 0)} sent`;
        return result.error || 'No successful sends';
    };

    const isPastSchedule = (notification) => {
        if (notification.triggerMode !== 'schedule' || !notification.scheduleAt) return false;
        const scheduleDate = new Date(notification.scheduleAt);
        return !Number.isNaN(scheduleDate.getTime()) && scheduleDate <= new Date();
    };

    const isCompletedSchedule = (notification) => {
        if (!isPastSchedule(notification) || !notification.lastResult?.ok) return false;
        const scheduledRunKey = `${notification.id}:schedule:${notification.scheduleAt}`;
        if (notification.lastRunKey === scheduledRunKey) return true;
        return String(notification.lastResult?.mode || '').trim().toLowerCase() === 'scheduled';
    };

    const formatRuleStatus = (notification) => {
        if (isCompletedSchedule(notification)) return 'Completed';
        if (notification.triggerMode === 'event') return 'Event Active';
        if (isPastSchedule(notification)) return notification.lastResult ? 'Failed / Missed' : 'Missed';
        return 'Upcoming';
    };

    const renderRuleCards = (notifications = [], options = {}) => notifications.map((notification) => {
        const completed = isCompletedSchedule(notification);
        const showActiveActions = options.showActiveActions !== false;
        return `
            <article class="push-rule-card${completed ? ' is-completed' : ''}" data-id="${escapeHtml(notification.id)}">
                <div>
                    <h3>${escapeHtml(notification.title || 'Billing Reminder')}</h3>
                    <p>${escapeHtml(notification.message)}</p>
                    <div class="push-rule-meta">
                        <span><i class="fa-solid fa-users"></i>${escapeHtml(formatRecipients(notification))}</span>
                        <span><i class="fa-regular fa-clock"></i>${escapeHtml(formatTrigger(notification))}</span>
                        <span><i class="fa-solid fa-signal"></i>${escapeHtml(formatLastResult(notification))}</span>
                        <span class="${completed ? 'is-completed' : ''}"><i class="fa-solid ${completed ? 'fa-circle-check' : (notification.enabled ? 'fa-toggle-on' : 'fa-toggle-off')}"></i>${escapeHtml(formatRuleStatus(notification))}</span>
                    </div>
                </div>
                <div class="push-rule-actions">
                    <button class="ghost-icon" type="button" data-push-action="history" aria-label="View send history" title="View send history" ${Array.isArray(notification.history) && notification.history.length ? '' : 'disabled'}>
                        <i class="fa-solid fa-clock-rotate-left"></i>
                    </button>
                    ${showActiveActions ? `
                        <button class="ghost-icon" type="button" data-push-action="send-now" aria-label="Send now" title="Send now">
                            <i class="fa-solid fa-paper-plane"></i>
                        </button>
                        <button class="ghost-icon" type="button" data-push-action="edit" aria-label="Edit notification" title="Edit notification">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                    ` : ''}
                    <button class="ghost-icon danger" type="button" data-push-action="delete" aria-label="Delete notification" title="Delete notification">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </article>
        `;
    }).join('');

    const renderNotifications = () => {
        if (!ruleList || !emptyState) return;
        const notifications = Array.isArray(state.notifications) ? state.notifications : [];
        const completed = notifications.filter(isCompletedSchedule);
        const active = notifications.filter((notification) => !isCompletedSchedule(notification));

        emptyState.style.display = active.length ? 'none' : '';
        ruleList.innerHTML = renderRuleCards(active, { showActiveActions: true });

        if (completedRuleList) completedRuleList.innerHTML = renderRuleCards(completed, { showActiveActions: false });
        if (completedEmptyState) completedEmptyState.style.display = completed.length ? 'none' : '';
        if (activeCount) activeCount.textContent = String(active.length);
        if (completedCount) completedCount.textContent = String(completed.length);
    };

    const applyPayload = (payload = {}) => {
        state.notifications = Array.isArray(payload.notifications) ? payload.notifications : state.notifications;
        state.customers = Array.isArray(payload.customers) ? payload.customers : state.customers;
        state.areas = Array.isArray(payload.areas) ? payload.areas : state.areas;
        populateChoices();
        renderNotifications();

        if (pushConfigState) {
            pushConfigState.textContent = payload.push?.configured ? 'Ready' : 'Not configured';
        }
        if (pushDeviceCount) {
            const count = Number(payload.tokenCount || 0);
            pushDeviceCount.textContent = `${count} device${count === 1 ? '' : 's'}`;
        }
    };

    const loadNotifications = async () => {
        try {
            const data = await apiJson('/api/customer-app/push-notifications');
            applyPayload(data);
        } catch (error) {
            if (pushConfigState) pushConfigState.textContent = 'Check failed';
            if (typeof window.appToast === 'function') {
                window.appToast(error?.message || 'Unable to load push notifications.', { type: 'error' });
            }
        }
    };

    const readFormPayload = () => {
        const recipientMode = getCheckedValue('recipientMode', 'all');
        const triggerMode = getCheckedValue('triggerMode', 'schedule');
        return {
            enabled: true,
            title: String(titleInput?.value || '').trim() || 'Billing Reminder',
            message: String(messageInput?.value || '').trim(),
            recipientMode,
            areaNames: recipientMode === 'area' ? getSelectedValues(areaSelect) : [],
            accountNumbers: recipientMode === 'customer' ? getSelectedValues(customerSelect) : [],
            triggerMode,
            scheduleAt: triggerMode === 'schedule' ? String(scheduleAtInput?.value || '').trim() : '',
            eventType: triggerMode === 'event' ? String(eventTypeInput?.value || 'due-date').trim() : 'due-date',
            delayDirection: triggerMode === 'event' ? String(delayDirectionInput?.value || 'after').trim() : 'after',
            delayAmount: triggerMode === 'event' ? Number(delayAmountInput?.value || 0) : 0,
            delayUnit: triggerMode === 'event' ? String(delayUnitInput?.value || 'days').trim() : 'days'
        };
    };

    const saveNotification = async (event) => {
        event.preventDefault();
        setStatus('');
        const payload = readFormPayload();
        if (!payload.message) {
            setStatus('Message is required.', 'error');
            messageInput?.focus();
            return;
        }
        if (payload.recipientMode === 'area' && !payload.areaNames.length) {
            setStatus('Select at least one area.', 'error');
            areaSearchInput?.focus();
            return;
        }
        if (payload.recipientMode === 'customer' && !payload.accountNumbers.length) {
            setStatus('Select at least one customer.', 'error');
            customerSearchInput?.focus();
            return;
        }
        if (payload.triggerMode === 'schedule' && !payload.scheduleAt) {
            setStatus('Schedule date and time is required.', 'error');
            scheduleAtInput?.focus();
            return;
        }

        setBusy(saveBtn, true);
        const editingId = state.editingNotificationId;
        const url = editingId
            ? `/api/customer-app/push-notifications/${encodeURIComponent(editingId)}`
            : '/api/customer-app/push-notifications';
        try {
            const data = await apiJson(url, {
                method: editingId ? 'PUT' : 'POST',
                body: JSON.stringify(payload)
            });
            state.notifications = Array.isArray(data.notifications)
                ? data.notifications
                : (editingId
                    ? state.notifications.map((item) => item.id === editingId ? data.notification : item).filter(Boolean)
                    : [data.notification, ...state.notifications].filter(Boolean));
            renderNotifications();
            closeModal();
            if (typeof window.appToast === 'function') {
                window.appToast(editingId ? 'Push notification updated.' : 'Push notification added.', { type: 'success' });
            }
        } catch (error) {
            setStatus(error?.message || 'Unable to save push notification.', 'error');
        } finally {
            setBusy(saveBtn, false);
        }
    };

    const handleRuleAction = async (event) => {
        const button = event.target.closest('[data-push-action]');
        if (!button) return;
        const card = button.closest('[data-id]');
        const id = String(card?.dataset.id || '').trim();
        if (!id) return;
        const action = String(button.dataset.pushAction || '').trim();

        if (action === 'history') {
            const notification = state.notifications.find((item) => item.id === id);
            if (notification) openHistoryModal(notification);
            return;
        }

        if (action === 'edit') {
            const notification = state.notifications.find((item) => item.id === id);
            if (!notification) {
                if (typeof window.appToast === 'function') {
                    window.appToast('Push notification was not found.', { type: 'error' });
                }
                return;
            }
            openModal(notification);
            return;
        }

        if (action === 'delete') {
            const confirmed = window.appConfirm
                ? await window.appConfirm('Delete this push notification?', { title: 'Delete Push Notification' })
                : window.confirm('Delete this push notification?');
            if (!confirmed) return;
            setBusy(button, true);
            try {
                const data = await apiJson(`/api/customer-app/push-notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
                state.notifications = Array.isArray(data.notifications) ? data.notifications : state.notifications.filter((item) => item.id !== id);
                renderNotifications();
            } catch (error) {
                if (typeof window.appToast === 'function') {
                    window.appToast(error?.message || 'Unable to delete push notification.', { type: 'error' });
                }
            }
            return;
        }

        if (action === 'send-now') {
            setBusy(button, true);
            try {
                const data = await apiJson(`/api/customer-app/push-notifications/${encodeURIComponent(id)}/run-now`, { method: 'POST' });
                if (!data.ok) throw new Error(data.result?.error || 'No device accepted the push notification.');
                await loadNotifications();
                if (typeof window.appToast === 'function') {
                    window.appToast(`${Number(data.result?.successCount || 0)} push notification sent.`, { type: 'success' });
                }
            } catch (error) {
                if (typeof window.appToast === 'function') {
                    window.appToast(error?.message || 'Unable to send push notification.', { type: 'error' });
                }
            } finally {
                setBusy(button, false);
            }
        }
    };

    form?.addEventListener('change', syncConditionalFields);
    form?.addEventListener('click', handleRecipientClear);
    form?.addEventListener('submit', saveNotification);
    templateInput?.addEventListener('change', () => applyTemplate(templateInput.value));
    pushPageButtons.forEach((button) => {
        button.addEventListener('click', () => showPushPage(button.dataset.pushPage || 'active'));
    });
    areaSearchInput?.addEventListener('input', renderAreaPicker);
    customerSearchInput?.addEventListener('input', renderCustomerPicker);
    areaList?.addEventListener('click', handleRecipientOptionClick);
    customerList?.addEventListener('click', handleRecipientOptionClick);
    openBtn?.addEventListener('click', () => openModal());
    closeBtn?.addEventListener('click', closeModal);
    closeHistoryBtn?.addEventListener('click', closeHistoryModal);
    cancelBtn?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });
    historyModal?.addEventListener('click', (event) => {
        if (event.target === historyModal) closeHistoryModal();
    });
    window.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (historyModal?.classList.contains('show')) {
            closeHistoryModal();
            return;
        }
        if (modal?.classList.contains('show')) closeModal();
    });
    ruleList?.addEventListener('click', handleRuleAction);
    completedRuleList?.addEventListener('click', handleRuleAction);

    syncConditionalFields();
    populateTemplates();
    loadNotifications();
})();
