document.addEventListener('DOMContentLoaded', async () => {
    // Tab switching functionality
    const tabLinks = document.querySelectorAll('.sms-tab-link');
    const tabContents = document.querySelectorAll('.sms-tab-content');
    const SMS_ACTIVE_TAB_STORAGE_KEY = 'archie-sms-active-tab';

    const setActiveTab = (tabId, { persist = true } = {}) => {
        if (!tabId) return;

        tabLinks.forEach((link) => {
            const isActive = link.getAttribute('data-tab') === tabId;
            link.classList.toggle('active', isActive);
        });

        tabContents.forEach((content) => {
            content.classList.toggle('active', content.id === tabId);
        });

        if (persist) {
            try {
                localStorage.setItem(SMS_ACTIVE_TAB_STORAGE_KEY, tabId);
            } catch {
                // ignore storage access issues
            }
        }
    };

    const availableTabIds = new Set(
        Array.from(tabLinks)
            .map((link) => link.getAttribute('data-tab'))
            .filter(Boolean)
    );

    tabLinks.forEach((link) => {
        link.addEventListener('click', () => {
            const tabId = link.getAttribute('data-tab');
            if (!tabId || !availableTabIds.has(tabId)) return;
            setActiveTab(tabId, { persist: true });
        });
    });

    const defaultTabId =
        Array.from(tabLinks).find((link) => link.classList.contains('active'))?.getAttribute('data-tab')
        || tabLinks[0]?.getAttribute('data-tab')
        || 'send-sms';

    let storedTabId = '';
    try {
        storedTabId = localStorage.getItem(SMS_ACTIVE_TAB_STORAGE_KEY) || '';
    } catch {
        storedTabId = '';
    }

    const initialTabId = availableTabIds.has(storedTabId) ? storedTabId : defaultTabId;
    if (initialTabId) {
        setActiveTab(initialTabId, { persist: false });
        if (!availableTabIds.has(storedTabId)) {
            try {
                localStorage.setItem(SMS_ACTIVE_TAB_STORAGE_KEY, initialTabId);
            } catch {
                // ignore storage access issues
            }
        }
    }

    // Character counter for SMS compose
    const messageTextarea = document.getElementById('message');
    const charCount = document.getElementById('char-count');
    const charFill = document.getElementById('char-fill');
    const headerCharCount = document.getElementById('header-char-count');
    const toneFeedback = document.getElementById('tone-feedback');
    const overviewDeliveredCount = document.getElementById('overview-delivered-count');
    const overviewDeliveredMeta = document.getElementById('overview-delivered-meta');
    const overviewScheduledCount = document.getElementById('overview-scheduled-count');
    const overviewScheduledMeta = document.getElementById('overview-scheduled-meta');
    const overviewTemplatesCount = document.getElementById('overview-templates-count');
    const overviewTemplatesMeta = document.getElementById('overview-templates-meta');
    const recentActivityList = document.getElementById('recent-activity-list');
    const locale = navigator.language || 'en-US';
    const dateTimeOptions = { dateStyle: 'medium', timeStyle: 'short' };

    const deliveryMethodLabels = {
        semaphore: 'SMS',
        mail: 'Email',
        sms: 'SMS',
        email: 'Email'
    };

    const normalizeDeliveryMethods = (value) => {
        if (!value) return [];
        const source = Array.isArray(value) ? value : String(value)
            .split(',')
            .map(method => method.trim().toLowerCase())
            .filter(Boolean);
        const mapped = source
            .map((method) => {
                if (method === 'sms') return 'semaphore';
                if (method === 'email') return 'mail';
                if (method === 'smtp') return 'mail';
                return method;
            })
            .filter((method) => method === 'semaphore' || method === 'mail');
        return Array.from(new Set(mapped));
    };

    const formatDeliveryMethods = (methods, { fallback = 'SMS' } = {}) => {
        const normalized = normalizeDeliveryMethods(methods);
        if (normalized.length === 0) return fallback;
        return normalized.map(method => deliveryMethodLabels[method] || method.toUpperCase()).join(', ');
    };

    const getCheckedDeliveryMethods = (root = document) => {
        return Array.from(root.querySelectorAll('input[name="deliveryMethod"]:checked')).map(input => input.value);
    };

    const COMPOSE_DELIVERY_METHODS_STORAGE_KEY = 'archie-sms-compose-delivery-methods';

    const getComposeDeliveryMethodInputs = () => {
        return Array.from(document.querySelectorAll('#send-sms input[name="deliveryMethod"]'));
    };

    const persistComposeDeliveryMethodState = () => {
        const inputs = getComposeDeliveryMethodInputs();
        if (!inputs.length) return;
        const state = {};
        inputs.forEach((input) => {
            state[input.value] = Boolean(input.checked);
        });
        try {
            localStorage.setItem(COMPOSE_DELIVERY_METHODS_STORAGE_KEY, JSON.stringify(state));
        } catch {
            // ignore storage quota/privacy errors
        }
    };

    const restoreComposeDeliveryMethodState = () => {
        const inputs = getComposeDeliveryMethodInputs();
        if (!inputs.length) return;
        try {
            const raw = localStorage.getItem(COMPOSE_DELIVERY_METHODS_STORAGE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (!saved || typeof saved !== 'object') return;
            inputs.forEach((input) => {
                if (Object.prototype.hasOwnProperty.call(saved, input.value)) {
                    input.checked = Boolean(saved[input.value]);
                }
            });
        } catch {
            // ignore invalid JSON/storage access issues
        }
    };

    const bindComposeDeliveryMethodPersistence = () => {
        const inputs = getComposeDeliveryMethodInputs();
        if (!inputs.length) return;
        restoreComposeDeliveryMethodState();
        inputs.forEach((input) => {
            input.addEventListener('change', persistComposeDeliveryMethodState);
        });
    };

    const formatDateTime = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        try {
            return date.toLocaleString(locale, dateTimeOptions);
        } catch (error) {
            return date.toLocaleString();
        }
    };

    const formatTimeOnly = (value) => {
        const raw = String(value || '').trim();
        const match = raw.match(/^(\d{1,2}):(\d{2})$/);
        if (!match) return raw;
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return raw;
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return raw;
        const sample = new Date();
        sample.setHours(hours, minutes, 0, 0);
        try {
            return sample.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
        } catch {
            return raw;
        }
    };

    const updateToneFeedback = (length) => {
        if (!toneFeedback) return;
        toneFeedback.classList.remove('warning', 'alert');

        if (!length) {
            toneFeedback.textContent = "We'll highlight if your message sounds too long or urgent once you start typing.";
            return;
        }

        if (length > 160) {
            toneFeedback.textContent = 'Message exceeds 160 characters. Trim it to avoid multi-part SMS charges.';
            toneFeedback.classList.add('alert');
            return;
        }

        if (length > 140) {
            toneFeedback.textContent = 'Almost there - consider shortening to stay within a single SMS.';
            toneFeedback.classList.add('warning');
            return;
        }

        toneFeedback.textContent = 'Nice pace! Your message fits within a single SMS.';
    };

    if (headerCharCount) {
        headerCharCount.textContent = '0';
    }
    updateToneFeedback(messageTextarea ? messageTextarea.value.length : 0);

    if (messageTextarea && charCount) {
        messageTextarea.addEventListener('input', () => {
            const length = messageTextarea.value.length;
            charCount.textContent = `${length}/160`;
            charCount.style.color = length > 160 ? '#dc2626' : '#64748b';
            if (charFill) {
                const percentage = Math.min((length / 160) * 100, 100);
                charFill.style.width = `${percentage}%`;
                charFill.style.backgroundColor = length > 160 ? '#dc2626' : length > 140 ? '#f59e0b' : '#10b981';
            }
            if (headerCharCount) {
                headerCharCount.textContent = `${length}`;
            }
            updateToneFeedback(length);
        });
    }

    // Recipient type switching
    const recipientTypeRadios = document.querySelectorAll('input[name="recipientType"]');
    const areaSelector = document.getElementById('recipient-area-selector');
    const areaHiddenInput = document.getElementById('recipient-area');
    const selectedAreaHint = document.getElementById('selected-area-hint');
    const subscriberList = document.getElementById('recipient-subscriber-list');
    const subscriberPagePrev = document.getElementById('subscriber-page-prev');
    const subscriberPageNext = document.getElementById('subscriber-page-next');
    const subscriberPageInfo = document.getElementById('subscriber-page-info');
    const selectedCount = document.getElementById('selected-count');
    const selectAllSubscribersBtn = document.getElementById('subscriber-select-all');
    const clearAllSubscribersBtn = document.getElementById('subscriber-clear-all');

    const SUBSCRIBER_PAGE_SIZE = 50;
    const selectedSubscriberValues = new Set();
    const selectedAreaValues = new Set();
    let subscriberRecords = [];
    let subscriberFilteredRecords = [];
    let visibleSubscriberRecords = [];
    let subscriberPage = 1;
    const subscriberLookup = new Map();

    let areas = [];
    let areaLookup = new Map();

    const slugifyAreaId = (value) => {
        const source = String(value || '').trim().toLowerCase();
        if (!source) return '';
        const cleaned = source
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .replace(/-{2,}/g, '-');
        return cleaned || '';
    };

    const setAreas = (nextAreas = []) => {
        const normalized = [];
        const seen = new Set();
        nextAreas.forEach((entry) => {
            const name = String(entry?.name || entry || '').trim();
            if (!name) return;
            const id = slugifyAreaId(entry?.id || name) || `area-${normalized.length + 1}`;
            if (seen.has(id)) return;
            seen.add(id);
            normalized.push({ id, name });
        });

        areas = normalized;
        areaLookup = new Map(areas.map((area) => [area.id, area]));

        Array.from(selectedAreaValues).forEach((value) => {
            if (!areaLookup.has(value)) {
                selectedAreaValues.delete(value);
            }
        });
        if (areaHiddenInput) {
            areaHiddenInput.value = Array.from(selectedAreaValues)[0] || '';
        }
    };

    const updateAreaHint = () => {
        if (!selectedAreaHint) return;
        const selectedAreas = Array.from(selectedAreaValues)
            .map((value) => areaLookup.get(value) || { id: value, name: value })
            .filter(Boolean);
        if (selectedAreas.length === 0) {
            selectedAreaHint.textContent = 'No area selected.';
        } else if (selectedAreas.length === 1) {
            selectedAreaHint.textContent = `${selectedAreas[0].name} selected.`;
        } else {
            selectedAreaHint.textContent = `${selectedAreas.length} areas selected.`;
        }
    };

    const syncAreaCardSelectionState = ({ focusValue = '' } = {}) => {
        if (!areaSelector) {
            if (areaHiddenInput) {
                areaHiddenInput.value = Array.from(selectedAreaValues)[0] || '';
            }
            updateAreaHint();
            return;
        }

        const cards = Array.from(areaSelector.querySelectorAll('.area-card'));
        cards.forEach((card, index) => {
            const isSelected = selectedAreaValues.has(card.dataset.value);
            card.classList.toggle('selected', isSelected);
            card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
            card.tabIndex = index === 0 ? 0 : -1;
        });

        if (areaHiddenInput) {
            areaHiddenInput.value = Array.from(selectedAreaValues)[0] || '';
        }
        updateAreaHint();

        if (focusValue) {
            const activeCard = cards.find((card) => card.dataset.value === focusValue);
            if (activeCard) {
                activeCard.focus();
            }
        }
    };

    const renderAreaCards = () => {
        if (!areaSelector) return;

        areaSelector.innerHTML = '';

        areas.forEach((area, index) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'area-card';
            card.dataset.value = area.id;
            card.dataset.label = area.name;
            card.setAttribute('role', 'option');
            card.setAttribute('aria-selected', 'false');
            card.setAttribute('aria-checked', 'false');
            card.setAttribute('aria-label', area.name);
            card.tabIndex = index === 0 ? 0 : -1;
            const zoneId = area.id.replace(/-/g, ' ').toUpperCase();
            card.innerHTML = `
                <span class="area-card-icon"><i class="fa-solid fa-map-location-dot"></i></span>
                <span class="area-card-title">${area.name}</span>
                <span class="area-card-meta">Zone ID: ${zoneId}</span>
                <span class="area-card-check"><i class="fa-solid fa-check"></i></span>
            `;
            areaSelector.append(card);
        });

        syncAreaCardSelectionState();
    };

    const focusAreaCard = (index) => {
        if (!areaSelector) return;
        const cards = Array.from(areaSelector.querySelectorAll('.area-card'));
        cards.forEach((card, cardIndex) => {
            card.tabIndex = cardIndex === index ? 0 : -1;
        });
        if (cards[index]) {
            cards[index].focus();
        }
    };

    if (areaSelector) {
        areaSelector.addEventListener('click', (event) => {
            const card = event.target.closest('.area-card');
            if (!card) return;
            const { value } = card.dataset;
            if (!value) return;
            if (selectedAreaValues.has(value)) {
                selectedAreaValues.delete(value);
            } else {
                selectedAreaValues.add(value);
            }
            syncAreaCardSelectionState({ focusValue: value });
        });

        areaSelector.addEventListener('keydown', (event) => {
            const cards = Array.from(areaSelector.querySelectorAll('.area-card'));
            if (!cards.length) return;
            let currentIndex = cards.findIndex(card => card === document.activeElement);
            if (currentIndex === -1) {
                currentIndex = 0;
            }

            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                const nextIndex = (currentIndex + 1) % cards.length;
                focusAreaCard(nextIndex);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                const prevIndex = (currentIndex - 1 + cards.length) % cards.length;
                focusAreaCard(prevIndex);
            } else if (event.key === 'Home') {
                event.preventDefault();
                focusAreaCard(0);
            } else if (event.key === 'End') {
                event.preventDefault();
                focusAreaCard(cards.length - 1);
            } else if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                const targetCard = cards[currentIndex];
                if (targetCard) {
                    const targetValue = targetCard.dataset.value;
                    if (selectedAreaValues.has(targetValue)) {
                        selectedAreaValues.delete(targetValue);
                    } else {
                        selectedAreaValues.add(targetValue);
                    }
                    syncAreaCardSelectionState({ focusValue: targetValue });
                }
            }
        });
    }

    const syncSubscriberListState = () => {
        if (!subscriberList) return;
        subscriberList.querySelectorAll('.subscriber-option').forEach(option => {
            const value = option.dataset.value;
            const isSelected = selectedSubscriberValues.has(value);
            const checkbox = option.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.checked = isSelected;
            }
            option.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });
    };

    const getTotalSubscriberPages = () => {
        if (!subscriberFilteredRecords.length) return 1;
        return Math.max(1, Math.ceil(subscriberFilteredRecords.length / SUBSCRIBER_PAGE_SIZE));
    };

    const clampSubscriberPage = () => {
        const totalPages = getTotalSubscriberPages();
        if (subscriberPage > totalPages) {
            subscriberPage = totalPages;
        }
        if (subscriberPage < 1) {
            subscriberPage = 1;
        }
    };

    const updateSelectedCount = () => {
        if (!selectedCount) return;
        const count = selectedSubscriberValues.size;
        const total = subscriberRecords.length;
        const selectedLabel = `${count} subscriber${count !== 1 ? 's' : ''} selected`;
        selectedCount.textContent = total > 0
            ? `${selectedLabel} (total: ${total})`
            : selectedLabel;
    };

    const updateSubscriberPaginationControls = () => {
        const total = subscriberFilteredRecords.length;
        const totalPages = getTotalSubscriberPages();

        if (subscriberPagePrev) {
            subscriberPagePrev.disabled = subscriberPage <= 1 || total === 0;
        }

        if (subscriberPageNext) {
            subscriberPageNext.disabled = subscriberPage >= totalPages || total === 0;
        }

        if (subscriberPageInfo) {
            if (total === 0) {
                subscriberPageInfo.textContent = 'Showing 0 of 0';
            } else {
                const startIndex = (subscriberPage - 1) * SUBSCRIBER_PAGE_SIZE + 1;
                const endIndex = Math.min(startIndex + SUBSCRIBER_PAGE_SIZE - 1, total);
                subscriberPageInfo.textContent = `Showing ${startIndex}-${endIndex} of ${total}`;
            }
        }
    };

    const changeSubscriberPage = (delta) => {
        const totalPages = getTotalSubscriberPages();
        if (totalPages === 0) return;
        const nextPage = Math.min(Math.max(subscriberPage + delta, 1), totalPages);
        if (nextPage === subscriberPage) return;
        subscriberPage = nextPage;
        renderSubscriberList();
    };

    const renderSubscriberList = ({ message = null } = {}) => {
        if (!subscriberList) return;
        subscriberList.innerHTML = '';

        clampSubscriberPage();

        if (!subscriberFilteredRecords.length) {
            visibleSubscriberRecords = [];
            subscriberList.innerHTML = `
                <div class="subscriber-empty">
                    <i class="fa-solid fa-user-slash"></i>
                    <span>${message || 'No subscribers available.'}</span>
                </div>
            `;
            updateSubscriberPaginationControls();
            updateSelectedCount();
            return;
        }

        const startIndex = (subscriberPage - 1) * SUBSCRIBER_PAGE_SIZE;
        const pageRecords = subscriberFilteredRecords.slice(startIndex, startIndex + SUBSCRIBER_PAGE_SIZE);
        visibleSubscriberRecords = pageRecords;

        if (pageRecords.length === 0) {
            subscriberList.innerHTML = `
                <div class="subscriber-empty">
                    <i class="fa-solid fa-user-slash"></i>
                    <span>${message || 'No subscribers on this page.'}</span>
                </div>
            `;
            updateSubscriberPaginationControls();
            updateSelectedCount();
            return;
        }

        pageRecords.forEach(record => {
            const optionLabel = document.createElement('label');
            optionLabel.className = 'subscriber-option';
            optionLabel.dataset.value = record.value;
            optionLabel.dataset.label = record.label;
            optionLabel.setAttribute('role', 'option');
            optionLabel.setAttribute('aria-selected', selectedSubscriberValues.has(record.value) ? 'true' : 'false');
            optionLabel.tabIndex = 0;

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = record.value;
            input.checked = selectedSubscriberValues.has(record.value);
            input.setAttribute('aria-label', record.label);
            input.tabIndex = -1;

            const avatar = document.createElement('span');
            avatar.className = 'subscriber-avatar';
            avatar.textContent = record.initials;

            const content = document.createElement('span');
            content.className = 'subscriber-option-content';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'subscriber-name';
            nameSpan.textContent = record.label;

            const metaSpan = document.createElement('span');
            metaSpan.className = 'subscriber-meta';
            metaSpan.textContent = record.meta;

            content.append(nameSpan, metaSpan);

            const check = document.createElement('span');
            check.className = 'subscriber-check';
            check.innerHTML = '<i class="fa-solid fa-check"></i>';

            optionLabel.append(input, avatar, content, check);
            subscriberList.append(optionLabel);
        });

        updateSubscriberPaginationControls();
        updateSelectedCount();
    };

    const buildSubscriberRecord = (customer) => {
        const firstName = customer.firstName || '';
        const lastName = customer.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim();
        const accountNumber = customer.accountNumber || '';
        const mobileRaw = (customer.mobileRaw || customer.mobile || '').trim();
        const area = String(customer.area || '').trim();
        const email = String(customer.email || '').trim();
        const label = fullName || accountNumber || mobileRaw || email || 'Subscriber';
        const metaParts = [];
        if (accountNumber) metaParts.push(`Acct ${accountNumber}`);
        if (mobileRaw) metaParts.push(mobileRaw);
        if (area) metaParts.push(area);
        const meta = metaParts.join(' | ') || (email ? email : 'No additional details');

        const initialsSource = fullName || label;
        const initials = initialsSource
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part.charAt(0))
            .join('')
            .toUpperCase() || 'S';

        const searchTextParts = [label, meta, email, mobileRaw, accountNumber].filter(Boolean);
        const searchText = searchTextParts.join(' ').toLowerCase();

        const value = String(
            customer.customerId
            || accountNumber
            || mobileRaw
            || email
            || label.toLowerCase().replace(/\s+/g, '-')
        );

        return {
            value,
            label,
            meta,
            initials,
            searchText,
            accountNumber,
            mobile: mobileRaw,
            email,
            area
        };
    };

    // Populate subscriber list
    const populateSubscribers = async () => {
        if (!subscriberList) return;

        subscriberFilteredRecords = [];
        renderSubscriberList({ message: 'Loading subscribers...' });

        try {
            const response = await fetch('/api/customers');
            if (!response.ok) throw new Error('Failed to fetch customers');
            const data = await response.json();
            const customers = Array.isArray(data?.customers)
                ? data.customers
                : Array.isArray(data)
                    ? data
                    : [];

            const areaCandidates = [];
            const seenAreaIds = new Set();
            customers.forEach((customer) => {
                const areaName = String(customer?.area || '').trim();
                if (!areaName) return;
                const areaId = slugifyAreaId(areaName);
                if (!areaId || seenAreaIds.has(areaId)) return;
                seenAreaIds.add(areaId);
                areaCandidates.push({ id: areaId, name: areaName });
            });
            setAreas(areaCandidates);
            renderAreaCards();

            subscriberLookup.clear();
            subscriberRecords = customers.map(buildSubscriberRecord);
            subscriberRecords.forEach(record => subscriberLookup.set(record.value, record));

            // Remove any selections that are no longer available
            Array.from(selectedSubscriberValues).forEach(value => {
                if (!subscriberLookup.has(value)) {
                    selectedSubscriberValues.delete(value);
                }
            });

            subscriberFilteredRecords = subscriberRecords.slice();
            subscriberPage = 1;
            renderSubscriberList();
            updateSelectedCount();
            renderScheduleRecipientOptions();
        } catch (error) {
            console.error('Error populating subscribers:', error);
            subscriberRecords = [];
            subscriberFilteredRecords = [];
            subscriberPage = 1;
            setAreas([]);
            renderAreaCards();
            renderSubscriberList({ message: 'Could not load subscribers.' });
            updateSelectedCount();
            renderScheduleRecipientOptions();
        }
    };

    const recipientModal = document.getElementById('recipientModal');
    const recipientModalTrigger = document.getElementById('open-recipient-modal');
    const recipientModalApply = document.getElementById('apply-recipient-selection');
    const recipientSummaryText = document.getElementById('recipient-summary-text');

    const openRecipientModal = () => {
        updateRecipientSummary();
        openModal('recipientModal');
    };

    const closeRecipientModal = () => {
        closeModal('recipientModal');
    };

    const updateRecipientSummary = () => {
        if (!recipientSummaryText) return;
        const subscribers = getSelectedSubscribers();
        const selectedAreas = getSelectedAreas();
        const recipientType = document.querySelector('input[name="recipientType"]:checked')?.value || 'subscriber';
        if (recipientType === 'subscriber') {
            if (subscribers.length === 0) {
                recipientSummaryText.textContent = 'No recipients selected.';
            } else if (subscribers.length === 1) {
                recipientSummaryText.textContent = `1 subscriber selected`;
            } else {
                recipientSummaryText.textContent = `${subscribers.length} subscribers selected`;
            }
        } else {
            if (selectedAreas.length === 0) {
                recipientSummaryText.textContent = 'No area selected.';
            } else if (selectedAreas.length === 1) {
                recipientSummaryText.textContent = `Area: ${selectedAreas[0].name}`;
            } else {
                recipientSummaryText.textContent = `${selectedAreas.length} areas selected`;
            }
        }
    };

    if (recipientModalTrigger) {
        recipientModalTrigger.addEventListener('click', openRecipientModal);
    }

    if (recipientModalApply) {
        recipientModalApply.addEventListener('click', () => {
            updateRecipientSummary();
            closeRecipientModal();
        });
    }

    const syncRecipientModeVisibility = () => {
        const selectedType = document.querySelector('input[name="recipientType"]:checked')?.value || 'subscriber';
        const isSubscriber = selectedType === 'subscriber';
        if (recipientModal) {
            const subscriberGroup = recipientModal.querySelector('#recipient-subscriber-group');
            const areaGroup = recipientModal.querySelector('#recipient-area-group');
            if (subscriberGroup && areaGroup) {
                subscriberGroup.style.display = isSubscriber ? '' : 'none';
                areaGroup.style.display = isSubscriber ? 'none' : '';
            }
        }
        if (!isSubscriber) {
            const firstSelectedArea = Array.from(selectedAreaValues)[0] || '';
            if (firstSelectedArea) {
                syncAreaCardSelectionState({ focusValue: firstSelectedArea });
            } else if (areaSelector && areaSelector.childElementCount > 0) {
                focusAreaCard(0);
                updateAreaHint();
            }
        }
        updateRecipientSummary();
    };

    if (recipientTypeRadios.length > 0) {
        recipientTypeRadios.forEach(radio => {
            radio.addEventListener('change', syncRecipientModeVisibility);
        });
        syncRecipientModeVisibility();
    }


    // Subscriber search and selection
    const subscriberSearch = document.getElementById('subscriber-search');

    if (subscriberList) {
        subscriberList.addEventListener('change', (event) => {
            if (!(event.target instanceof HTMLInputElement)) return;
            const checkbox = event.target;
            if (checkbox.type !== 'checkbox') return;
            const { value, checked } = checkbox;
            if (checked) {
                selectedSubscriberValues.add(value);
            } else {
                selectedSubscriberValues.delete(value);
            }

            const option = checkbox.closest('.subscriber-option');
            if (option) {
                option.setAttribute('aria-selected', checked ? 'true' : 'false');
            }

            updateSelectedCount();
        });

        subscriberList.addEventListener('keydown', (event) => {
            if (!(event.target instanceof HTMLElement)) return;
            if (!event.target.classList.contains('subscriber-option')) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                const checkbox = event.target.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        });
    }

    if (selectAllSubscribersBtn) {
        selectAllSubscribersBtn.addEventListener('click', () => {
            visibleSubscriberRecords.forEach(record => {
                selectedSubscriberValues.add(record.value);
            });
            syncSubscriberListState();
            updateSelectedCount();
        });
    }

    if (clearAllSubscribersBtn) {
        clearAllSubscribersBtn.addEventListener('click', () => {
            selectedSubscriberValues.clear();
            syncSubscriberListState();
            updateSelectedCount();
        });
    }

    if (subscriberPagePrev) {
        subscriberPagePrev.addEventListener('click', () => changeSubscriberPage(-1));
    }

    if (subscriberPageNext) {
        subscriberPageNext.addEventListener('click', () => changeSubscriberPage(1));
    }

    if (subscriberSearch) {
        subscriberSearch.addEventListener('input', (e) => {
            const searchTerm = e.target.value.trim().toLowerCase();
            if (!searchTerm) {
                subscriberFilteredRecords = subscriberRecords.slice();
                subscriberPage = 1;
                renderSubscriberList({ message: subscriberRecords.length ? null : 'No subscribers available.' });
                return;
            }

            const filtered = subscriberRecords.filter(record => record.searchText.includes(searchTerm));
            subscriberFilteredRecords = filtered;
            subscriberPage = 1;
            renderSubscriberList({ message: filtered.length === 0 ? 'No subscribers match your search.' : null });
        });
    }

    function getSelectedSubscribers() {
        return Array.from(selectedSubscriberValues)
            .map(value => subscriberLookup.get(value))
            .filter(Boolean);
    }

    function getSelectedAreas() {
        return Array.from(selectedAreaValues)
            .map((value) => areaLookup.get(value) || { id: value, name: value })
            .filter(Boolean);
    }

    function getSelectedArea() {
        return getSelectedAreas()[0] || null;
    }

    const getSubscribersByArea = (area) => {
        if (!area) return [];
        const targetName = String(area.name || '').trim().toLowerCase();
        if (!targetName) return [];
        return subscriberRecords.filter((record) => String(record.area || '').trim().toLowerCase() === targetName);
    };

    const getSubscribersByAreas = (selectedAreas) => {
        const uniqueByValue = new Map();
        (selectedAreas || []).forEach((area) => {
            getSubscribersByArea(area).forEach((record) => {
                uniqueByValue.set(record.value, record);
            });
        });
        return Array.from(uniqueByValue.values());
    };

    setAreas([]);
    renderAreaCards();
    populateSubscribers();

    // Modal and Toast functionality
    const toast = document.getElementById('toast');
    let toastTimer = null;

    const showToast = (message) => {
        if (typeof window.appToast === 'function') {
            window.appToast(message, { type: 'info' });
            return;
        }
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    };

    const syncModalShellState = () => {
        const hasOpenModal = Boolean(document.querySelector('.modal.show'));
        document.body.classList.toggle('modal-open', hasOpenModal);
    };

    const openModal = (modalId) => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('show');
            modal.setAttribute('aria-hidden', 'false');
            const firstInput = modal.querySelector('input, textarea');
            if (firstInput) firstInput.focus();
        }
        syncModalShellState();
    };

    const closeModal = (modalId) => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('show');
            modal.setAttribute('aria-hidden', 'true');
        }
        syncModalShellState();
    };

    // Generic modal close event listeners
    document.querySelectorAll('.modal').forEach(modal => {
        const modalId = modal.id;
        modal.addEventListener('click', (e) => {
            if (e.target.matches('.close-modal, .close-modal i, .ghost-btn[data-dismiss="modal"]')) {
                closeModal(modalId);
            }
            if (e.target === modal) { // Click outside
                closeModal(modalId);
            }
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.show').forEach(modal => {
                closeModal(modal.id);
            });
        }
    });

    syncModalShellState();


    // Template management
    let smsTemplates = [];

    const templatesTableBody = document.querySelector('#templates table tbody');
    const templateSelect = document.getElementById('template-select');
    const templateModal = document.getElementById('templateModal');
    const templateForm = document.getElementById('templateForm');
    let currentEditingTemplateId = null;

    const renderTemplates = () => {
        if (!templatesTableBody) return;

        templatesTableBody.innerHTML = '';

        if (smsTemplates.length === 0) {
            const emptyRow = document.createElement('tr');
            const emptyCell = document.createElement('td');
            emptyCell.colSpan = 3;
            emptyCell.className = 'empty-state-row';
            emptyCell.textContent = 'No templates yet.';
            emptyRow.appendChild(emptyCell);
            templatesTableBody.appendChild(emptyRow);
            renderComposeTemplateOptions();
            renderScheduleTemplateOptions();
            renderAutomationTemplateOptions();
            updateOverviewMetrics();
            return;
        }

        smsTemplates.forEach(template => {
            const tr = document.createElement('tr');

            const nameTd = document.createElement('td');
            nameTd.textContent = template.name;

            const previewTd = document.createElement('td');
            previewTd.className = 'preview';
            previewTd.textContent = template.content;
            previewTd.title = template.content;

            const actionsTd = document.createElement('td');
            actionsTd.className = 'actions';

            const actionsWrap = document.createElement('div');
            actionsWrap.className = 'table-actions';

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'icon-btn';
            editBtn.setAttribute('aria-label', `Edit template ${template.name}`);
            editBtn.title = 'Edit';
            editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
            editBtn.onclick = () => openTemplateModal(template.id);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'icon-btn danger';
            deleteBtn.setAttribute('aria-label', `Delete template ${template.name}`);
            deleteBtn.title = 'Delete';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            deleteBtn.onclick = () => deleteTemplate(template.id);

            actionsWrap.appendChild(editBtn);
            actionsWrap.appendChild(deleteBtn);
            actionsTd.appendChild(actionsWrap);

            tr.appendChild(nameTd);
            tr.appendChild(previewTd);
            tr.appendChild(actionsTd);

            templatesTableBody.appendChild(tr);
        });

        renderComposeTemplateOptions();
        renderScheduleTemplateOptions();
        renderAutomationTemplateOptions();
        updateOverviewMetrics();
    };

    function renderComposeTemplateOptions() {
        if (!templateSelect) return;
        const currentValue = String(templateSelect.value || '').trim();
        templateSelect.innerHTML = '<option value="">Select a template...</option>';
        smsTemplates.forEach((template) => {
            const option = document.createElement('option');
            option.value = String(template.id);
            option.textContent = template.name;
            templateSelect.appendChild(option);
        });
        if (currentValue && smsTemplates.some((template) => String(template.id) === currentValue)) {
            templateSelect.value = currentValue;
        }
    }

    const openTemplateModal = (id = null) => {
        if (!templateForm || !templateModal) return;
        currentEditingTemplateId = id;
        templateForm.reset();
        const modalTitle = templateModal.querySelector('#templateModalTitle');
        const submitBtn = templateModal.querySelector('.primary-btn');

        if (id) {
            const template = smsTemplates.find((t) => String(t.id) === String(id));
            if (template) {
                modalTitle.textContent = 'Edit Template';
                submitBtn.textContent = 'Save Changes';
                templateForm.elements.templateName.value = template.name;
                templateForm.elements.templateContent.value = template.content;
            }
        } else {
            modalTitle.textContent = 'New Template';
            submitBtn.textContent = 'Create Template';
        }
        openModal('templateModal');
    };

    if (templateForm) {
        templateForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const unlock = window.withSubmitLock ? window.withSubmitLock(templateForm, { label: 'Saving...' }) : null;
            if (window.withSubmitLock && !unlock) return;
            try {
                const name = templateForm.elements.templateName.value.trim();
                const content = templateForm.elements.templateContent.value.trim();

                if (!name || !content) {
                    showToast('Template name and content are required.');
                    return;
                }

                const payload = {
                    name,
                    content,
                    channels: ['sms', 'email'],
                    isActive: true
                };

                if (currentEditingTemplateId) {
                    await requestSmsApi(`/templates/${encodeURIComponent(currentEditingTemplateId)}`, {
                        method: 'PATCH',
                        body: JSON.stringify(payload)
                    });
                    showToast('Template updated successfully!');
                } else {
                    await requestSmsApi('/templates', {
                        method: 'POST',
                        body: JSON.stringify(payload)
                    });
                    showToast('Template created successfully!');
                }
                await loadSmsTemplates({ silent: true });
                closeModal('templateModal');
            } catch (error) {
                showToast(error.message || 'Failed to save template.');
            } finally {
                if (unlock) unlock();
            }
        });
    }

    const deleteTemplate = async (id) => {
        const confirmed = window.appConfirm
            ? await window.appConfirm('Are you sure you want to delete this template?', { title: 'Delete Template' })
            : window.confirm('Are you sure you want to delete this template?');
        if (confirmed) {
            try {
                await requestSmsApi(`/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
                await loadSmsTemplates({ silent: true });
                showToast('Template deleted.');
            } catch (error) {
                showToast(error.message || 'Failed to delete template.');
            }
        }
    };

    // Scheduled messages management
    let scheduledMessages = [];

    const schedulerTableBody = document.querySelector('#scheduler table tbody');

    const normalizeScheduleRepeat = (value) => {
        const mode = String(value || '').trim().toLowerCase();
        if (mode === 'twice') return 'twice';
        if (mode === 'more') return 'more';
        if (mode === 'every-month') return 'every-month';
        return 'once';
    };

    const normalizeScheduleDelayDays = (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 0) return 0;
        return parsed;
    };

    const getScheduleRepeatLabel = (message) => {
        const repeatMode = normalizeScheduleRepeat(message?.repeatMode || 'once');
        if (repeatMode === 'every-month') return 'Every month';
        if (repeatMode === 'twice') return 'Twice';
        if (repeatMode === 'more') {
            const parsed = Number.parseInt(message?.repeatCount, 10);
            if (Number.isInteger(parsed) && parsed >= 3) return `${parsed} times`;
            return 'More';
        }
        return 'Once';
    };

    const getScheduleDisplayLabel = (message) => {
        const mode = String(message?.scheduleMode || 'custom').trim().toLowerCase();
        const delayDays = normalizeScheduleDelayDays(message?.scheduleDelayDays);
        const delaySuffix = ` + ${delayDays} day${delayDays === 1 ? '' : 's'}`;
        if (mode === 'billing-date') {
            const billingTime = formatTimeOnly(message?.scheduleDueTime || '');
            return billingTime ? `Billing date${delaySuffix} @ ${billingTime}` : `Billing date${delaySuffix}`;
        }
        if (mode === 'due-date') {
            const dueTime = formatTimeOnly(message?.scheduleDueTime || '');
            return dueTime ? `Due date${delaySuffix} @ ${dueTime}` : `Due date${delaySuffix}`;
        }
        return formatDateTime(message?.scheduleTime) || 'N/A';
    };

    const renderScheduledMessages = () => {
        if (!schedulerTableBody) return;

        schedulerTableBody.innerHTML = '';

        if (scheduledMessages.length === 0) {
            const emptyRow = document.createElement('tr');
            const emptyCell = document.createElement('td');
            emptyCell.colSpan = 6;
            emptyCell.className = 'empty-state-row';
            emptyCell.textContent = 'No scheduled messages.';
            emptyRow.appendChild(emptyCell);
            schedulerTableBody.appendChild(emptyRow);
            updateOverviewMetrics();
            return;
        }

        scheduledMessages.forEach(message => {
            const tr = document.createElement('tr');

            const scheduleTd = document.createElement('td');
            const statusLabel = String(message?.status || 'active').toLowerCase();
            const statusSuffix = statusLabel === 'active' ? '' : ` | ${statusLabel}`;
            scheduleTd.textContent = `${getScheduleDisplayLabel(message)} | ${getScheduleRepeatLabel(message)}${statusSuffix}`;

            const methodTd = document.createElement('td');
            const methodLabel = formatDeliveryMethods(message.deliveryMethods ?? message.deliveryMethod);
            methodTd.textContent = methodLabel;

            const recipientTd = document.createElement('td');
            recipientTd.textContent = message.recipient;

            const titleTd = document.createElement('td');
            titleTd.textContent = String(message?.title || '').trim() || '-';

            const messageTd = document.createElement('td');
            messageTd.className = 'preview';
            messageTd.textContent = message.message;
            messageTd.title = message.message;

            const actionsTd = document.createElement('td');
            actionsTd.className = 'actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'action-btn delete-btn';
            if (statusLabel === 'active') {
                cancelBtn.innerHTML = '<i class="fa-solid fa-times"></i> Cancel';
                cancelBtn.onclick = () => cancelScheduledMessage(message.id);
            } else {
                cancelBtn.disabled = true;
                cancelBtn.innerHTML = `<i class="fa-solid fa-check"></i> ${statusLabel}`;
            }

            actionsTd.appendChild(cancelBtn);

            tr.appendChild(titleTd);
            tr.appendChild(scheduleTd);
            tr.appendChild(methodTd);
            tr.appendChild(recipientTd);
            tr.appendChild(messageTd);
            tr.appendChild(actionsTd);

            schedulerTableBody.appendChild(tr);
        });

        updateOverviewMetrics();
    };

    const cancelScheduledMessage = async (id) => {
        const confirmed = window.appConfirm
            ? await window.appConfirm('Are you sure you want to cancel this scheduled message?', { title: 'Cancel Scheduled Message' })
            : window.confirm('Are you sure you want to cancel this scheduled message?');
        if (confirmed) {
            try {
                await requestSmsApi(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
                await loadSmsSchedules({ silent: true });
                showToast('Scheduled message cancelled.');
            } catch (error) {
                showToast(error.message || 'Failed to cancel scheduled message.');
            }
        }
    };

    const scheduleRecipientTypeRadios = document.querySelectorAll('input[name="scheduleRecipientType"]');
    const scheduleRecipientCustomerGroup = document.getElementById('scheduleRecipientCustomerGroup');
    const scheduleRecipientAreaGroup = document.getElementById('scheduleRecipientAreaGroup');
    const scheduleRecipientCustomerList = document.getElementById('scheduleRecipientCustomerList');
    const scheduleRecipientCustomerCount = document.getElementById('scheduleRecipientCustomerCount');
    const scheduleRecipientSelectAllBtn = document.getElementById('scheduleRecipientSelectAll');
    const scheduleRecipientClearAllBtn = document.getElementById('scheduleRecipientClearAll');
    const scheduleRecipientAreaSelector = document.getElementById('scheduleRecipientAreaSelector');
    const scheduleRecipientSummaryText = document.getElementById('scheduleRecipientSummaryText');
    const openScheduleRecipientModalBtn = document.getElementById('open-schedule-recipient-modal');
    const applyScheduleRecipientSelectionBtn = document.getElementById('apply-schedule-recipient-selection');
    const scheduleRecipientCustomerSearch = document.getElementById('scheduleRecipientCustomerSearch');
    const scheduleRecipientAreaSearch = document.getElementById('scheduleRecipientAreaSearch');
    const scheduleTitleField = document.getElementById('scheduleTitle');
    const scheduleMessageField = document.getElementById('scheduleMessage');
    const scheduleTemplateSelect = document.getElementById('schedule-template-select');
    const scheduleDateModeSelect = document.getElementById('scheduleDateMode');
    const scheduleDateField = document.getElementById('scheduleDateField');
    const scheduleDateTimeField = document.getElementById('scheduleDateTime');
    const scheduleDueTimeField = document.getElementById('scheduleDueTime');
    const scheduleTimeField = document.getElementById('scheduleTimeField');
    const scheduleTimePicker = document.getElementById('scheduleTimePicker');
    const scheduleTimeHourField = document.getElementById('scheduleTimeHour');
    const scheduleTimeMinuteField = document.getElementById('scheduleTimeMinute');
    const scheduleTimePeriodField = document.getElementById('scheduleTimePeriod');
    const scheduleDateLabel = document.getElementById('scheduleDateLabel');
    const scheduleTimeLabel = document.getElementById('scheduleTimeLabel');
    const scheduleDateModeHint = document.getElementById('scheduleDateModeHint');
    const scheduleDateTimeHint = document.getElementById('scheduleDateTimeHint');
    const scheduleDelayField = document.getElementById('scheduleDelayField');
    const scheduleDelayDaysField = document.getElementById('scheduleDelayDays');
    const scheduleDelayHint = document.getElementById('scheduleDelayHint');
    const scheduleRepeatSelect = document.getElementById('scheduleRepeat');
    const scheduleRepeatCountField = document.getElementById('scheduleRepeatCount');
    const scheduleRepeatHint = document.getElementById('scheduleRepeatHint');
    const scheduleSelectedCustomerValues = new Set();
    const scheduleSelectedAreaValues = new Set();
    let scheduleVisibleCustomerRecords = [];

    const trimScheduleSelectionSet = (selectionSet, validValues) => {
        Array.from(selectionSet).forEach((value) => {
            if (!validValues.has(value)) {
                selectionSet.delete(value);
            }
        });
    };

    const updateScheduleRecipientSummary = () => {
        if (!scheduleRecipientSummaryText) return;
        const selectedType = document.querySelector('input[name="scheduleRecipientType"]:checked')?.value || 'subscriber';
        if (selectedType === 'subscriber') {
            const count = scheduleSelectedCustomerValues.size;
            if (count === 0) {
                scheduleRecipientSummaryText.textContent = 'No recipients selected.';
            } else if (count === 1) {
                const value = Array.from(scheduleSelectedCustomerValues)[0];
                const record = subscriberLookup.get(value);
                scheduleRecipientSummaryText.textContent = record?.label || '1 customer selected';
            } else {
                scheduleRecipientSummaryText.textContent = `${count} customers selected`;
            }
            return;
        }

        const count = scheduleSelectedAreaValues.size;
        if (count === 0) {
            scheduleRecipientSummaryText.textContent = 'No recipients selected.';
        } else if (count === 1) {
            const value = Array.from(scheduleSelectedAreaValues)[0];
            const area = areaLookup.get(value);
            scheduleRecipientSummaryText.textContent = `Area: ${area?.name || value}`;
        } else {
            scheduleRecipientSummaryText.textContent = `${count} areas selected`;
        }
    };

    const updateScheduleCustomerCount = () => {
        if (!scheduleRecipientCustomerCount) return;
        const count = scheduleSelectedCustomerValues.size;
        const total = subscriberRecords.length;
        scheduleRecipientCustomerCount.textContent = total > 0
            ? `${count} customer${count !== 1 ? 's' : ''} selected (total: ${total})`
            : `${count} customer${count !== 1 ? 's' : ''} selected`;
    };

    const parseScheduleTime24 = (value) => {
        const raw = String(value || '').trim();
        const match = raw.match(/^(\d{1,2}):(\d{2})$/);
        if (!match) return null;
        const hours = Number.parseInt(match[1], 10);
        const minutes = Number.parseInt(match[2], 10);
        if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
        return { hours, minutes };
    };

    const normalizeScheduleTime24 = (hours, minutes) => {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    };

    const ensureScheduleTimePickerOptions = () => {
        if (scheduleTimeHourField && scheduleTimeHourField.options.length === 0) {
            for (let hour = 1; hour <= 12; hour += 1) {
                const option = document.createElement('option');
                option.value = String(hour);
                option.textContent = String(hour);
                scheduleTimeHourField.append(option);
            }
        }

        if (scheduleTimeMinuteField && scheduleTimeMinuteField.options.length === 0) {
            for (let minute = 0; minute <= 59; minute += 1) {
                const option = document.createElement('option');
                option.value = String(minute).padStart(2, '0');
                option.textContent = String(minute).padStart(2, '0');
                scheduleTimeMinuteField.append(option);
            }
        }
    };

    const setScheduleDueTime = (time24) => {
        const parsed = parseScheduleTime24(time24);
        if (!parsed || !scheduleDueTimeField) return;
        const normalized = normalizeScheduleTime24(parsed.hours, parsed.minutes);
        scheduleDueTimeField.value = normalized;
    };

    const syncScheduleDueTimeFromPicker = () => {
        if (!scheduleTimeHourField || !scheduleTimeMinuteField || !scheduleTimePeriodField) return;
        const selectedHour = Number.parseInt(scheduleTimeHourField.value, 10);
        const selectedMinute = Number.parseInt(scheduleTimeMinuteField.value, 10);
        const period = String(scheduleTimePeriodField.value || 'AM').toUpperCase() === 'PM' ? 'PM' : 'AM';
        if (!Number.isInteger(selectedHour) || selectedHour < 1 || selectedHour > 12) return;
        if (!Number.isInteger(selectedMinute) || selectedMinute < 0 || selectedMinute > 59) return;

        let hours24 = selectedHour % 12;
        if (period === 'PM') {
            hours24 += 12;
        }
        setScheduleDueTime(normalizeScheduleTime24(hours24, selectedMinute));
    };

    const syncScheduleTimePickerFromDueTime = () => {
        ensureScheduleTimePickerOptions();

        let parsed = parseScheduleTime24(scheduleDueTimeField?.value);
        if (!parsed) {
            parsed = { hours: 9, minutes: 0 };
        }

        const period = parsed.hours >= 12 ? 'PM' : 'AM';
        let hour12 = parsed.hours % 12;
        if (hour12 === 0) hour12 = 12;

        if (scheduleTimeHourField) {
            scheduleTimeHourField.value = String(hour12);
        }
        if (scheduleTimeMinuteField) {
            scheduleTimeMinuteField.value = String(parsed.minutes).padStart(2, '0');
        }
        if (scheduleTimePeriodField) {
            scheduleTimePeriodField.value = period;
        }

        setScheduleDueTime(normalizeScheduleTime24(parsed.hours, parsed.minutes));
    };

    const updateScheduleDateModeUI = () => {
        const mode = String(scheduleDateModeSelect?.value || 'custom').trim().toLowerCase();
        const isBillingDateMode = mode === 'billing-date';
        const isDueDateMode = mode === 'due-date';
        const isCycleDateMode = isBillingDateMode || isDueDateMode;

        if (scheduleDateLabel) {
            scheduleDateLabel.textContent = 'Set Date';
            scheduleDateLabel.htmlFor = 'scheduleDateTime';
        }

        if (scheduleTimeLabel) {
            scheduleTimeLabel.textContent = isCycleDateMode ? 'Send Time' : 'Set Time';
            scheduleTimeLabel.htmlFor = 'scheduleTimeHour';
        }

        if (scheduleDateModeHint) {
            if (isBillingDateMode) {
                scheduleDateModeHint.textContent = 'Billing Date mode uses each customer billing date plus delay days, then sends at the selected time.';
                scheduleDateModeHint.hidden = false;
            } else if (isDueDateMode) {
                scheduleDateModeHint.textContent = 'Due Date mode uses each customer due date plus delay days, then sends at the selected time.';
                scheduleDateModeHint.hidden = false;
            } else {
                scheduleDateModeHint.textContent = '';
                scheduleDateModeHint.hidden = true;
            }
        }

        if (scheduleDateTimeHint) {
            if (isBillingDateMode) {
                scheduleDateTimeHint.textContent = 'Only time is required. Date follows each account billing date with delay offset.';
            } else if (isDueDateMode) {
                scheduleDateTimeHint.textContent = 'Only time is required. Date follows each account due date with delay offset.';
            } else {
                scheduleDateTimeHint.textContent = 'Pick date, then set the send time below.';
            }
        }

        if (scheduleDateTimeField) {
            scheduleDateTimeField.hidden = isCycleDateMode;
            scheduleDateTimeField.disabled = isCycleDateMode;
            scheduleDateTimeField.required = !isCycleDateMode;
        }

        if (scheduleDateField) {
            scheduleDateField.hidden = isCycleDateMode;
        }

        if (scheduleTimeField) {
            scheduleTimeField.hidden = false;
        }

        if (scheduleDueTimeField) {
            scheduleDueTimeField.hidden = true;
            scheduleDueTimeField.disabled = false;
            scheduleDueTimeField.required = false;
            if (!parseScheduleTime24(scheduleDueTimeField.value)) {
                scheduleDueTimeField.value = '09:00';
            }
        }

        if (scheduleTimePicker) {
            scheduleTimePicker.hidden = false;
        }
        syncScheduleTimePickerFromDueTime();

        if (scheduleDelayField) {
            scheduleDelayField.hidden = false;
        }

        if (scheduleDelayDaysField) {
            scheduleDelayDaysField.hidden = false;
            scheduleDelayDaysField.disabled = false;
            scheduleDelayDaysField.required = false;
            const normalizedDelayDays = normalizeScheduleDelayDays(scheduleDelayDaysField.value);
            scheduleDelayDaysField.value = String(normalizedDelayDays);
        }

        if (scheduleDelayHint) {
            if (isCycleDateMode) {
                scheduleDelayHint.textContent = '0 = same day. 1 = 1 day after billing/due date.';
            } else {
                scheduleDelayHint.textContent = 'Delay is used for Billing Date/Due Date. Custom mode ignores this value.';
            }
            scheduleDelayHint.hidden = false;
        }
    };

    const updateScheduleRepeatUI = () => {
        const repeatMode = normalizeScheduleRepeat(scheduleRepeatSelect?.value || 'once');
        if (scheduleRepeatSelect) {
            scheduleRepeatSelect.value = repeatMode;
        }
        const isMore = repeatMode === 'more';

        if (scheduleRepeatCountField) {
            scheduleRepeatCountField.hidden = !isMore;
            scheduleRepeatCountField.disabled = !isMore;
            scheduleRepeatCountField.required = isMore;
            if (isMore) {
                const parsed = Number.parseInt(scheduleRepeatCountField.value, 10);
                if (!Number.isInteger(parsed) || parsed < 3) {
                    scheduleRepeatCountField.value = '3';
                }
            }
        }

        if (scheduleRepeatHint) {
            if (repeatMode === 'twice') {
                scheduleRepeatHint.textContent = 'Send exactly two times.';
            } else if (repeatMode === 'more') {
                scheduleRepeatHint.textContent = 'Choose how many total sends (minimum 3).';
            } else if (repeatMode === 'every-month') {
                scheduleRepeatHint.textContent = 'Repeat monthly using the selected date mode.';
            } else {
                scheduleRepeatHint.textContent = 'Send one time only.';
            }
        }
    };

    function syncScheduleRecipientModeVisibility() {
        const selectedType = document.querySelector('input[name="scheduleRecipientType"]:checked')?.value || 'subscriber';
        const isSubscriber = selectedType === 'subscriber';
        if (scheduleRecipientCustomerGroup && scheduleRecipientAreaGroup) {
            scheduleRecipientCustomerGroup.style.display = isSubscriber ? '' : 'none';
            scheduleRecipientAreaGroup.style.display = isSubscriber ? 'none' : '';
        }
        updateScheduleRecipientSummary();
    }

    function renderScheduleRecipientOptions() {
        const validCustomerValues = new Set(subscriberRecords.map((record) => record.value));
        trimScheduleSelectionSet(scheduleSelectedCustomerValues, validCustomerValues);

        const customerSearchTerm = (scheduleRecipientCustomerSearch?.value || '').trim().toLowerCase();
        const filteredCustomers = customerSearchTerm
            ? subscriberRecords.filter((record) => String(record.searchText || '').includes(customerSearchTerm))
            : subscriberRecords.slice();
        scheduleVisibleCustomerRecords = filteredCustomers;

        if (scheduleRecipientCustomerList) {
            scheduleRecipientCustomerList.innerHTML = '';

            if (!filteredCustomers.length) {
                scheduleRecipientCustomerList.innerHTML = `
                    <div class="subscriber-empty">
                        <i class="fa-solid fa-user-slash"></i>
                        <span>No customers match your search.</span>
                    </div>
                `;
            } else {
                filteredCustomers.forEach((record) => {
                    const optionLabel = document.createElement('label');
                    optionLabel.className = 'subscriber-option';
                    optionLabel.dataset.value = record.value;
                    optionLabel.dataset.label = record.label;
                    optionLabel.setAttribute('role', 'option');
                    optionLabel.setAttribute('aria-selected', scheduleSelectedCustomerValues.has(record.value) ? 'true' : 'false');
                    optionLabel.tabIndex = 0;

                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    input.value = record.value;
                    input.checked = scheduleSelectedCustomerValues.has(record.value);
                    input.setAttribute('aria-label', record.label);
                    input.tabIndex = -1;

                    const avatar = document.createElement('span');
                    avatar.className = 'subscriber-avatar';
                    avatar.textContent = record.initials;

                    const content = document.createElement('span');
                    content.className = 'subscriber-option-content';

                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'subscriber-name';
                    nameSpan.textContent = record.label;

                    const metaSpan = document.createElement('span');
                    metaSpan.className = 'subscriber-meta';
                    metaSpan.textContent = record.meta;

                    content.append(nameSpan, metaSpan);

                    const check = document.createElement('span');
                    check.className = 'subscriber-check';
                    check.innerHTML = '<i class="fa-solid fa-check"></i>';

                    optionLabel.append(input, avatar, content, check);
                    scheduleRecipientCustomerList.append(optionLabel);
                });
            }
        }
        updateScheduleCustomerCount();

        const validAreaValues = new Set(areas.map((area) => area.id));
        trimScheduleSelectionSet(scheduleSelectedAreaValues, validAreaValues);

        const areaSearchTerm = (scheduleRecipientAreaSearch?.value || '').trim().toLowerCase();
        const filteredAreas = areaSearchTerm
            ? areas.filter((area) => {
                const areaName = String(area.name || '').toLowerCase();
                const areaId = String(area.id || '').toLowerCase();
                return areaName.includes(areaSearchTerm) || areaId.includes(areaSearchTerm);
            })
            : areas.slice();

        if (scheduleRecipientAreaSelector) {
            scheduleRecipientAreaSelector.innerHTML = '';

            if (!filteredAreas.length) {
                scheduleRecipientAreaSelector.innerHTML = `
                    <div class="subscriber-empty">
                        <i class="fa-solid fa-map-location-dot"></i>
                        <span>No areas match your search.</span>
                    </div>
                `;
            } else {
                filteredAreas.forEach((area) => {
                    const card = document.createElement('button');
                    card.type = 'button';
                    card.className = 'area-card';
                    card.dataset.value = area.id;
                    card.dataset.label = area.name;
                    card.setAttribute('role', 'option');
                    const isSelected = scheduleSelectedAreaValues.has(area.id);
                    card.classList.toggle('selected', isSelected);
                    card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
                    const zoneId = area.id.replace(/-/g, ' ').toUpperCase();
                    card.innerHTML = `
                        <span class="area-card-icon"><i class="fa-solid fa-map-location-dot"></i></span>
                        <span class="area-card-title">${area.name}</span>
                        <span class="area-card-meta">Zone ID: ${zoneId}</span>
                        <span class="area-card-check"><i class="fa-solid fa-check"></i></span>
                    `;
                    scheduleRecipientAreaSelector.append(card);
                });
            }
        }

        updateScheduleRecipientSummary();
    }

    function renderScheduleTemplateOptions() {
        if (!scheduleTemplateSelect) return;
        const currentValue = scheduleTemplateSelect.value;
        scheduleTemplateSelect.innerHTML = '<option value="">Select a template...</option>';
        smsTemplates.forEach((template) => {
            const option = document.createElement('option');
            option.value = String(template.id);
            option.textContent = template.name;
            scheduleTemplateSelect.appendChild(option);
        });
        if (currentValue && smsTemplates.some((template) => String(template.id) === currentValue)) {
            scheduleTemplateSelect.value = currentValue;
        }
    }

    function renderAutomationTemplateOptions() {
        if (!automationTemplateSelect) return;
        const currentValue = automationTemplateSelect.value;
        automationTemplateSelect.innerHTML = '<option value="">Select a template...</option>';
        smsTemplates.forEach((template) => {
            const option = document.createElement('option');
            option.value = String(template.id);
            option.textContent = template.name;
            automationTemplateSelect.appendChild(option);
        });
        if (currentValue && smsTemplates.some((template) => String(template.id) === currentValue)) {
            automationTemplateSelect.value = currentValue;
        }
    }

    function getScheduleRecipientSelection({ strict = false } = {}) {
        const selectedType = document.querySelector('input[name="scheduleRecipientType"]:checked')?.value || 'subscriber';
        if (selectedType === 'subscriber') {
            const selectedValues = Array.from(scheduleSelectedCustomerValues);
            if (!selectedValues.length) {
                return {
                    error: strict ? 'Please select at least one customer.' : '',
                    recipientType: 'subscriber',
                    recipientIdentifier: 'No customers selected.',
                    recipientValue: []
                };
            }
            const selectedCustomers = selectedValues
                .map((value) => subscriberLookup.get(value) || { label: value, accountNumber: '', mobile: '', email: '', area: '' });
            const recipientIdentifier = selectedCustomers.length === 1
                ? (selectedCustomers[0].label || selectedCustomers[0].accountNumber || selectedValues[0])
                : `${selectedCustomers.length} customers`;
            const recipientValue = selectedCustomers.map((customer) => ({
                label: customer.label || '',
                accountNumber: customer.accountNumber || '',
                mobile: customer.mobile || '',
                email: customer.email || '',
                area: customer.area || ''
            }));
            return {
                error: '',
                recipientType: 'subscriber',
                recipientIdentifier,
                recipientValue
            };
        }

        const selectedAreaValues = Array.from(scheduleSelectedAreaValues);
        if (!selectedAreaValues.length) {
            return {
                error: strict ? 'Please select at least one area.' : '',
                recipientType: 'area',
                recipientIdentifier: 'No areas selected.',
                recipientValue: []
            };
        }
        const selectedAreas = selectedAreaValues.map((value) => {
            const selectedArea = areaLookup.get(value) || areas.find((area) => area.id === value);
            return { id: selectedArea?.id || value, name: selectedArea?.name || value };
        });
        const selectedAreaNames = selectedAreas.map((entry) => entry.name);
        const recipientIdentifier = selectedAreaNames.length <= 2
            ? `Areas: ${selectedAreaNames.join(', ')}`
            : `${selectedAreaNames.length} areas`;
        return {
            error: '',
            recipientType: 'area',
            recipientIdentifier,
            recipientValue: selectedAreas
        };
    }

    const syncScheduleModalFields = () => {
        if (scheduleTitleField) {
            scheduleTitleField.value = '';
        }

        if (scheduleMessageField) {
            scheduleMessageField.value = messageTextarea ? messageTextarea.value.trim() : '';
        }

        if (scheduleRecipientCustomerSearch) {
            scheduleRecipientCustomerSearch.value = '';
        }
        if (scheduleRecipientAreaSearch) {
            scheduleRecipientAreaSearch.value = '';
        }

        scheduleSelectedCustomerValues.clear();
        scheduleSelectedAreaValues.clear();

        const sourceType = document.querySelector('input[name="recipientType"]:checked')?.value || 'subscriber';
        if (scheduleRecipientTypeRadios.length > 0) {
            scheduleRecipientTypeRadios.forEach((radio) => {
                radio.checked = radio.value === sourceType;
            });
        }

        if (sourceType === 'subscriber') {
            const selectedSubscribers = getSelectedSubscribers();
            selectedSubscribers.forEach((subscriber) => {
                if (subscriber?.value && subscriberLookup.has(subscriber.value)) {
                    scheduleSelectedCustomerValues.add(subscriber.value);
                }
            });
        } else {
            getSelectedAreas().forEach((area) => {
                if (area?.id && areaLookup.has(area.id)) {
                    scheduleSelectedAreaValues.add(area.id);
                }
            });
        }

        renderScheduleRecipientOptions();

        renderScheduleTemplateOptions();
        if (scheduleTemplateSelect) {
            scheduleTemplateSelect.value = '';
        }
        if (scheduleDateModeSelect && !scheduleDateModeSelect.value) {
            scheduleDateModeSelect.value = 'custom';
        }
        if (scheduleDueTimeField && !parseScheduleTime24(scheduleDueTimeField.value)) {
            scheduleDueTimeField.value = '09:00';
        }
        if (scheduleRepeatSelect) {
            scheduleRepeatSelect.value = 'once';
        }
        if (scheduleDelayDaysField) {
            scheduleDelayDaysField.value = '0';
        }
        if (scheduleRepeatCountField) {
            scheduleRepeatCountField.value = '3';
        }
        if (scheduleForm) {
            scheduleForm.querySelectorAll('input[name="deliveryMethod"]').forEach((input) => {
                input.checked = true;
            });
        }
        syncScheduleTimePickerFromDueTime();
        updateScheduleDateModeUI();
        updateScheduleRepeatUI();
        syncScheduleRecipientModeVisibility();
    };

    if (scheduleRecipientTypeRadios.length > 0) {
        scheduleRecipientTypeRadios.forEach((radio) => {
            radio.addEventListener('change', syncScheduleRecipientModeVisibility);
        });
    }

    if (scheduleRecipientCustomerList) {
        scheduleRecipientCustomerList.addEventListener('change', (event) => {
            if (!(event.target instanceof HTMLInputElement)) return;
            const checkbox = event.target;
            if (checkbox.type !== 'checkbox') return;
            const { value, checked } = checkbox;
            if (checked) {
                scheduleSelectedCustomerValues.add(value);
            } else {
                scheduleSelectedCustomerValues.delete(value);
            }

            const option = checkbox.closest('.subscriber-option');
            if (option) {
                option.setAttribute('aria-selected', checked ? 'true' : 'false');
            }

            updateScheduleCustomerCount();
            updateScheduleRecipientSummary();
        });

        scheduleRecipientCustomerList.addEventListener('keydown', (event) => {
            if (!(event.target instanceof HTMLElement)) return;
            if (!event.target.classList.contains('subscriber-option')) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                const checkbox = event.target.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        });
    }

    if (scheduleRecipientSelectAllBtn) {
        scheduleRecipientSelectAllBtn.addEventListener('click', () => {
            scheduleVisibleCustomerRecords.forEach((record) => {
                scheduleSelectedCustomerValues.add(record.value);
            });
            renderScheduleRecipientOptions();
        });
    }

    if (scheduleRecipientClearAllBtn) {
        scheduleRecipientClearAllBtn.addEventListener('click', () => {
            scheduleSelectedCustomerValues.clear();
            renderScheduleRecipientOptions();
        });
    }

    if (scheduleRecipientAreaSelector) {
        scheduleRecipientAreaSelector.addEventListener('click', (event) => {
            const card = event.target.closest('.area-card');
            if (!card) return;
            const value = String(card.dataset.value || '').trim();
            if (!value) return;
            if (scheduleSelectedAreaValues.has(value)) {
                scheduleSelectedAreaValues.delete(value);
            } else {
                scheduleSelectedAreaValues.add(value);
            }
            renderScheduleRecipientOptions();
        });
    }

    if (openScheduleRecipientModalBtn) {
        openScheduleRecipientModalBtn.addEventListener('click', () => {
            renderScheduleRecipientOptions();
            syncScheduleRecipientModeVisibility();
            openModal('scheduleRecipientModal');
        });
    }

    if (applyScheduleRecipientSelectionBtn) {
        applyScheduleRecipientSelectionBtn.addEventListener('click', () => {
            updateScheduleRecipientSummary();
            closeModal('scheduleRecipientModal');
        });
    }

    const bindScheduleSearch = (inputEl) => {
        if (!inputEl) return;
        const rerender = () => renderScheduleRecipientOptions();
        inputEl.addEventListener('input', rerender);
        inputEl.addEventListener('keyup', rerender);
        inputEl.addEventListener('search', rerender);
    };

    bindScheduleSearch(scheduleRecipientCustomerSearch);
    bindScheduleSearch(scheduleRecipientAreaSearch);

    if (scheduleTemplateSelect) {
        scheduleTemplateSelect.addEventListener('change', () => {
            const selectedTemplateId = scheduleTemplateSelect.value;
            if (!selectedTemplateId || !scheduleMessageField) return;
            const selectedTemplate = smsTemplates.find((template) => String(template.id) === selectedTemplateId);
            if (selectedTemplate) {
                scheduleMessageField.value = selectedTemplate.content;
            }
        });
    }

    if (scheduleDateModeSelect) {
        scheduleDateModeSelect.addEventListener('change', () => {
            updateScheduleDateModeUI();
        });
    }
    if (scheduleTimeHourField) {
        scheduleTimeHourField.addEventListener('change', syncScheduleDueTimeFromPicker);
    }
    if (scheduleTimeMinuteField) {
        scheduleTimeMinuteField.addEventListener('change', syncScheduleDueTimeFromPicker);
    }
    if (scheduleTimePeriodField) {
        scheduleTimePeriodField.addEventListener('change', syncScheduleDueTimeFromPicker);
    }
    if (scheduleRepeatSelect) {
        scheduleRepeatSelect.addEventListener('change', () => {
            updateScheduleRepeatUI();
        });
    }
    ensureScheduleTimePickerOptions();
    syncScheduleTimePickerFromDueTime();
    updateScheduleDateModeUI();
    updateScheduleRepeatUI();

    const scheduleForm = document.getElementById('scheduleForm');
    if (scheduleForm) {
        scheduleForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const unlock = window.withSubmitLock ? window.withSubmitLock(scheduleForm, { label: 'Saving...' }) : null;
            if (window.withSubmitLock && !unlock) return;
            try {
            const scheduleMode = String(scheduleForm.elements.scheduleDateMode?.value || 'custom').trim().toLowerCase();
            const isBillingDateMode = scheduleMode === 'billing-date';
            const isDueDateMode = scheduleMode === 'due-date';
            const isCycleDateMode = isBillingDateMode || isDueDateMode;
            const repeatMode = normalizeScheduleRepeat(scheduleForm.elements.scheduleRepeat?.value || 'once');
            const scheduleDate = String(scheduleForm.elements.scheduleDateTime?.value || '').trim();
            const scheduleDueTime = String(scheduleForm.elements.scheduleDueTime?.value || '').trim();
            const scheduleDelayDaysRaw = String(scheduleForm.elements.scheduleDelayDays?.value || '').trim();
            const scheduleRepeatCountRaw = String(scheduleForm.elements.scheduleRepeatCount?.value || '').trim();
            const deliveryMethods = getCheckedDeliveryMethods(scheduleForm);
            const scheduleTitle = String(scheduleForm.elements.scheduleTitle?.value || '').trim();
            const message = scheduleForm.elements.scheduleMessage?.value?.trim() || '';

            if (!scheduleTitle) {
                showToast('Please enter a scheduler title.');
                return;
            }

            if (!message) {
                showToast('Please enter a message before scheduling.');
                return;
            }

            if (!isCycleDateMode && !scheduleDate) {
                showToast('Please pick a schedule date.');
                return;
            }

            if (!scheduleDueTime) {
                showToast('Please pick a send time.');
                return;
            }

            let scheduleDelayDays = 0;
            if (isCycleDateMode) {
                const parsedDelayDays = Number.parseInt(scheduleDelayDaysRaw || '0', 10);
                if (!Number.isInteger(parsedDelayDays) || parsedDelayDays < 0) {
                    showToast('Delay days must be 0 or higher.');
                    return;
                }
                scheduleDelayDays = parsedDelayDays;
            }

            let scheduleRepeatCount = 0;
            if (repeatMode === 'more') {
                const parsedRepeatCount = Number.parseInt(scheduleRepeatCountRaw, 10);
                if (!Number.isInteger(parsedRepeatCount) || parsedRepeatCount < 3) {
                    showToast('For "More", enter a repeat count of at least 3.');
                    return;
                }
                scheduleRepeatCount = parsedRepeatCount;
            }

            let resolvedCustomScheduleIso = '';
            if (!isCycleDateMode) {
                const parsedCustomSchedule = new Date(`${scheduleDate}T${scheduleDueTime}`);
                if (Number.isNaN(parsedCustomSchedule.getTime())) {
                    showToast('Please provide a valid custom schedule date and time.');
                    return;
                }
                resolvedCustomScheduleIso = parsedCustomSchedule.toISOString();
            }

            if (deliveryMethods.length === 0) {
                showToast('Choose at least one delivery method.');
                return;
            }

            const {
                error,
                recipientType,
                recipientIdentifier,
                recipientValue
            } = getScheduleRecipientSelection({ strict: true });
            if (error) {
                showToast(error);
                return;
            }

            const templateId = Number.parseInt(String(scheduleTemplateSelect?.value || '').trim(), 10);

            await requestSmsApi('/schedules', {
                method: 'POST',
                body: JSON.stringify({
                    title: scheduleTitle,
                    recipientType,
                    recipientValue,
                    recipientIdentifier,
                    messageText: message,
                    deliveryMethods,
                    templateId: Number.isInteger(templateId) && templateId > 0 ? templateId : null,
                    scheduleMode: isCycleDateMode ? scheduleMode : 'custom',
                    scheduleTime: isCycleDateMode ? null : resolvedCustomScheduleIso,
                    scheduleDueTime: isCycleDateMode ? scheduleDueTime : '',
                    scheduleDelayDays: isCycleDateMode ? scheduleDelayDays : 0,
                    repeatMode,
                    repeatCount: repeatMode === 'more' ? scheduleRepeatCount : 0,
                    status: 'active'
                })
            });
            await loadSmsSchedules({ silent: true });
            closeModal('scheduleModal');
            showToast('Message scheduled successfully!');
            } catch (error) {
                showToast(error.message || 'Failed to save schedule.');
            } finally {
                if (unlock) unlock();
            }
        });
    }

    const toLocalDateValue = (date) => {
        const pad = (value) => String(value).padStart(2, '0');
        return [
            date.getFullYear(),
            pad(date.getMonth() + 1),
            pad(date.getDate())
        ].join('-');
    };

    const toLocalTimeValue = (date) => {
        const pad = (value) => String(value).padStart(2, '0');
        return [pad(date.getHours()), pad(date.getMinutes())].join(':');
    };

    const openScheduleModalBtn = document.getElementById('open-schedule-modal');
    if (openScheduleModalBtn) {
        openScheduleModalBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (scheduleDateTimeField) {
                const now = new Date();
                now.setHours(now.getHours() + 1);
                now.setMinutes(0, 0, 0);
                scheduleDateTimeField.value = toLocalDateValue(now);
            }
            if (scheduleDueTimeField && !parseScheduleTime24(scheduleDueTimeField.value)) {
                const now = new Date();
                now.setHours(now.getHours() + 1);
                now.setMinutes(0, 0, 0);
                scheduleDueTimeField.value = toLocalTimeValue(now);
            }
            syncScheduleTimePickerFromDueTime();
            if (scheduleDateModeSelect) {
                scheduleDateModeSelect.value = 'custom';
            }
            syncScheduleModalFields();
            updateScheduleDateModeUI();
            openModal('scheduleModal');
        });
    }


    // Automation + SMS history management
    const automationListEl = document.getElementById('automation-list');
    const openAutomationModalBtn = document.getElementById('open-automation-modal');
    const automationModal = document.getElementById('automationModal');
    const automationModalTitle = document.getElementById('automationModalTitle');
    const automationForm = document.getElementById('automationForm');
    const automationNameField = document.getElementById('automationName');
    const automationTriggerSelect = document.getElementById('automationTrigger');
    const automationTimingSelect = document.getElementById('automationTiming');
    const automationTemplateSelect = document.getElementById('automation-template-select');
    const automationStatusSelect = document.getElementById('automationStatus');
    const automationMessageField = document.getElementById('automationMessage');

    const getSelectedAutomationChannels = () => {
        if (!automationForm) return [];
        return Array.from(automationForm.querySelectorAll('input[name="automationChannels"]:checked')).map(input => input.value);
    };

    const automationTriggerDefinitions = [
        {
            id: 'payment-received',
            label: 'Payment Received',
            icon: 'fa-solid fa-receipt',
            description: 'Send a confirmation the moment a payment posts to the account.',
            defaultMessage: 'Hi {customer_name}, we received your payment of {amount} on {payment_date}. Your remaining balance is {balance}. Thank you for staying current!',
            placeholders: ['{customer_name}', '{amount}', '{payment_date}', '{balance}'],
            defaultTiming: 'immediate'
        },
        {
            id: 'payment-overdue',
            label: 'Payment Overdue',
            icon: 'fa-solid fa-triangle-exclamation',
            description: 'Remind subscribers when their bill is past due.',
            defaultMessage: 'Hi {customer_name}, your account shows an outstanding balance of {amount_due} due since {due_date}. Kindly settle within {grace_period} to avoid service interruption.',
            placeholders: ['{customer_name}', '{amount_due}', '{due_date}', '{grace_period}'],
            defaultTiming: 'daily-8am'
        },
        {
            id: 'service-restored',
            label: 'Service Restored',
            icon: 'fa-solid fa-wifi',
            description: 'Notify customers once a service disruption is resolved.',
            defaultMessage: 'Good news {customer_name}! Service has been restored in {area_name}. Thank you for your patience.',
            placeholders: ['{customer_name}', '{area_name}'],
            defaultTiming: 'immediate'
        },
        {
            id: 'job-order-created',
            label: 'Job Order Created',
            icon: 'fa-solid fa-clipboard-list',
            description: 'Notify subscribers as soon as a job order is created for their account.',
            defaultMessage: 'Hi {customer_name}, we have created a job order for your account {account_number} on {date}. Our team will contact you for the schedule.',
            placeholders: ['{customer_name}', '{account_number}', '{date}'],
            defaultTiming: 'immediate'
        },
        {
            id: 'job-order-scheduled',
            label: 'Job Order Scheduled',
            icon: 'fa-solid fa-calendar-check',
            description: 'Send schedule confirmations for assigned job orders.',
            defaultMessage: 'Hi {customer_name}, your job order is scheduled on {date} between {start_time} and {end_time}. Please keep your line available.',
            placeholders: ['{customer_name}', '{date}', '{start_time}', '{end_time}'],
            defaultTiming: '1-day-prior'
        },
        {
            id: 'new-install-created',
            label: 'New Install Created',
            icon: 'fa-solid fa-house-signal',
            description: 'Send welcome updates when a new install request is created.',
            defaultMessage: 'Hi {customer_name}, your new installation request has been created for account {account_number}. We will share your confirmed schedule shortly.',
            placeholders: ['{customer_name}', '{account_number}'],
            defaultTiming: 'immediate'
        },
        {
            id: 'ticket-created',
            label: 'Ticket Created',
            icon: 'fa-solid fa-ticket',
            description: 'Confirm ticket creation immediately after submission.',
            defaultMessage: 'Hi {customer_name}, we received your support ticket for account {account_number} on {date}. Our support team will update you soon.',
            placeholders: ['{customer_name}', '{account_number}', '{date}'],
            defaultTiming: 'immediate'
        },
        {
            id: 'ticket-assigned',
            label: 'Ticket Assigned',
            icon: 'fa-solid fa-user-check',
            description: 'Notify customers when their ticket has been assigned to a technician.',
            defaultMessage: 'Hi {customer_name}, your support ticket has been assigned. Expected visit is on {date} between {start_time} and {end_time}.',
            placeholders: ['{customer_name}', '{date}', '{start_time}', '{end_time}'],
            defaultTiming: 'immediate'
        },
        {
            id: 'ticket-resolved',
            label: 'Ticket Resolved',
            icon: 'fa-solid fa-circle-check',
            description: 'Send completion updates after a ticket is resolved.',
            defaultMessage: 'Hi {customer_name}, your support ticket for account {account_number} was marked resolved on {date}. Thank you for your patience.',
            placeholders: ['{customer_name}', '{account_number}', '{date}'],
            defaultTiming: 'immediate'
        }
    ];

    const automationTimingOptions = [
        { id: 'immediate', label: 'Immediately after event' },
        { id: '15-min', label: '15 minutes after event' },
        { id: '1-hour', label: '1 hour after event' },
        { id: 'daily-8am', label: 'Daily summary at 8:00 AM' },
        { id: '1-day-prior', label: '1 day before scheduled task' }
    ];

    let smsAutomations = [];

    let automationModalMode = 'create';
    let automationEditingId = null;

    let smsHistory = [];

    const requestSmsApi = async (endpoint, options = {}) => {
        const response = await fetch(`/api/sms${endpoint}`, {
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            },
            ...options
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(
                payload?.error || payload?.message || `SMS request failed (${response.status})`
            );
            error.status = response.status;
            error.payload = payload;
            throw error;
        }
        return payload;
    };

    const mapTemplateFromApi = (template) => ({
        id: Number(template?.id),
        name: String(template?.name || '').trim(),
        content: String(template?.content || '').trim(),
        channels: Array.isArray(template?.channels) ? template.channels : [],
        isActive: template?.isActive !== false,
        createdAt: template?.createdAt || null,
        updatedAt: template?.updatedAt || null
    });

    const mapScheduleFromApi = (schedule) => ({
        id: Number(schedule?.id),
        title: String(schedule?.title || '').trim(),
        recipientType: String(schedule?.recipientType || 'subscriber').trim().toLowerCase() === 'area' ? 'area' : 'subscriber',
        recipientValue: schedule?.recipientValue ?? null,
        recipientIdentifier: String(schedule?.recipientIdentifier || '').trim(),
        recipient: String(schedule?.recipientIdentifier || '').trim() || '-',
        messageText: String(schedule?.messageText || '').trim(),
        message: String(schedule?.messageText || '').trim(),
        deliveryMethods: normalizeDeliveryMethods(schedule?.deliveryMethods),
        templateId: schedule?.templateId != null && String(schedule.templateId).trim() !== ''
            ? Number(schedule.templateId)
            : null,
        scheduleMode: String(schedule?.scheduleMode || 'custom').trim().toLowerCase(),
        scheduleTime: schedule?.scheduleTime || null,
        scheduleDueTime: String(schedule?.scheduleDueTime || '').trim(),
        scheduleDelayDays: Number.parseInt(schedule?.scheduleDelayDays || '0', 10) || 0,
        repeatMode: normalizeScheduleRepeat(schedule?.repeatMode || 'once'),
        repeatCount: Number.parseInt(schedule?.repeatCount || '0', 10) || 0,
        runCount: Number.parseInt(schedule?.runCount || '0', 10) || 0,
        status: String(schedule?.status || 'active').trim().toLowerCase(),
        lastExecutedAt: schedule?.lastExecutedAt || null,
        createdAt: schedule?.createdAt || null,
        updatedAt: schedule?.updatedAt || null
    });

    const mapAutomationFromApi = (automation) => ({
        id: String(automation?.id || ''),
        name: String(automation?.name || '').trim(),
        trigger: String(automation?.triggerEvent || automation?.trigger || '').trim(),
        timing: String(automation?.timing || 'immediate').trim(),
        channels: Array.isArray(automation?.channels) ? automation.channels : [],
        templateId: automation?.templateId != null && String(automation.templateId).trim() !== ''
            ? String(automation.templateId)
            : '',
        status: String(automation?.status || 'active').trim().toLowerCase(),
        message: String(automation?.messageText || automation?.message || '').trim(),
        createdAt: automation?.createdAt || null,
        updatedAt: automation?.updatedAt || null,
        lastTriggeredAt: automation?.lastTriggeredAt || null
    });

    const loadSmsTemplates = async ({ silent = true } = {}) => {
        try {
            const payload = await requestSmsApi('/templates');
            const templates = Array.isArray(payload?.templates) ? payload.templates : [];
            smsTemplates = templates
                .map(mapTemplateFromApi)
                .filter((template) => template.id && template.name && template.content);
            renderTemplates();
            return true;
        } catch (error) {
            if (!silent) {
                showToast(error.message || 'Failed to load templates.');
            } else {
                console.warn('Failed to load SMS templates:', error.message || error);
            }
            smsTemplates = [];
            renderTemplates();
            return false;
        }
    };

    const loadSmsSchedules = async ({ silent = true } = {}) => {
        try {
            const payload = await requestSmsApi('/schedules');
            const schedules = Array.isArray(payload?.schedules) ? payload.schedules : [];
            scheduledMessages = schedules.map(mapScheduleFromApi);
            renderScheduledMessages();
            return true;
        } catch (error) {
            if (!silent) {
                showToast(error.message || 'Failed to load schedules.');
            } else {
                console.warn('Failed to load SMS schedules:', error.message || error);
            }
            scheduledMessages = [];
            renderScheduledMessages();
            return false;
        }
    };

    const loadSmsAutomations = async ({ silent = true } = {}) => {
        try {
            const payload = await requestSmsApi('/automations');
            const automations = Array.isArray(payload?.automations) ? payload.automations : [];
            smsAutomations = automations.map(mapAutomationFromApi).filter((entry) => entry.id);
            renderAutomations();
            return true;
        } catch (error) {
            if (!silent) {
                showToast(error.message || 'Failed to load automations.');
            } else {
                console.warn('Failed to load SMS automations:', error.message || error);
            }
            smsAutomations = [];
            renderAutomations();
            return false;
        }
    };

    const loadSmsHistory = async ({ silent = true } = {}) => {
        try {
            const payload = await requestSmsApi('/history?limit=100');
            const history = Array.isArray(payload?.history) ? payload.history : [];
            smsHistory = history.map((entry) => ({
                id: entry.id,
                date: entry.date || entry.createdAt || null,
                recipient: entry.recipient || entry.recipientNumber || '-',
                message: entry.message || '',
                status: entry.status || 'sent',
                error: entry.error || ''
            }));
            refreshSmsHistoryInsights();
            return true;
        } catch (error) {
            if (!silent) {
                showToast(error.message || 'Failed to load SMS history.');
            } else {
                console.warn('Failed to load SMS history:', error.message || error);
            }
            return false;
        }
    };

    const escapeHtml = (value = '') => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const getTriggerDefinition = (triggerId) => automationTriggerDefinitions.find(def => def.id === triggerId);
    const getTimingLabel = (timingId) => automationTimingOptions.find(option => option.id === timingId)?.label || 'Custom timing';

    const ensureAutomationSelectsPopulated = () => {
        if (automationTriggerSelect && !automationTriggerSelect.childElementCount) {
            automationTriggerDefinitions.forEach(definition => {
                const option = document.createElement('option');
                option.value = definition.id;
                option.textContent = definition.label;
                automationTriggerSelect.appendChild(option);
            });
        }

        if (automationTimingSelect && !automationTimingSelect.childElementCount) {
            automationTimingOptions.forEach(optionData => {
                const option = document.createElement('option');
                option.value = optionData.id;
                option.textContent = optionData.label;
                automationTimingSelect.appendChild(option);
            });
        }

    };

    const setAutomationMessageFromTrigger = (triggerId, { force = false } = {}) => {
        if (!automationMessageField) return;
        const shouldAutofill = force || automationMessageField.dataset.autofill === 'true';
        if (!shouldAutofill) return;

        const definition = getTriggerDefinition(triggerId);
        if (definition?.defaultMessage) {
            automationMessageField.value = definition.defaultMessage;
        }
    };

    const openAutomationModal = ({ automation = null, triggerId = null } = {}) => {
        if (!automationForm || !automationModal) return;
        ensureAutomationSelectsPopulated();
        renderAutomationTemplateOptions();

        automationModalMode = automation ? 'edit' : 'create';
        automationEditingId = automation ? automation.id : null;

        if (automationModalTitle) {
            automationModalTitle.textContent = automation ? 'Edit Automation' : 'New Automation';
        }

        if (automationNameField) {
            automationNameField.value = automation ? automation.name : '';
        }

        const selectedTrigger = automation?.trigger || triggerId || automationTriggerSelect?.options?.[0]?.value || '';
        if (automationTriggerSelect) {
            automationTriggerSelect.value = selectedTrigger;
        }

        if (automationTimingSelect) {
            automationTimingSelect.value = automation?.timing || getTriggerDefinition(selectedTrigger)?.defaultTiming || automationTimingOptions[0].id;
        }

        if (automationStatusSelect) {
            automationStatusSelect.value = automation?.status || 'active';
        }

        if (automationTemplateSelect) {
            const selectedTemplate = String(automation?.templateId || '');
            automationTemplateSelect.value = selectedTemplate;
        }

        if (automationForm) {
            automationForm.querySelectorAll('input[name="automationChannels"]').forEach(input => {
                if (!automation) {
                    input.checked = true;
                } else {
                    input.checked = automation.channels.includes(input.value);
                }
            });
        }

        if (automationMessageField) {
            if (automation) {
                automationMessageField.value = automation.message;
                automationMessageField.dataset.autofill = 'false';
            } else {
                automationMessageField.value = '';
                automationMessageField.dataset.autofill = 'true';
                setAutomationMessageFromTrigger(selectedTrigger, { force: true });
            }
        }

        openModal('automationModal');
        requestAnimationFrame(() => automationNameField?.focus());
    };

    const renderAutomations = () => {
        if (!automationListEl) return;

        automationListEl.innerHTML = '';

        if (!smsAutomations.length) {
            const emptyRow = document.createElement('tr');
            const emptyCell = document.createElement('td');
            emptyCell.colSpan = 7;
            emptyCell.className = 'empty-state-row';
            emptyCell.textContent = 'No event automations yet.';
            emptyRow.appendChild(emptyCell);
            automationListEl.appendChild(emptyRow);
            return;
        }

        smsAutomations.forEach(automation => {
            const triggerDefinition = getTriggerDefinition(automation.trigger);
            const timingLabel = getTimingLabel(automation.timing);
            const channelsLabel = automation.channels.length
                ? automation.channels.map(channel => deliveryMethodLabels[channel] || channel.toUpperCase()).join(', ')
                : 'None';
            const statusLabel = automation.status === 'active' ? 'Active' : 'Paused';
            const statusClass = automation.status === 'active' ? 'status-active' : 'status-paused';

            const row = document.createElement('tr');
            row.dataset.id = automation.id;
            row.innerHTML = `
                <td>
                    <div class="event-name-cell">
                        <span class="event-name">${escapeHtml(automation.name)}</span>
                    </div>
                </td>
                <td>${escapeHtml(triggerDefinition?.label || automation.trigger)}</td>
                <td>${escapeHtml(timingLabel)}</td>
                <td>${escapeHtml(channelsLabel)}</td>
                <td>
                    <div class="event-status-cell">
                        <label class="automation-toggle event-toggle" aria-label="Toggle ${escapeHtml(automation.name)}">
                            <input type="checkbox" data-action="toggle" data-id="${automation.id}" ${automation.status === 'active' ? 'checked' : ''}>
                            <span class="automation-toggle-track"><span class="automation-toggle-thumb"></span></span>
                        </label>
                        <span class="status-pill ${statusClass}">${statusLabel}</span>
                    </div>
                </td>
                <td class="preview" title="${escapeHtml(automation.message)}">${escapeHtml(automation.message)}</td>
                <td class="actions">
                    <div class="table-actions">
                        <button type="button" class="icon-btn" data-action="edit" data-id="${automation.id}" title="Edit automation" aria-label="Edit ${escapeHtml(automation.name)}">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button type="button" class="icon-btn danger" data-action="delete" data-id="${automation.id}" title="Delete automation" aria-label="Delete ${escapeHtml(automation.name)}">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;

            automationListEl.appendChild(row);
        });
    };

    const renderRecentActivity = () => {
        if (!recentActivityList) return;

        recentActivityList.innerHTML = '';

        if (!smsHistory || smsHistory.length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.className = 'empty';
            emptyItem.textContent = 'No activity yet.';
            recentActivityList.appendChild(emptyItem);
            return;
        }

        smsHistory.slice(0, 3).forEach(event => {
            const listItem = document.createElement('li');

            const title = document.createElement('p');
            title.className = 'activity-title';
            const previewMessage = event.message || '';
            title.textContent = previewMessage.length > 70 ? `${previewMessage.substring(0, 67)}...` : previewMessage;

            const metaWrapper = document.createElement('div');
            metaWrapper.className = 'activity-meta';

            const timeSpan = document.createElement('span');
            timeSpan.className = 'activity-time';
            timeSpan.textContent = formatDateTime(event.date) || 'N/A';

            const statusSpan = document.createElement('span');
            const statusKey = (event.status || 'Sent').toLowerCase().replace(/\s+/g, '-');
            statusSpan.className = `status-pill small status-${statusKey}`;
            statusSpan.textContent = event.status || 'Sent';

            metaWrapper.appendChild(timeSpan);
            metaWrapper.appendChild(statusSpan);

            listItem.appendChild(title);
            listItem.appendChild(metaWrapper);

            recentActivityList.appendChild(listItem);
        });
    };

    const updateOverviewMetrics = () => {
        if (overviewDeliveredCount) {
            const deliveredEvents = smsHistory.filter((event) => {
                const status = String(event.status || '').trim().toLowerCase();
                if (!status) return false;
                return status !== 'failed' && status !== 'error';
            });
            overviewDeliveredCount.textContent = String(deliveredEvents.length);

            if (overviewDeliveredMeta) {
                if (deliveredEvents.length === 0) {
                    overviewDeliveredMeta.textContent = 'No delivered messages yet';
                } else {
                    const latestDeliveredDate = deliveredEvents.reduce((latest, event) => {
                        const current = new Date(event.date);
                        if (Number.isNaN(current.getTime())) return latest;
                        if (!latest || current > latest) return current;
                        return latest;
                    }, null);

                    overviewDeliveredMeta.textContent = latestDeliveredDate
                        ? `Last sent ${latestDeliveredDate.toLocaleString(locale, dateTimeOptions)}`
                        : 'Activity pending';
                }
            }
        }

        if (overviewScheduledCount) {
            const activeSchedules = scheduledMessages.filter((message) => String(message?.status || '').toLowerCase() === 'active');
            const scheduledCount = activeSchedules.length;
            overviewScheduledCount.textContent = String(scheduledCount);

            if (overviewScheduledMeta) {
                if (scheduledCount === 0) {
                    overviewScheduledMeta.textContent = 'Nothing queued';
                } else {
                    const hasCycleDateMode = activeSchedules.some((message) => {
                        const mode = String(message?.scheduleMode || '').trim().toLowerCase();
                        return mode === 'billing-date' || mode === 'due-date';
                    });
                    const nextScheduleDate = activeSchedules.reduce((next, message) => {
                        const mode = String(message?.scheduleMode || 'custom').trim().toLowerCase();
                        if (mode !== 'custom') return next;
                        const current = new Date(message.scheduleTime);
                        if (Number.isNaN(current.getTime())) return next;
                        if (!next || current < next) return current;
                        return next;
                    }, null);

                    if (nextScheduleDate) {
                        overviewScheduledMeta.textContent = `Next: ${nextScheduleDate.toLocaleString(locale, dateTimeOptions)}`;
                    } else if (hasCycleDateMode) {
                        overviewScheduledMeta.textContent = 'Billing/Due date schedule active';
                    } else {
                        overviewScheduledMeta.textContent = 'Scheduled - awaiting time';
                    }
                }
            }
        }

        if (overviewTemplatesCount) {
            const templateCount = smsTemplates.length;
            overviewTemplatesCount.textContent = String(templateCount);

            if (overviewTemplatesMeta) {
                if (templateCount === 0) {
                    overviewTemplatesMeta.textContent = 'Create your first template';
                } else {
                    const latestTemplate = smsTemplates.reduce((latest, template) => {
                        if (!latest) return template;
                        return template.id > latest.id ? template : latest;
                    }, null);

                    overviewTemplatesMeta.textContent = latestTemplate
                        ? `Latest: ${latestTemplate.name}`
                        : 'Templates ready';
                }
            }
        }
    };

    const refreshSmsHistoryInsights = () => {
        renderRecentActivity();
        updateOverviewMetrics();
    };

    if (automationTriggerSelect) {
        automationTriggerSelect.addEventListener('change', (event) => {
            const triggerId = event.target.value;
            setAutomationMessageFromTrigger(triggerId);
        });
    }

    if (automationMessageField) {
        automationMessageField.addEventListener('input', () => {
            automationMessageField.dataset.autofill = 'false';
        });
    }

    if (automationTemplateSelect) {
        automationTemplateSelect.addEventListener('change', () => {
            const selectedTemplateId = automationTemplateSelect.value;
            if (!selectedTemplateId || !automationMessageField) return;
            const selectedTemplate = smsTemplates.find((template) => String(template.id) === selectedTemplateId);
            if (selectedTemplate) {
                automationMessageField.value = selectedTemplate.content;
                automationMessageField.dispatchEvent(new Event('input'));
            }
        });
    }

    if (openAutomationModalBtn) {
        openAutomationModalBtn.addEventListener('click', () => openAutomationModal());
    }

    if (automationForm) {
        automationForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const unlock = window.withSubmitLock ? window.withSubmitLock(automationForm, { label: 'Saving...' }) : null;
            if (window.withSubmitLock && !unlock) return;
            try {

            const name = automationNameField?.value.trim();
            const trigger = automationTriggerSelect?.value;
            const timing = automationTimingSelect?.value;
            const templateId = String(automationTemplateSelect?.value || '').trim();
            const status = automationStatusSelect?.value || 'active';
            const message = automationMessageField?.value.trim();
            const channels = getSelectedAutomationChannels();

            if (!name || !trigger || !timing || !message) {
                showToast('Please complete all automation fields.');
                return;
            }

            if (!channels.length) {
                showToast('Choose at least one delivery channel.');
                return;
            }

            const numericTemplateId = Number.parseInt(templateId, 10);
            const payload = {
                name,
                triggerEvent: trigger,
                timing,
                channels,
                templateId: Number.isInteger(numericTemplateId) && numericTemplateId > 0 ? numericTemplateId : null,
                messageText: message,
                status
            };

            if (automationModalMode === 'edit') {
                await requestSmsApi(`/automations/${encodeURIComponent(automationEditingId)}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload)
                });
                showToast('Automation updated.');
            } else {
                await requestSmsApi('/automations', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                showToast('Automation created.');
            }

            await loadSmsAutomations({ silent: true });
            closeModal('automationModal');
            } catch (error) {
                showToast(error.message || 'Failed to save automation.');
            } finally {
                if (unlock) unlock();
            }
        });
    }

    if (automationListEl) {
        automationListEl.addEventListener('change', (event) => {
            const input = event.target;
            if (!(input instanceof HTMLInputElement)) return;
            if (!input.matches('input[data-action="toggle"]')) return;
            const automation = smsAutomations.find(auto => auto.id === input.dataset.id);
            if (!automation) return;
            const nextStatus = input.checked ? 'active' : 'paused';
            requestSmsApi(`/automations/${encodeURIComponent(automation.id)}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status: nextStatus })
            })
                .then(() => loadSmsAutomations({ silent: true }))
                .then(() => {
                    showToast(`Automation ${nextStatus === 'active' ? 'activated' : 'paused'}.`);
                })
                .catch((error) => {
                    input.checked = !input.checked;
                    showToast(error.message || 'Failed to update automation status.');
                });
        });

        automationListEl.addEventListener('click', async (event) => {
            const actionButton = event.target.closest('button[data-action]');
            if (!actionButton) return;
            const { action, id } = actionButton.dataset;
            const automation = smsAutomations.find(auto => auto.id === id);
            if (!automation) return;

            if (action === 'edit') {
                openAutomationModal({ automation });
                return;
            }

            if (action === 'delete') {
                const confirmed = window.appConfirm
                    ? await window.appConfirm(`Delete automation "${automation.name}"? This cannot be undone.`, { title: 'Delete Automation' })
                    : window.confirm(`Delete automation "${automation.name}"? This cannot be undone.`);
                if (!confirmed) return;
                requestSmsApi(`/automations/${encodeURIComponent(id)}`, {
                    method: 'DELETE'
                })
                    .then(() => loadSmsAutomations({ silent: true }))
                    .then(() => {
                        showToast('Automation removed.');
                    })
                    .catch((error) => {
                        showToast(error.message || 'Failed to remove automation.');
                    });
            }
        });
    }

    const normalizeMobileForSend = (value) => {
        const raw = String(value || '').trim().replace(/[^\d+]/g, '');
        if (!raw) return '';

        let local = raw;
        if (local.startsWith('+63')) local = `0${local.slice(3)}`;
        if (local.startsWith('63')) local = `0${local.slice(2)}`;
        if (local.startsWith('9') && local.length === 10) local = `0${local}`;
        return /^09\d{9}$/.test(local) ? local : '';
    };

    const normalizeEmailForSend = (value) => {
        const email = String(value || '').trim().toLowerCase();
        if (!email) return '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
        return email;
    };

    const recipientMatchesDeliveryMethods = (recipient, deliveryMethods) => {
        const methods = normalizeDeliveryMethods(deliveryMethods);
        if (!methods.length) return false;
        return methods.every((method) => {
            if (method === 'semaphore') return Boolean(recipient.mobile);
            if (method === 'mail') return Boolean(recipient.email);
            return false;
        });
    };

    const buildSmsRecipients = (recipientType) => {
        if (recipientType === 'subscriber') {
            const selected = getSelectedSubscribers();
            if (!selected.length) {
                return { error: 'Please select at least one subscriber.', recipients: [], summary: '' };
            }
            const recipients = selected.map((subscriber) => ({
                mobile: normalizeMobileForSend(subscriber.mobile),
                email: normalizeEmailForSend(subscriber.email),
                label: subscriber.label || subscriber.accountNumber || 'Subscriber',
                accountNumber: subscriber.accountNumber || '',
                area: subscriber.area || ''
            }));
            const summary = selected.length === 1
                ? selected[0].label
                : `${selected.length} subscribers`;
            return { error: '', recipients, summary };
        }

        const selectedAreas = getSelectedAreas();
        if (!selectedAreas.length) {
            return { error: 'Please select at least one area.', recipients: [], summary: '' };
        }
        const matched = getSubscribersByAreas(selectedAreas);
        if (!matched.length) {
            const summary = selectedAreas.length === 1
                ? `Area: ${selectedAreas[0].name}`
                : `${selectedAreas.length} areas`;
            return {
                error: selectedAreas.length === 1
                    ? `No subscribers found in ${selectedAreas[0].name}.`
                    : 'No subscribers found in the selected areas.',
                recipients: [],
                summary
            };
        }
        const recipients = matched.map((subscriber) => ({
            mobile: normalizeMobileForSend(subscriber.mobile),
            email: normalizeEmailForSend(subscriber.email),
            label: subscriber.label || subscriber.accountNumber || 'Subscriber',
            accountNumber: subscriber.accountNumber || '',
            area: subscriber.area || ''
        }));
        const summary = selectedAreas.length === 1
            ? `Area: ${selectedAreas[0].name}`
            : `${selectedAreas.length} areas`;
        return {
            error: '',
            recipients,
            summary
        };
    };

    // Preview functionality
    const showPreview = () => {
        const deliveryMethods = getCheckedDeliveryMethods(composeForm || document);
        if (deliveryMethods.length === 0) {
            showToast('Please select at least one delivery method.');
            return;
        }

        const recipientType = document.querySelector('input[name="recipientType"]:checked')?.value || 'subscriber';
        const message = document.getElementById('message').value.trim();
        if (!message) {
            showToast('Please enter a message.');
            return;
        }

        let recipients = [];
        let recipientDisplay = '';

        updateRecipientSummary();

        const recipientBundle = buildSmsRecipients(recipientType);
        if (recipientBundle.error) {
            showToast(recipientBundle.error);
            return;
        }
        recipients = recipientBundle.recipients;
        recipientDisplay = recipientBundle.summary;

        const validRecipients = recipients.filter((entry) => recipientMatchesDeliveryMethods(entry, deliveryMethods));
        if (!validRecipients.length) {
            showToast('No recipient has complete contact details for the selected delivery methods.');
            return;
        }

        // Populate preview modal
        const previewRecipientsList = document.getElementById('preview-recipients-list');
        const previewMessageText = document.getElementById('preview-message-text');
        const previewCharCount = document.getElementById('preview-char-count');

        if (previewRecipientsList) {
            previewRecipientsList.innerHTML = '';
            const renderRecipientItem = (text) => {
                const item = document.createElement('div');
                item.className = 'recipient-item';
                item.textContent = text;
                previewRecipientsList.appendChild(item);
            };

            if (recipientType === 'subscriber') {
                recipients.forEach(recipient => renderRecipientItem(recipient.label));
            } else {
                renderRecipientItem(recipientDisplay);
            }
        }

        if (previewMessageText) {
            previewMessageText.textContent = message;
        }
        if (previewCharCount) {
            previewCharCount.textContent = `${message.length}/160 characters`;
        }

        const modalTitle = document.getElementById('previewModalTitle');
        if (modalTitle) {
            modalTitle.textContent = `Message Preview (${formatDeliveryMethods(deliveryMethods)})`;
        }

        openModal('previewModal');
    };

    // Send SMS/Email functionality
    const sendSMS = async (triggerButton = null) => {
        const deliveryMethods = getCheckedDeliveryMethods(composeForm || document);
        if (deliveryMethods.length === 0) {
            showToast('Please select at least one delivery method.');
            return;
        }

        const recipientType = document.querySelector('input[name="recipientType"]:checked')?.value || 'subscriber';
        const messageField = document.getElementById('message');
        const message = messageField ? messageField.value.trim() : '';

        if (!message) {
            showToast('Please enter a message.');
            return;
        }

        updateRecipientSummary();

        const recipientBundle = buildSmsRecipients(recipientType);
        if (recipientBundle.error) {
            showToast(recipientBundle.error);
            return;
        }
        const recipients = recipientBundle.recipients;
        const eligibleRecipients = recipients.filter((entry) => recipientMatchesDeliveryMethods(entry, deliveryMethods));
        if (!eligibleRecipients.length) {
            showToast('No recipient has complete contact details for the selected delivery methods.');
            return;
        }

        const loadingBtn = triggerButton || document.getElementById('preview-btn') || document.getElementById('confirm-send-btn');
        const originalMarkup = loadingBtn ? loadingBtn.innerHTML : '';
        if (loadingBtn) {
            loadingBtn.disabled = true;
            loadingBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
        }

        try {
            const payload = {
                recipients,
                message,
                deliveryMethods
            };
            const response = await requestSmsApi('/send', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            await loadSmsHistory({ silent: true });

            const results = Array.isArray(response?.results) ? response.results : [];
            const invalidRecipients = Array.isArray(response?.invalidRecipients) ? response.invalidRecipients : [];
            const summary = {
                semaphore: { sent: 0, failed: 0, label: 'SMS' },
                mail: { sent: 0, failed: 0, label: 'Email' }
            };
            results.forEach((entry) => {
                const method = normalizeDeliveryMethods(entry?.deliveryMethod || entry?.provider)[0];
                if (!method || !summary[method]) return;
                const status = String(entry?.status || '').toLowerCase();
                if (status && status !== 'failed' && status !== 'error') {
                    summary[method].sent += 1;
                } else {
                    summary[method].failed += 1;
                }
            });

            const channelParts = normalizeDeliveryMethods(deliveryMethods).map((method) => {
                const chunk = summary[method] || { sent: 0, failed: 0, label: method.toUpperCase() };
                return `${chunk.label}: ${chunk.sent} sent, ${chunk.failed} failed`;
            });
            let toastMessage = channelParts.join(' | ');
            if (!toastMessage) {
                toastMessage = `Sent ${Number(response?.sent || 0)}, failed ${Number(response?.failed || 0)}.`;
            }
            if (invalidRecipients.length > 0) {
                toastMessage += ` (${invalidRecipients.length} invalid recipient${invalidRecipients.length === 1 ? '' : 's'})`;
            }
            showToast(toastMessage);

            const sent = Number(response?.sent || 0);
            if (sent > 0) {
                if (messageField) {
                    messageField.value = '';
                }
                if (charCount) {
                    charCount.textContent = '0/160';
                    charCount.style.color = '#64748b';
                }
                if (charFill) charFill.style.width = '0%';
                if (headerCharCount) headerCharCount.textContent = '0';
                updateToneFeedback(0);
                closeModal('previewModal');
            }
        } catch (error) {
            showToast(error.message || 'Failed to send message.');
        } finally {
            if (loadingBtn) {
                loadingBtn.disabled = false;
                loadingBtn.innerHTML = originalMarkup;
            }
        }
    };

    // Prevent form submission
    const composeForm = document.querySelector('.sms-compose-form');
    if (composeForm) {
        composeForm.addEventListener('submit', (e) => {
            e.preventDefault();
        });
    }

    // Event listeners
    const addTemplateBtn = document.querySelector('#templates .add-new-btn');
    if (addTemplateBtn) {
        addTemplateBtn.addEventListener('click', () => openTemplateModal());
    }

    // Template select in compose form
    if (templateSelect) {
        templateSelect.addEventListener('change', (e) => {
            const templateId = String(e.target.value || '').trim();
            if (templateId) {
                const template = smsTemplates.find((t) => String(t.id) === templateId);
                if (template && messageTextarea) {
                    messageTextarea.value = template.content;
                    messageTextarea.dispatchEvent(new Event('input'));
                }
            }
        });
    }

    // Send button
    const previewBtn = document.getElementById('preview-btn');
    if (previewBtn) {
        previewBtn.addEventListener('click', (e) => {
            e.preventDefault();
            sendSMS(previewBtn);
        });
    }

    // Confirm send from preview
    const confirmSendBtn = document.getElementById('confirm-send-btn');
    if (confirmSendBtn) {
        confirmSendBtn.addEventListener('click', (e) => {
            e.preventDefault();
            sendSMS(confirmSendBtn);
        });
    }

    // Initialize
    bindComposeDeliveryMethodPersistence();
    ensureAutomationSelectsPopulated();
    renderTemplates();
    renderScheduledMessages();
    renderAutomations();
    refreshSmsHistoryInsights();
    await Promise.all([
        loadSmsTemplates({ silent: true }),
        loadSmsSchedules({ silent: true }),
        loadSmsAutomations({ silent: true }),
        loadSmsHistory({ silent: true })
    ]);
});

