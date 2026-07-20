(function () {
    const state = {
        accountNumber: '',
        amountDue: 0,
        accountStatementUrl: '#',
        billingStatementUrl: '#',
        customerContact: '',
        customerName: '',
        currentPlanId: '',
        currentPlanName: '',
        notificationTotalCount: 0,
        notificationUnreadCount: 0,
        notifications: [],
        paymentHistory: [],
        paymentMethod: 'gcash',
        paymentMethods: ['gcash', 'paymaya', 'grabpay', 'shopeepay'],
        paymentMode: 'postpaid',
        showingAllHistory: false,
        supportEmail: '',
        ticketCategories: [
            'Blinking LOS',
            'No Power Modem',
            'Reset Modem',
            'Slow Connection',
            'Wire Problem',
            'Wi-Fi Connected, No Internet'
        ],
        tickets: [],
        wifiLoaded: false,
        wifiModem: null,
        wifiStatusMessage: ''
    };

    const pesoFormatter = new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2
    });

    const notificationApiBases = [
        '/api/customers/notifications',
        '/api/customer-app/notifications'
    ];

    const formatCurrency = (value) => {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return pesoFormatter.format(0);
        return pesoFormatter.format(amount);
    };

    const parseMoney = (value) => {
        const normalized = String(value || '').replace(/[^\d.]/g, '');
        const firstDot = normalized.indexOf('.');
        const clean = firstDot < 0
            ? normalized
            : `${normalized.slice(0, firstDot + 1)}${normalized.slice(firstDot + 1).replace(/\./g, '')}`;
        const amount = Number(clean);
        return Number.isFinite(amount) ? amount : 0;
    };

    const parseDate = (value) => {
        if (!value && value !== 0) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dateOnly) {
            return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
        }
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? null : date;
    };

    const formatDate = (value) => {
        const date = parseDate(value);
        if (!date) {
            const raw = String(value || '').trim();
            return raw || 'Not set';
        }
        return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const formatDateShort = (value) => {
        const date = parseDate(value);
        if (!date) return 'Not set';
        return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const hasExplicitTime = (value) => /(?:T|\s)\d{1,2}:\d{2}/.test(String(value || ''));

    const formatDateTime = (value) => {
        const date = parseDate(value);
        if (!date) {
            const raw = String(value || '').trim();
            return raw || 'Not set';
        }
        const dateText = date.toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        if (!hasExplicitTime(value)) return dateText;
        const timeText = date.toLocaleTimeString('en-PH', {
            hour: 'numeric',
            minute: '2-digit'
        });
        return `${dateText} ${timeText}`;
    };

    const formatMonthHeading = (value) => {
        const date = parseDate(value);
        if (!date) return 'Undated';
        return date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    };

    const getDaysUntil = (value) => {
        const date = parseDate(value);
        if (!date) return null;
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        return Math.ceil((target.getTime() - todayStart.getTime()) / 86400000);
    };

    const formatDueCountdown = (dateValue, amountDue = 0) => {
        const days = getDaysUntil(dateValue);
        if (days === null) return 'No due date set';
        if (Number(amountDue) <= 0) return "You're all set";
        if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
        if (days === 0) return 'Due today';
        return `${days} day${days === 1 ? '' : 's'} left`;
    };

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    const showAlert = (message, { autoHide = true } = {}) => {
        const alert = document.getElementById('portalAlert');
        if (!alert) return;
        const text = String(message || '').trim();
        alert.textContent = text;
        alert.hidden = !text;
        if (text && autoHide) {
            window.clearTimeout(showAlert.hideTimer);
            showAlert.hideTimer = window.setTimeout(() => {
                alert.hidden = true;
            }, 4200);
        }
    };

    const getCustomer = (payload) => payload?.customer || payload?.account || payload || {};

    const getDisplayName = (customer = {}) => {
        const direct = String(customer.name || customer.customerName || '').trim();
        if (direct) return direct;
        return `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer';
    };

    const getFirstName = (displayName) => {
        const first = String(displayName || '').trim().split(/\s+/)[0] || 'Customer';
        return first.length > 18 ? `${first.slice(0, 18)}...` : first;
    };

    const getInitials = (displayName) => {
        const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return 'DF';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
    };

    const computeBalance = (history = []) => {
        return (Array.isArray(history) ? history : []).reduce((balance, entry) => {
            const amount = Number(entry?.amount);
            if (!Number.isFinite(amount)) return balance;
            const direction = String(entry?.direction || '').toLowerCase();
            const kind = String(entry?.kind || '').toLowerCase();
            const isDebit = direction === 'debit' || kind === 'charge' || kind === 'bill';
            return balance + (isDebit ? amount : -amount);
        }, 0);
    };

    const resolveEntryDirection = (entry = {}) => {
        const direction = String(entry.direction || '').trim().toLowerCase();
        if (direction === 'credit' || direction === 'debit') return direction;
        const kind = String(entry.kind || '').trim().toLowerCase();
        if (kind === 'charge' || kind === 'bill' || kind === 'debit') return 'debit';
        return 'credit';
    };

    const getEntryTimestamp = (entry = {}) => {
        const parsed = parseDate(entry.recordedAt || entry.date);
        return parsed ? parsed.getTime() : 0;
    };

    const getEntryTitle = (entry = {}, direction = 'credit') => {
        const description = String(entry.description || '').trim();
        if (description) return description;
        const kind = String(entry.kind || entry.type || '').trim().toLowerCase();
        if (kind === 'payment') return 'Payment Received';
        if (kind === 'discount') return 'Loyalty Discount';
        if (direction === 'debit') return 'Monthly Plan';
        return 'Payment Received';
    };

    const getEntryIcon = (entry = {}, direction = 'credit') => {
        const kind = String(entry.kind || entry.type || '').trim().toLowerCase();
        if (kind === 'discount') return 'fa-percent';
        if (direction === 'credit') return 'fa-check';
        return 'fa-file-lines';
    };

    const getTransactionTitle = (entry = {}, direction = 'credit') => {
        const description = String(entry.description || '').trim();
        if (description) return description;
        const kind = String(entry.kind || entry.type || '').trim().toLowerCase();
        if (kind === 'payment') return 'Payment';
        if (kind === 'discount') return 'Discount';
        if (kind === 'rebate') return 'Rebate';
        if (kind === 'bill') return 'Monthly Recurring Charge';
        if (direction === 'debit') return 'Charge';
        return 'Payment';
    };

    const getTransactionReference = (entry = {}) => {
        const reference = String(
            entry.reference
            || entry.orNumber
            || entry.xenditId
            || entry.fingerprint
            || entry.id
            || ''
        ).trim();
        return reference || '--';
    };

    const getTransactionDateValue = (entry = {}) => entry.date || entry.recordedAt || null;

    const renderTransactionHistory = (history = state.paymentHistory) => {
        const container = document.getElementById('portalTransactionList');
        if (!container) return;
        const rows = [...(Array.isArray(history) ? history : [])]
            .sort((left, right) => getEntryTimestamp(right) - getEntryTimestamp(left));

        if (!rows.length) {
            container.innerHTML = `
                <div class="portal-transaction-empty">
                    <i class="fa-solid fa-receipt"></i>
                    <strong>No transactions yet.</strong>
                    <span>Your payments and monthly charges will appear here.</span>
                </div>
            `;
            return;
        }

        const groups = [];
        rows.forEach((entry) => {
            const dateValue = getTransactionDateValue(entry);
            const heading = formatMonthHeading(dateValue);
            let group = groups.find((item) => item.heading === heading);
            if (!group) {
                group = { heading, entries: [] };
                groups.push(group);
            }
            group.entries.push(entry);
        });

        container.innerHTML = groups.map((group) => `
            <section class="portal-transaction-month">
                <h3>${escapeHtml(group.heading)}</h3>
                <div class="portal-transaction-cards">
                    ${group.entries.map((entry) => {
                        const direction = resolveEntryDirection(entry);
                        const amount = Math.abs(Number(entry.amount) || 0);
                        const isCredit = direction === 'credit';
                        const amountText = `${isCredit ? '+' : '-'}${formatCurrency(amount)}`;
                        return `
                            <article class="portal-transaction-card ${isCredit ? 'is-credit' : 'is-debit'}">
                                <span class="portal-transaction-icon">
                                    <i class="fa-solid ${isCredit ? 'fa-arrow-down' : 'fa-arrow-up'}"></i>
                                </span>
                                <div class="portal-transaction-copy">
                                    <strong>${escapeHtml(getTransactionTitle(entry, direction))}</strong>
                                    <span>${escapeHtml(formatDateTime(getTransactionDateValue(entry)))}</span>
                                    <span>Ref: ${escapeHtml(getTransactionReference(entry))}</span>
                                </div>
                                <strong class="portal-transaction-amount">${escapeHtml(amountText)}</strong>
                            </article>
                        `;
                    }).join('')}
                </div>
            </section>
        `).join('');
    };

    const setPaymentError = (message = '') => {
        const errorEl = document.getElementById('portalPaymentError');
        if (!errorEl) return;
        const text = String(message || '').trim();
        errorEl.textContent = text;
        errorEl.hidden = !text;
    };

    const setSelectedPaymentMethod = (method = 'gcash') => {
        const normalized = String(method || 'gcash').toLowerCase();
        const allowed = state.paymentMethods.includes(normalized) ? normalized : (state.paymentMethods[0] || 'gcash');
        state.paymentMethod = allowed;
        document.querySelectorAll('.portal-payment-method').forEach((button) => {
            const selected = String(button.dataset.method || '').toLowerCase() === allowed;
            button.classList.toggle('is-selected', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
            button.hidden = !state.paymentMethods.includes(String(button.dataset.method || '').toLowerCase());
        });
    };

    const setPaymentSubmitting = (submitting) => {
        const submit = document.getElementById('portalPaymentSubmit');
        if (!submit) return;
        submit.disabled = Boolean(submitting);
        submit.textContent = submitting ? 'Please wait...' : 'Pay Now';
    };

    const openPaymentModal = () => {
        if (state.amountDue <= 0) {
            showAlert('No outstanding balance right now.');
            return;
        }
        const modal = document.getElementById('portalPaymentModal');
        const input = document.getElementById('portalPaymentAmount');
        if (!modal || !input) return;
        setPaymentError('');
        setPaymentSubmitting(false);
        input.value = (Number(state.amountDue) || 0).toFixed(2);
        setSelectedPaymentMethod(state.paymentMethod);
        modal.hidden = false;
        document.body.classList.add('is-payment-modal-open');
        window.setTimeout(() => input.focus(), 50);
    };

    const closePaymentModal = () => {
        const modal = document.getElementById('portalPaymentModal');
        if (modal) modal.hidden = true;
        document.body.classList.remove('is-payment-modal-open');
        setPaymentError('');
        setPaymentSubmitting(false);
    };

    const openStatementModal = () => {
        const modal = document.getElementById('portalStatementModal');
        if (!modal) return;
        modal.hidden = false;
        document.body.classList.add('is-statement-modal-open');
    };

    const closeStatementModal = () => {
        const modal = document.getElementById('portalStatementModal');
        if (modal) modal.hidden = true;
        document.body.classList.remove('is-statement-modal-open');
    };

    const setStatementDownloadLinks = () => {
        const accountLink = document.getElementById('portalOpenAccountStatement');
        const billingLink = document.getElementById('portalOpenBillingStatement');
        if (accountLink) {
            accountLink.href = state.accountStatementUrl || '#';
            accountLink.setAttribute('download', state.accountNumber ? `account-statement-${state.accountNumber}.pdf` : '');
        }
        if (billingLink) {
            billingLink.href = state.billingStatementUrl || '#';
            billingLink.setAttribute('download', state.accountNumber ? `billing-statement-${state.accountNumber}.pdf` : '');
        }
    };

    const validateStatementLinkClick = (event) => {
        const target = String(event.currentTarget?.getAttribute('href') || '').trim();
        if (!target || target === '#') {
            event.preventDefault();
            showAlert('Statement link is not ready yet.');
            return;
        }
        closeStatementModal();
    };

    const submitPaymentModal = async () => {
        const input = document.getElementById('portalPaymentAmount');
        const amount = parseMoney(input?.value);
        if (!amount || amount <= 0) {
            setPaymentError('Enter a valid payment amount.');
            input?.focus();
            return;
        }
        setPaymentError('');
        setPaymentSubmitting(true);
        try {
            const body = {
                accountNumber: state.accountNumber,
                method: state.paymentMethod,
                amount,
                planId: state.currentPlanId,
                planName: state.currentPlanName
            };
            const response = await fetch('/api/customers/payments/ewallet', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok || !payload.checkoutUrl) {
                throw new Error(payload.error || 'Unable to create payment link.');
            }
            window.location.href = payload.checkoutUrl;
        } catch (error) {
            setPaymentError(error.message || 'Unable to create payment link.');
            setPaymentSubmitting(false);
        }
    };

    const renderHistory = (history = []) => {
        const container = document.getElementById('portalHistory');
        const toggle = document.getElementById('portalRecentToggle');
        if (!container) return;

        state.paymentHistory = Array.isArray(history) ? history : [];
        const rows = [...state.paymentHistory]
            .sort((left, right) => getEntryTimestamp(right) - getEntryTimestamp(left));
        const visibleRows = state.showingAllHistory ? rows.slice(0, 12) : rows.slice(0, 3);

        if (toggle) {
            toggle.hidden = rows.length <= 3;
            toggle.innerHTML = state.showingAllHistory
                ? 'Show Less <i class="fa-solid fa-chevron-up"></i>'
                : 'View All <i class="fa-solid fa-chevron-right"></i>';
        }

        if (!visibleRows.length) {
            container.innerHTML = '<p class="portal-empty">No transactions yet.</p>';
            renderTransactionHistory(state.paymentHistory);
            return;
        }

        container.innerHTML = visibleRows.map((entry) => {
            const direction = resolveEntryDirection(entry);
            const amount = Math.abs(Number(entry.amount) || 0);
            const kind = String(entry.kind || entry.type || '').trim().toLowerCase();
            const isDiscount = kind === 'discount';
            const rowClass = direction === 'credit' ? (isDiscount ? 'is-discount' : 'is-credit') : 'is-debit';
            const signedAmount = direction === 'credit'
                ? `-${formatCurrency(amount)}`
                : formatCurrency(amount);
            return `
                <div class="portal-history-row ${rowClass}">
                    <span class="portal-history-icon"><i class="fa-solid ${getEntryIcon(entry, direction)}"></i></span>
                    <span class="portal-history-copy">
                        <strong>${escapeHtml(getEntryTitle(entry, direction))}</strong>
                        <span>${escapeHtml(formatDateShort(entry.date || entry.recordedAt))}</span>
                    </span>
                    <span class="portal-history-amount">${escapeHtml(signedAmount)}</span>
                    <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                </div>
            `;
        }).join('');
        renderTransactionHistory(state.paymentHistory);
    };

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const normalizeNotifications = (notifications = []) => {
        if (!Array.isArray(notifications)) return [];
        return notifications
            .map((notification) => {
                const id = String(notification?.id || notification?.notificationId || '').trim();
                const title = String(notification?.title || 'Billing Notification').trim() || 'Billing Notification';
                const message = String(notification?.message || notification?.body || '').trim();
                const createdAt = notification?.createdAt || notification?.sentAt || notification?.date || '';
                const readAt = notification?.readAt || null;
                return {
                    ...notification,
                    id,
                    title,
                    message,
                    body: message,
                    tone: String(notification?.tone || notification?.data?.tone || 'info').trim().toLowerCase() || 'info',
                    source: String(notification?.source || notification?.data?.type || 'system').trim(),
                    createdAt,
                    sentAt: notification?.sentAt || createdAt,
                    readAt,
                    isRead: Boolean(notification?.isRead || readAt)
                };
            })
            .filter((notification) => notification.id || notification.message || notification.title)
            .sort((left, right) => {
                const leftTime = getEntryTimestamp({ recordedAt: left.createdAt || left.sentAt });
                const rightTime = getEntryTimestamp({ recordedAt: right.createdAt || right.sentAt });
                return rightTime - leftTime;
            });
    };

    const countUnreadNotifications = (notifications = state.notifications) =>
        (Array.isArray(notifications) ? notifications : []).filter((notification) => !notification.isRead && !notification.readAt).length;

    const updateNotificationBadge = (unreadCount = state.notificationUnreadCount) => {
        const unread = Math.max(Number(unreadCount) || 0, 0);
        state.notificationUnreadCount = unread;
        const badge = document.getElementById('portalNotificationBadge');
        if (!badge) return;
        badge.textContent = unread > 0 ? (unread > 99 ? '99+' : String(unread)) : '';
        badge.hidden = unread <= 0;
    };

    const requestNotificationApi = async (pathSuffix = '', options = {}) => {
        let lastError = null;
        for (const basePath of notificationApiBases) {
            try {
                const response = await fetch(`${basePath}${pathSuffix}`, {
                    credentials: 'include',
                    cache: 'no-store',
                    ...options
                });
                const payload = await response.json().catch(() => ({}));
                if (response.status === 401) {
                    window.location.href = '/customer-login.html';
                    throw new Error(payload.error || 'Please log in again.');
                }
                if (response.ok && payload.ok !== false) {
                    return payload;
                }
                lastError = new Error(payload.error || `Notification API returned HTTP ${response.status}.`);
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('Unable to load notifications.');
    };

    const getNotificationToneClass = (tone = '') => {
        const normalized = String(tone || '').toLowerCase();
        if (['success', 'paid', 'payment'].includes(normalized)) return 'is-success';
        if (['warning', 'due', 'reminder'].includes(normalized)) return 'is-warning';
        if (['danger', 'error', 'overdue', 'disabled'].includes(normalized)) return 'is-danger';
        return 'is-info';
    };

    const getNotificationIcon = (notification = {}) => {
        const source = String(notification.source || '').toLowerCase();
        const title = String(notification.title || '').toLowerCase();
        const message = String(notification.message || '').toLowerCase();
        if (source.includes('payment') || title.includes('payment') || message.includes('payment')) return 'fa-receipt';
        if (title.includes('ticket') || message.includes('ticket') || source.includes('ticket')) return 'fa-ticket';
        if (title.includes('due') || message.includes('due') || title.includes('bill')) return 'fa-calendar-day';
        if (title.includes('support') || source.includes('support')) return 'fa-headset';
        return 'fa-bell';
    };

    const formatNotificationSource = (source = '') => {
        const text = String(source || '').trim();
        if (!text) return 'System';
        return text
            .replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    };

    const setNotificationReadAllState = () => {
        const button = document.getElementById('portalNotificationReadAll');
        if (!button) return;
        const hasUnread = state.notificationUnreadCount > 0;
        button.disabled = !hasUnread;
        button.textContent = hasUnread ? 'Read All' : 'All Read';
    };

    const renderNotifications = (notifications = state.notifications, { loading = false } = {}) => {
        const container = document.getElementById('portalNotificationList');
        if (!container) return;
        const rows = normalizeNotifications(notifications);
        state.notifications = rows;
        state.notificationTotalCount = rows.length;
        setNotificationReadAllState();

        if (loading) {
            container.innerHTML = `
                <div class="portal-notification-empty">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    <strong>Loading notifications</strong>
                    <span>Please wait while we refresh your inbox.</span>
                </div>
            `;
            return;
        }

        if (!rows.length) {
            container.innerHTML = `
                <div class="portal-notification-empty">
                    <i class="fa-solid fa-bell"></i>
                    <strong>No notifications yet</strong>
                    <span>Billing updates and reminders will appear here.</span>
                </div>
            `;
            return;
        }

        container.innerHTML = rows.map((notification) => {
            const isRead = Boolean(notification.isRead || notification.readAt);
            const toneClass = getNotificationToneClass(notification.tone);
            const source = formatNotificationSource(notification.source);
            const dateValue = notification.createdAt || notification.sentAt || notification.date;
            return `
                <button type="button" class="portal-notification-card ${toneClass} ${isRead ? 'is-read' : 'is-unread'}" data-notification-id="${escapeHtml(notification.id)}">
                    <span class="portal-notification-icon">
                        <i class="fa-solid ${escapeHtml(getNotificationIcon(notification))}"></i>
                    </span>
                    <span class="portal-notification-copy">
                        <strong>${escapeHtml(notification.title)}</strong>
                        <span>${escapeHtml(notification.message || notification.body || '')}</span>
                        <em>${escapeHtml(source)} - ${escapeHtml(formatDateTime(dateValue))}</em>
                    </span>
                    <i class="portal-notification-unread-dot" aria-hidden="true"></i>
                </button>
            `;
        }).join('');
    };

    const loadNotifications = async () => {
        const hasCachedNotifications = state.notifications.length > 0;
        renderNotifications(state.notifications, { loading: !hasCachedNotifications });
        try {
            const payload = await requestNotificationApi('?limit=50&includeRead=true');
            const notifications = normalizeNotifications(payload.notifications || []);
            state.notifications = notifications;
            state.notificationTotalCount = Number(payload.totalCount ?? notifications.length) || notifications.length;
            updateNotificationBadge(Number(payload.unreadCount ?? countUnreadNotifications(notifications)) || 0);
            renderNotifications(notifications);
        } catch (error) {
            renderNotifications(state.notifications);
            if (!hasCachedNotifications) {
                const container = document.getElementById('portalNotificationList');
                if (container) {
                    container.innerHTML = `
                        <div class="portal-notification-empty">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                            <strong>Unable to load notifications</strong>
                            <span>${escapeHtml(error.message || 'Please try again later.')}</span>
                        </div>
                    `;
                }
            }
        }
    };

    const markNotificationRead = async (notificationId = '') => {
        const id = String(notificationId || '').trim();
        if (!id) return;
        const current = state.notifications.find((notification) => notification.id === id);
        if (!current || current.isRead || current.readAt) return;

        const readAt = new Date().toISOString();
        state.notifications = state.notifications.map((notification) =>
            notification.id === id ? { ...notification, isRead: true, readAt } : notification
        );
        updateNotificationBadge(countUnreadNotifications(state.notifications));
        renderNotifications(state.notifications);

        try {
            const payload = await requestNotificationApi(`/${encodeURIComponent(id)}/read`, {
                method: 'POST'
            });
            if (payload.notification) {
                state.notifications = state.notifications.map((notification) =>
                    notification.id === id ? normalizeNotifications([payload.notification])[0] : notification
                ).filter(Boolean);
            }
            updateNotificationBadge(Number(payload.unreadCount ?? countUnreadNotifications(state.notifications)) || 0);
            renderNotifications(state.notifications);
        } catch {
            // Keep the local read state. The next refresh will reconcile it with the server.
        }
    };

    const markAllNotificationsRead = async () => {
        if (state.notificationUnreadCount <= 0) return;
        const button = document.getElementById('portalNotificationReadAll');
        if (button) {
            button.disabled = true;
            button.textContent = 'Reading...';
        }
        const readAt = new Date().toISOString();
        state.notifications = state.notifications.map((notification) => ({
            ...notification,
            isRead: true,
            readAt: notification.readAt || readAt
        }));
        updateNotificationBadge(0);
        renderNotifications(state.notifications);

        try {
            const payload = await requestNotificationApi('/read-all', {
                method: 'POST'
            });
            updateNotificationBadge(Number(payload.unreadCount ?? 0) || 0);
        } catch {
            showAlert('Notifications were updated on this device. Server sync will retry on refresh.');
        } finally {
            renderNotifications(state.notifications);
        }
    };

    const modemText = (value, fallback = '--') => {
        const text = String(value || '').trim();
        return text || fallback;
    };

    const getWifiClients = (modem = {}) => {
        const rows = Array.isArray(modem.connectedDevices)
            ? modem.connectedDevices
            : [
                ...(Array.isArray(modem.wifi24Clients) ? modem.wifi24Clients.map((client) => ({ ...client, band: '2.4G' })) : []),
                ...(Array.isArray(modem.wifi5Clients) ? modem.wifi5Clients.map((client) => ({ ...client, band: '5G' })) : []),
                ...(Array.isArray(modem.wifiLanClients) ? modem.wifiLanClients : [])
            ];
        const seen = new Set();
        return rows.filter((client, index) => {
            const key = [
                client?.macAddress,
                client?.ipAddress,
                client?.hostname
            ].map((value) => String(value || '').trim().toLowerCase()).join('|') || `row:${index}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return Boolean(client?.macAddress || client?.ipAddress || client?.hostname);
        });
    };

    const setWifiLoading = (loading) => {
        const loadingEl = document.getElementById('portalWifiLoading');
        const supportedEl = document.getElementById('portalWifiSupported');
        const unsupportedEl = document.getElementById('portalWifiUnsupported');
        if (loadingEl) loadingEl.hidden = !loading;
        if (loading) {
            if (supportedEl) supportedEl.hidden = true;
            if (unsupportedEl) unsupportedEl.hidden = true;
        }
    };

    const renderWifiUnsupported = (message = '') => {
        setWifiLoading(false);
        const supportedEl = document.getElementById('portalWifiSupported');
        const unsupportedEl = document.getElementById('portalWifiUnsupported');
        const messageEl = document.getElementById('portalWifiUnsupportedMessage');
        if (supportedEl) supportedEl.hidden = true;
        if (unsupportedEl) unsupportedEl.hidden = false;
        if (messageEl) {
            messageEl.textContent = message || 'Your ONU is not yet registered or bound to our system. Please contact your administrator or technical support for proper ONU configuration and activation.';
        }
    };

    const renderWifiDevices = (modem = {}) => {
        const title = document.getElementById('portalWifiDevicesTitle');
        const list = document.getElementById('portalWifiDeviceList');
        if (!list) return;
        const clients = getWifiClients(modem);
        const onlineCount = Number.isFinite(Number(modem.wifiTotalOnlineCount))
            ? Number(modem.wifiTotalOnlineCount)
            : clients.filter((client) => Boolean(client.online)).length;
        const totalCount = Math.max(clients.length, Math.max(Number(onlineCount) || 0, 0));
        if (title) title.textContent = `Connected Devices (${onlineCount} Online / ${totalCount} Total)`;

        if (!clients.length) {
            list.innerHTML = `
                <div class="portal-wifi-device-empty">
                    <i class="fa-solid fa-desktop"></i>
                    <span>No connected devices detected</span>
                </div>
            `;
            return;
        }

        list.innerHTML = clients.map((client) => {
            const name = modemText(client.hostname || client.macAddress || client.ipAddress, 'Unknown device');
            const detail = [client.macAddress, client.ipAddress].map((value) => modemText(value)).filter((value) => value !== '--').join(' - ');
            const band = modemText(client.band, 'LAN');
            const isOnline = Boolean(client.online);
            return `
                <article class="portal-wifi-device-card ${isOnline ? 'is-online' : 'is-offline'}">
                    <span class="portal-wifi-device-icon">
                        <i class="fa-solid fa-computer"></i>
                    </span>
                    <div class="portal-wifi-device-copy">
                        <strong>${escapeHtml(name)}</strong>
                        <span>${escapeHtml(detail || 'Device information unavailable')}</span>
                    </div>
                    <div class="portal-wifi-device-state">
                        <em>${escapeHtml(band)}</em>
                        <span><i></i>${isOnline ? 'Online' : 'Offline'}</span>
                    </div>
                </article>
            `;
        }).join('');
    };

    const renderWifiSupported = (modem = {}) => {
        state.wifiModem = modem || {};
        setWifiLoading(false);
        const supportedEl = document.getElementById('portalWifiSupported');
        const unsupportedEl = document.getElementById('portalWifiUnsupported');
        if (supportedEl) supportedEl.hidden = false;
        if (unsupportedEl) unsupportedEl.hidden = true;
        setText('portalWifiManufacturer', modemText(modem.manufacturer));
        setText('portalWifiModel', modemText(modem.model));
        setText('portalWifiSerial', modemText(modem.serialNumber));
        setText('portalWifi24Name', modemText(modem.ssid24, 'Not available'));
        setText('portalWifi5Name', modemText(modem.ssid5, 'Not available'));
        renderWifiDevices(modem);
    };

    const loadWifiSettings = async (options = {}) => {
        const silentError = options?.silentError === true;
        if (!state.wifiLoaded) setWifiLoading(true);
        try {
            const response = await fetch('/api/customers/me/modem', {
                credentials: 'include',
                cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (response.status === 401) {
                window.location.href = '/customer-login.html';
                return;
            }
            if (!response.ok || !payload.ok) {
                throw new Error(payload.error || 'Unable to load WiFi settings.');
            }
            state.wifiLoaded = true;
            state.wifiStatusMessage = payload.error || '';
            if (payload.supported && payload.modem) {
                renderWifiSupported(payload.modem);
            } else {
                state.wifiModem = null;
                renderWifiUnsupported(payload.error);
            }
        } catch (error) {
            state.wifiLoaded = true;
            if (silentError) return;
            state.wifiModem = null;
            renderWifiUnsupported(error.message || 'Unable to load WiFi settings.');
        }
    };

    const setWifiError = (message = '') => {
        const errorEl = document.getElementById('portalWifiError');
        if (!errorEl) return;
        const text = String(message || '').trim();
        errorEl.textContent = text;
        errorEl.hidden = !text;
    };

    const setWifiSubmitting = (submitting) => {
        const submit = document.getElementById('portalWifiSubmit');
        if (!submit) return;
        submit.disabled = Boolean(submitting);
        submit.textContent = submitting ? 'Saving...' : 'Save Changes';
    };

    const openWifiModal = () => {
        if (!state.wifiModem) {
            showAlert('No modem is bound to this account yet.');
            return;
        }
        const modal = document.getElementById('portalWifiModal');
        if (!modal) return;
        const wifi24Ssid = document.getElementById('portalWifi24Ssid');
        const wifi5Ssid = document.getElementById('portalWifi5Ssid');
        const wifi24Password = document.getElementById('portalWifi24Password');
        const wifi5Password = document.getElementById('portalWifi5Password');
        if (wifi24Ssid) wifi24Ssid.value = state.wifiModem.ssid24 || '';
        if (wifi5Ssid) wifi5Ssid.value = state.wifiModem.ssid5 || '';
        if (wifi24Password) wifi24Password.value = '';
        if (wifi5Password) wifi5Password.value = '';
        setWifiError('');
        setWifiSubmitting(false);
        modal.hidden = false;
        document.body.classList.add('is-wifi-modal-open');
        window.setTimeout(() => wifi24Ssid?.focus(), 50);
    };

    const closeWifiModal = () => {
        const modal = document.getElementById('portalWifiModal');
        if (modal) modal.hidden = true;
        document.body.classList.remove('is-wifi-modal-open');
        setWifiError('');
        setWifiSubmitting(false);
    };

    const submitWifiSettings = async () => {
        const modem = state.wifiModem || {};
        const wifi24Ssid = String(document.getElementById('portalWifi24Ssid')?.value || '').trim();
        const wifi24Password = String(document.getElementById('portalWifi24Password')?.value || '').trim();
        const wifi5Ssid = String(document.getElementById('portalWifi5Ssid')?.value || '').trim();
        const wifi5Password = String(document.getElementById('portalWifi5Password')?.value || '').trim();

        const hasChange = wifi24Ssid !== String(modem.ssid24 || '').trim()
            || wifi5Ssid !== String(modem.ssid5 || '').trim()
            || Boolean(wifi24Password || wifi5Password);
        if (!hasChange) {
            setWifiError('Enter a new WiFi name or password first.');
            return;
        }
        setWifiError('');
        setWifiSubmitting(true);
        try {
            const response = await fetch('/api/customers/me/modem/wifi-password', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    wifi24: {
                        ssid: wifi24Ssid,
                        password: wifi24Password,
                        currentSsid: modem.ssid24 || ''
                    },
                    wifi5: {
                        ssid: wifi5Ssid,
                        password: wifi5Password,
                        currentSsid: modem.ssid5 || ''
                    }
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) {
                throw new Error(payload.error || 'Unable to change WiFi settings.');
            }
            closeWifiModal();
            showAlert(payload.message || 'WiFi settings change was sent to the modem.');
            window.setTimeout(() => loadWifiSettings({ silentError: true }), 3000);
        } catch (error) {
            setWifiError(error.message || 'Unable to change WiFi settings.');
        } finally {
            setWifiSubmitting(false);
        }
    };

    const setSupportMessage = (message = '', tone = 'info') => {
        const messageEl = document.getElementById('portalSupportMessage');
        if (!messageEl) return;
        const text = String(message || '').trim();
        messageEl.textContent = text;
        messageEl.hidden = !text;
        messageEl.classList.toggle('is-success', tone === 'success');
        messageEl.classList.toggle('is-error', tone === 'error');
    };

    const setSupportSubmitting = (submitting) => {
        const submit = document.getElementById('portalSupportSubmit');
        if (!submit) return;
        submit.disabled = Boolean(submitting);
        submit.innerHTML = submitting
            ? '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...'
            : '<i class="fa-solid fa-paper-plane"></i> Submit Ticket';
    };

    const renderSupportCategories = (categories = state.ticketCategories) => {
        const select = document.getElementById('portalSupportIssue');
        if (!select) return;
        const list = (Array.isArray(categories) ? categories : [])
            .map((item) => String(item?.label || item?.value || item || '').trim())
            .filter(Boolean);
        if (!list.length) return;
        const selected = select.value || list[0];
        state.ticketCategories = list;
        select.innerHTML = list
            .map((label) => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`)
            .join('');
        select.value = list.includes(selected) ? selected : list[0];
    };

    const formatTicketStatus = (value) => {
        const raw = String(value || 'open').trim().toLowerCase();
        if (raw === 'in-progress') return 'In Progress';
        if (raw === 'resolved') return 'Resolved';
        if (raw === 'closed') return 'Closed';
        return raw ? raw.replace(/\b\w/g, (char) => char.toUpperCase()) : 'Open';
    };

    const renderTickets = (tickets = state.tickets) => {
        const container = document.getElementById('portalTicketList');
        if (!container) return;
        const rows = (Array.isArray(tickets) ? tickets : [])
            .slice()
            .sort((left, right) => getEntryTimestamp({ recordedAt: right.updatedAt || right.createdAt })
                - getEntryTimestamp({ recordedAt: left.updatedAt || left.createdAt }));
        state.tickets = rows;
        if (!rows.length) {
            container.innerHTML = `
                <div class="portal-ticket-empty">
                    <i class="fa-solid fa-ticket"></i>
                    <span>No active tickets</span>
                </div>
            `;
            return;
        }
        container.innerHTML = rows.map((ticket) => {
            const status = formatTicketStatus(ticket.status);
            const description = String(ticket.description || '').trim();
            return `
                <article class="portal-ticket-card">
                    <div class="portal-ticket-card__top">
                        <span class="portal-ticket-icon"><i class="fa-solid fa-ticket"></i></span>
                        <div class="portal-ticket-main">
                            <strong>${escapeHtml(ticket.subject || ticket.category || 'Support Ticket')}</strong>
                            <span>${escapeHtml(ticket.ticketNumber || `Ticket #${ticket.id || '--'}`)}</span>
                        </div>
                        <em class="portal-ticket-status">${escapeHtml(status)}</em>
                    </div>
                    ${description ? `<p>${escapeHtml(description)}</p>` : ''}
                    <div class="portal-ticket-meta">
                        <span><i class="fa-regular fa-clock"></i>${escapeHtml(formatDateShort(ticket.updatedAt || ticket.createdAt))}</span>
                        <span><i class="fa-solid fa-circle-info"></i>${escapeHtml(status)}</span>
                    </div>
                </article>
            `;
        }).join('');
    };

    const loadSupportCategories = async () => {
        try {
            const response = await fetch('/api/tickets/categories', { credentials: 'include', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (response.ok && payload.ok && Array.isArray(payload.categories)) {
                renderSupportCategories(payload.categories);
            }
        } catch {
            renderSupportCategories();
        }
    };

    const loadMyTickets = async () => {
        try {
            const response = await fetch('/api/tickets/my', { credentials: 'include', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) {
                throw new Error(payload.error || 'Unable to load tickets.');
            }
            renderTickets(payload.openTickets || payload.tickets || []);
        } catch (error) {
            renderTickets([]);
            setSupportMessage(error.message || 'Unable to load tickets.', 'error');
        }
    };

    const submitSupportTicket = async () => {
        const issue = String(document.getElementById('portalSupportIssue')?.value || '').trim();
        const descriptionEl = document.getElementById('portalSupportDescription');
        const description = String(descriptionEl?.value || '').trim();
        if (!issue) {
            setSupportMessage('Select an issue first.', 'error');
            return;
        }
        if (!state.accountNumber) {
            setSupportMessage('Account number is missing. Please reload your portal.', 'error');
            return;
        }
        setSupportMessage('');
        setSupportSubmitting(true);
        try {
            const response = await fetch('/api/tickets/submit', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subject: issue,
                    category: issue,
                    description,
                    accountNumber: state.accountNumber,
                    customerName: state.customerName,
                    contact: state.customerContact
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok) {
                throw new Error(payload.error || 'Unable to submit ticket.');
            }
            if (descriptionEl) descriptionEl.value = '';
            setSupportMessage('Ticket submitted successfully.', 'success');
            const nextTickets = [payload.ticket, ...state.tickets].filter(Boolean);
            renderTickets(nextTickets);
            loadMyTickets();
        } catch (error) {
            setSupportMessage(error.message || 'Unable to submit ticket.', 'error');
        } finally {
            setSupportSubmitting(false);
        }
    };

    const setMenuOpen = (open) => {
        const menu = document.getElementById('portalAccountMenu');
        const menuBtn = document.getElementById('portalMenuBtn');
        const accountBtn = document.getElementById('portalAccountBtn');
        if (!menu) return;
        menu.hidden = !open;
        menuBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
        accountBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    const toggleMenu = () => {
        const menu = document.getElementById('portalAccountMenu');
        setMenuOpen(Boolean(menu?.hidden));
    };

    const normalizeStatus = (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'disabled') return 'disabled';
        if (raw === 'inactive' || raw === 'force-inactive') return 'inactive';
        return 'active';
    };

    const applyStatus = (statusValue, amountDue) => {
        const normalized = normalizeStatus(statusValue);
        const card = document.getElementById('portalConnectionCard');
        const statusPill = document.getElementById('portalStatus');
        card?.classList.remove('is-active', 'is-warning', 'is-inactive');
        statusPill?.classList.remove('is-active', 'is-warning', 'is-inactive');

        const setStatusPill = (label, className) => {
            if (!statusPill) return;
            statusPill.classList.add(className);
            statusPill.innerHTML = `${escapeHtml(label)} <i></i>`;
        };

        if (normalized === 'disabled') {
            card?.classList.add('is-warning');
            setStatusPill('Disabled', 'is-warning');
            setText('portalStatusHeadline', 'Internet is Disabled');
            setText('portalStatusHint', 'Your account is currently disabled.');
            return;
        }
        if (normalized === 'inactive') {
            card?.classList.add('is-inactive');
            setStatusPill('Inactive', 'is-inactive');
            setText('portalStatusHeadline', 'Internet is Inactive');
            setText('portalStatusHint', 'Please contact support for assistance.');
            return;
        }

        card?.classList.add('is-active');
        setStatusPill('Active', 'is-active');
        setText('portalStatusHeadline', 'Internet is Active');
        setText(
            'portalStatusHint',
            Number(amountDue) > 0 ? 'Connection is active. Balance is due.' : 'Everything looks good.'
        );
    };

    const applyBalance = (amountDue, nextDue) => {
        const balanceCard = document.getElementById('portalBalanceCard');
        const balanceCheck = document.getElementById('portalBalanceCheck');
        const dueText = formatDueCountdown(nextDue, amountDue);
        balanceCard?.classList.remove('is-paid', 'is-due', 'is-overdue', 'is-advance');

        setText('portalAmountDue', formatCurrency(amountDue));
        setText('portalDueCountdown', dueText);

        if (Number(amountDue) <= 0) {
            balanceCard?.classList.add('is-paid');
            setText('portalBalanceHelper', "You're all set!");
            if (balanceCheck) balanceCheck.innerHTML = '<i class="fa-solid fa-check"></i>';
            return;
        }

        const days = getDaysUntil(nextDue);
        const overdue = Number.isFinite(days) && days < 0;
        balanceCard?.classList.add(overdue ? 'is-overdue' : 'is-due');
        setText('portalBalanceHelper', overdue ? 'Payment is overdue' : 'Payment due');
        if (balanceCheck) balanceCheck.innerHTML = '<i class="fa-solid fa-exclamation"></i>';
    };

    const buildPlanSpeedText = (customer = {}, currentPlan = null) => {
        const candidates = [
            customer.planSpeed,
            customer.speed,
            currentPlan?.description,
            currentPlan?.profile,
            customer.planName
        ].map((value) => String(value || '').trim()).filter(Boolean);
        const source = candidates[0] || '';
        const speedMatch = source.match(/(\d+(?:\.\d+)?)\s*(mbps|gbps)/i);
        if (speedMatch) {
            return `${speedMatch[1]} ${speedMatch[2].toUpperCase()} plan`;
        }
        return customer.planBilling || 'Monthly billing';
    };

    const cleanPlanName = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return 'Not set';
        return raw
            .replace(/\s*[-–—]\s*(?:[\u20b1?]|PHP)?\s*[\d,]+(?:\.\d+)?\s*$/i, '')
            .replace(/\s{2,}/g, ' ')
            .trim() || raw;
    };

    const loadBusinessProfile = async () => {
        try {
            const response = await fetch('/api/business-profile', { cache: 'no-store' });
            if (!response.ok) return;
            const profile = await response.json();
            const name = String(profile?.businessName || '').trim();
            const supportEmail = String(profile?.supportEmail || profile?.email || '').trim();
            if (supportEmail) state.supportEmail = supportEmail;
            if (name) {
                document.title = `Customer Portal - ${name}`;
                setText('portalBusinessName', name);
            }
            if (profile?.logoUrl) {
                const logo = document.getElementById('portalLogo');
                if (logo) logo.src = profile.logoUrl;
            }
        } catch {
            // Keep defaults.
        }
    };

    const loadPortal = async () => {
        try {
            const response = await fetch('/api/customers/me', { credentials: 'include', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (response.status === 401) {
                window.location.href = '/customer-login.html';
                return;
            }
            if (!response.ok || !payload.ok) throw new Error(payload.error || 'Unable to load customer portal.');

            const customer = getCustomer(payload);
            const currentPlan = customer.currentPlan || payload.currentPlan || {};
            const accountNumber = String(customer.accountNumber || payload.accountNumber || '').trim();
            const fullName = getDisplayName(customer);
            const summary = customer.paymentSummary || payload.paymentSummary || {};
            const paymentHistory = customer.paymentHistory || payload.paymentHistory || [];
            const amountDue = customer.amountDue
                ?? payload.amountDue
                ?? Math.max(Number(summary.balance ?? computeBalance(paymentHistory)) || 0, 0);
            const nextDue = customer.nextDue || payload.nextDue || customer.dueDate;
            const rawPlanName = customer.planName || currentPlan?.name || 'Not set';
            const planName = cleanPlanName(rawPlanName);
            const planCategory = customer.planCategory || payload.planCategory || customer.paymentMode || payload.paymentMode || 'Postpaid';

            state.accountNumber = accountNumber;
            state.amountDue = Number(amountDue) || 0;
            state.customerName = fullName;
            state.customerContact = String(customer.mobileRaw || customer.mobile || customer.email || '').trim();
            state.currentPlanId = String(currentPlan?.id || customer.planId || '').trim();
            state.currentPlanName = planName;
            state.paymentMode = String(customer.paymentMode || payload.paymentMode || planCategory || 'postpaid').toLowerCase();
            state.paymentMethods = Array.isArray(customer.paymentMethods || payload.paymentMethods)
                ? (customer.paymentMethods || payload.paymentMethods)
                    .map((method) => String(method || '').toLowerCase())
                    .filter(Boolean)
                : ['gcash', 'paymaya', 'grabpay', 'shopeepay'];
            if (!state.paymentMethods.length) state.paymentMethods = ['gcash', 'paymaya', 'grabpay', 'shopeepay'];

            setText('portalGreetingName', getFirstName(fullName));
            setText('portalAvatarInitials', getInitials(fullName));
            setText('portalCustomerName', fullName);
            setText('portalAccountMeta', accountNumber ? `Account # ${accountNumber}` : 'Customer account');
            setText('portalAccountNumber', accountNumber || '--');
            setText('portalNextDue', formatDate(nextDue));
            setText('portalPlanType', String(planCategory).toUpperCase());
            setText('portalPlanName', planName);
            setText('portalPlanNameDetail', planName);
            setText('portalPlanSpeed', buildPlanSpeedText(customer, currentPlan));
            setText('portalPlanAmount', formatCurrency(customer.planAmount || currentPlan?.price || 0));
            setText('portalBillingCycle', customer.planBilling || 'Monthly');
            setText('portalArea', customer.area || 'Not set');

            applyStatus(customer.status || payload.status || 'active', state.amountDue);
            applyBalance(state.amountDue, nextDue);

            const encodedAccount = encodeURIComponent(accountNumber);
            const accountStatementUrl = `/api/statements/account/${encodedAccount}/pdf`;
            const billingStatementUrl = `/api/statements/billing/${encodedAccount}/pdf`;
            state.accountStatementUrl = accountStatementUrl;
            state.billingStatementUrl = billingStatementUrl;

            const accountStatement = document.getElementById('portalAccountStatement');
            const bottomBilling = document.getElementById('portalBottomBilling');
            if (accountStatement) accountStatement.href = accountStatementUrl;
            if (bottomBilling) bottomBilling.href = billingStatementUrl;
            setStatementDownloadLinks();

            state.notifications = normalizeNotifications(payload.notifications || customer.notifications || []);
            state.notificationTotalCount = Number(payload.notificationTotalCount ?? customer.notificationTotalCount ?? state.notifications.length) || state.notifications.length;
            const unread = Number(payload.notificationUnreadCount ?? customer.notificationUnreadCount ?? countUnreadNotifications(state.notifications)) || 0;
            updateNotificationBadge(unread);
            renderNotifications(state.notifications);

            renderHistory(paymentHistory);
        } catch (error) {
            showAlert(error.message || 'Unable to load customer portal.', { autoHide: false });
        }
    };

    document.getElementById('portalLogoutBtn')?.addEventListener('click', async () => {
        try {
            await fetch('/api/customers/logout', {
                method: 'POST',
                credentials: 'include'
            });
        } finally {
            window.location.href = '/customer-login.html';
        }
    });

    document.getElementById('portalMenuBtn')?.addEventListener('click', toggleMenu);
    document.getElementById('portalAccountBtn')?.addEventListener('click', toggleMenu);
    document.getElementById('portalBottomAccount')?.addEventListener('click', toggleMenu);

    document.addEventListener('click', (event) => {
        const menu = document.getElementById('portalAccountMenu');
        if (!menu || menu.hidden) return;
        const clickedInside = menu.contains(event.target)
            || document.getElementById('portalMenuBtn')?.contains(event.target)
            || document.getElementById('portalAccountBtn')?.contains(event.target)
            || document.getElementById('portalBottomAccount')?.contains(event.target);
        if (!clickedInside) setMenuOpen(false);
    });

    document.getElementById('portalRecentToggle')?.addEventListener('click', () => {
        state.showingAllHistory = !state.showingAllHistory;
        renderHistory(state.paymentHistory);
    });

    document.getElementById('portalPayBillAction')?.addEventListener('click', () => {
        openPaymentModal();
    });

    const openTransactionView = () => {
        renderTransactionHistory(state.paymentHistory);
        document.body.classList.remove('is-support-view', 'is-notification-view', 'is-wifi-view');
        document.body.classList.add('is-transaction-view');
        const supportScreen = document.getElementById('portalSupportScreen');
        if (supportScreen) supportScreen.hidden = true;
        const notificationScreen = document.getElementById('portalNotificationScreen');
        if (notificationScreen) notificationScreen.hidden = true;
        const wifiScreen = document.getElementById('portalWifiScreen');
        if (wifiScreen) wifiScreen.hidden = true;
        const screen = document.getElementById('portalTransactionScreen');
        if (screen) screen.hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const closeTransactionView = () => {
        document.body.classList.remove('is-transaction-view');
        const screen = document.getElementById('portalTransactionScreen');
        if (screen) screen.hidden = true;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const openSupportView = () => {
        document.body.classList.remove('is-transaction-view', 'is-notification-view', 'is-wifi-view');
        document.body.classList.add('is-support-view');
        const transactionScreen = document.getElementById('portalTransactionScreen');
        if (transactionScreen) transactionScreen.hidden = true;
        const notificationScreen = document.getElementById('portalNotificationScreen');
        if (notificationScreen) notificationScreen.hidden = true;
        const wifiScreen = document.getElementById('portalWifiScreen');
        if (wifiScreen) wifiScreen.hidden = true;
        const screen = document.getElementById('portalSupportScreen');
        if (screen) screen.hidden = false;
        setSupportMessage('');
        renderSupportCategories();
        renderTickets(state.tickets);
        loadSupportCategories();
        loadMyTickets();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const closeSupportView = () => {
        document.body.classList.remove('is-support-view');
        const screen = document.getElementById('portalSupportScreen');
        if (screen) screen.hidden = true;
        setSupportMessage('');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const openWifiView = () => {
        setMenuOpen(false);
        document.body.classList.remove('is-transaction-view', 'is-support-view', 'is-notification-view');
        document.body.classList.add('is-wifi-view');
        const transactionScreen = document.getElementById('portalTransactionScreen');
        if (transactionScreen) transactionScreen.hidden = true;
        const supportScreen = document.getElementById('portalSupportScreen');
        if (supportScreen) supportScreen.hidden = true;
        const notificationScreen = document.getElementById('portalNotificationScreen');
        if (notificationScreen) notificationScreen.hidden = true;
        const screen = document.getElementById('portalWifiScreen');
        if (screen) screen.hidden = false;
        if (state.wifiModem) {
            renderWifiSupported(state.wifiModem);
        } else if (state.wifiLoaded) {
            renderWifiUnsupported(state.wifiStatusMessage);
        } else {
            setWifiLoading(true);
        }
        loadWifiSettings();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const closeWifiView = () => {
        document.body.classList.remove('is-wifi-view');
        const screen = document.getElementById('portalWifiScreen');
        if (screen) screen.hidden = true;
        closeWifiModal();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const openNotificationView = () => {
        setMenuOpen(false);
        document.body.classList.remove('is-transaction-view', 'is-support-view', 'is-wifi-view');
        document.body.classList.add('is-notification-view');
        const transactionScreen = document.getElementById('portalTransactionScreen');
        if (transactionScreen) transactionScreen.hidden = true;
        const supportScreen = document.getElementById('portalSupportScreen');
        if (supportScreen) supportScreen.hidden = true;
        const wifiScreen = document.getElementById('portalWifiScreen');
        if (wifiScreen) wifiScreen.hidden = true;
        const screen = document.getElementById('portalNotificationScreen');
        if (screen) screen.hidden = false;
        renderNotifications(state.notifications);
        loadNotifications();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const closeNotificationView = () => {
        document.body.classList.remove('is-notification-view');
        const screen = document.getElementById('portalNotificationScreen');
        if (screen) screen.hidden = true;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    document.getElementById('portalPaymentsAction')?.addEventListener('click', () => {
        openTransactionView();
    });

    document.getElementById('portalTransactionBack')?.addEventListener('click', closeTransactionView);

    document.getElementById('portalPaymentMethodGrid')?.addEventListener('click', (event) => {
        const methodButton = event.target.closest('.portal-payment-method');
        if (!methodButton) return;
        setSelectedPaymentMethod(methodButton.dataset.method || 'gcash');
    });

    document.getElementById('portalPaymentForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        submitPaymentModal();
    });

    document.querySelectorAll('[data-payment-close]').forEach((button) => {
        button.addEventListener('click', closePaymentModal);
    });

    document.getElementById('portalBillingStatement')?.addEventListener('click', (event) => {
        event.preventDefault();
        openStatementModal();
    });

    document.getElementById('portalOpenAccountStatement')?.addEventListener('click', validateStatementLinkClick);
    document.getElementById('portalOpenBillingStatement')?.addEventListener('click', validateStatementLinkClick);

    document.querySelectorAll('[data-statement-close]').forEach((button) => {
        button.addEventListener('click', closeStatementModal);
    });

    document.addEventListener('keydown', (event) => {
        const paymentModal = document.getElementById('portalPaymentModal');
        const statementModal = document.getElementById('portalStatementModal');
        if (event.key === 'Escape' && paymentModal && !paymentModal.hidden) {
            closePaymentModal();
        }
        if (event.key === 'Escape' && statementModal && !statementModal.hidden) {
            closeStatementModal();
        }
        if (event.key === 'Escape' && document.body.classList.contains('is-notification-view')) {
            closeNotificationView();
        }
        if (event.key === 'Escape' && document.body.classList.contains('is-wifi-view')) {
            closeWifiView();
        }
    });

    document.getElementById('portalSupportAction')?.addEventListener('click', openSupportView);
    document.getElementById('portalSupportBack')?.addEventListener('click', closeSupportView);
    document.getElementById('portalSupportForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        submitSupportTicket();
    });

    document.getElementById('portalUsageAction')?.addEventListener('click', openWifiView);
    document.getElementById('portalWifiBack')?.addEventListener('click', closeWifiView);
    document.getElementById('portalWifiChangeBtn')?.addEventListener('click', openWifiModal);
    document.getElementById('portalWifiContactSupport')?.addEventListener('click', openSupportView);
    document.getElementById('portalWifiForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        submitWifiSettings();
    });
    document.querySelectorAll('[data-wifi-close]').forEach((button) => {
        button.addEventListener('click', closeWifiModal);
    });

    document.getElementById('portalNotificationBack')?.addEventListener('click', closeNotificationView);
    document.getElementById('portalNotificationReadAll')?.addEventListener('click', markAllNotificationsRead);

    document.getElementById('portalNotificationList')?.addEventListener('click', (event) => {
        const card = event.target.closest('[data-notification-id]');
        if (!card) return;
        markNotificationRead(card.dataset.notificationId);
    });

    document.getElementById('portalBottomNotifications')?.addEventListener('click', openNotificationView);
    document.getElementById('portalNotificationsBtn')?.addEventListener('click', openNotificationView);

    loadBusinessProfile();
    loadPortal();
})();
