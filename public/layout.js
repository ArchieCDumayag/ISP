(() => {
    if (typeof document === 'undefined') return;
    const head = document.head || document.getElementsByTagName('head')[0];
    if (!head) return;
    let viewport = head.querySelector('meta[name="viewport"]');
    if (!viewport) {
        viewport = document.createElement('meta');
        viewport.setAttribute('name', 'viewport');
        viewport.setAttribute('content', 'width=device-width, initial-scale=1');
        head.appendChild(viewport);
    }
})();

let detachTopbarInteractions = null;

const normalizeFlavorIdentity = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const detectDanteFlavorFromLocation = () => {
    const port = String(window.location.port || '').trim();
    return port === '3000';
};

const applyFlavorMetadata = (payload = {}) => {
    const activeFlavor = String(payload.activeFlavor || '').trim();
    const normalizedFlavor = normalizeFlavorIdentity(activeFlavor);
    const isDanteFlavor = typeof payload.isDanteFlavor === 'boolean'
        ? payload.isDanteFlavor
        : (normalizedFlavor ? ['dante', 'dante-fiber'].includes(normalizedFlavor) : detectDanteFlavorFromLocation());
    const directWifiEnabled = payload.directWifiEnabled === undefined
        ? isDanteFlavor
        : Boolean(payload.directWifiEnabled);

    window.activeFlavorName = activeFlavor;
    window.isDanteFlavor = isDanteFlavor;
    window.directWifiEnabled = directWifiEnabled;
    document.documentElement.classList.toggle('is-dante-flavor', isDanteFlavor);
    document.body?.classList.toggle('is-dante-flavor', isDanteFlavor);
    window.dispatchEvent(new CustomEvent('flavor:metadata', {
        detail: { activeFlavor, isDanteFlavor, directWifiEnabled }
    }));
};

applyFlavorMetadata({
    activeFlavor: window.activeFlavorName || '',
    isDanteFlavor: detectDanteFlavorFromLocation(),
    directWifiEnabled: detectDanteFlavorFromLocation()
});

(() => {
    if (typeof window === 'undefined' || window.appConfirm) return;

    const confirmQueue = [];
    let activeConfirm = null;
    let dialogElements = null;
    let lastFocusedElement = null;

    const normalizeFeedbackType = (type, fallback = 'info') => {
        const raw = String(type || fallback).trim().toLowerCase();
        if (raw === 'danger' || raw === 'error') return 'danger';
        if (raw === 'warn' || raw === 'warning') return 'warning';
        if (raw === 'success' || raw === 'ok') return 'success';
        if (raw === 'primary' || raw === 'info') return raw;
        return fallback;
    };

    const inferConfirmType = (message = '', title = '') => {
        const text = `${title} ${message}`.toLowerCase();
        if (/\b(delete|remove|archive|disconnect|clear|purge|permanent|cannot be undone)\b/.test(text)) return 'danger';
        if (/\b(warning|cancel|replace|stop)\b/.test(text)) return 'warning';
        return 'primary';
    };

    const iconForType = (type) => {
        if (type === 'danger') return 'ti-alert-triangle';
        if (type === 'warning') return 'ti-alert-circle';
        if (type === 'success') return 'ti-circle-check';
        return 'ti-info-circle';
    };

    const ensureConfirmStyles = () => {
        if (document.getElementById('appConfirmStyles')) return;
        const style = document.createElement('style');
        style.id = 'appConfirmStyles';
        style.textContent = `
            #appConfirmOverlay {
                position: fixed;
                inset: 0;
                display: none;
                align-items: center;
                justify-content: center;
                background: rgba(15, 23, 42, 0.48);
                backdrop-filter: blur(2px);
                z-index: 20000;
                padding: 18px;
            }
            #appConfirmOverlay.show { display: flex; }
            #appConfirmDialog {
                width: min(460px, 96vw);
                margin: auto;
                pointer-events: auto;
            }
            #appConfirmHead {
                margin: 0;
            }
            #appConfirmBody {
                white-space: pre-wrap;
            }
            #appConfirmOverlay .app-confirm-icon {
                width: 3rem;
                height: 3rem;
                margin: 0 auto .75rem;
            }
            #appConfirmOverlay .app-confirm-cancel[hidden] {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
    };

    const ensureConfirmDialog = () => {
        if (dialogElements) return dialogElements;
        ensureConfirmStyles();
        const overlay = document.createElement('div');
        overlay.id = 'appConfirmOverlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.className = 'modal modal-blur app-confirm-modal';
        overlay.innerHTML = `
            <div id="appConfirmDialog" class="modal-dialog modal-sm modal-dialog-centered" role="document">
                <div class="modal-content">
                    <div id="appConfirmStatus" class="modal-status bg-primary"></div>
                    <div class="modal-body text-center py-4">
                        <span id="appConfirmIcon" class="avatar avatar-lg bg-primary-lt text-primary app-confirm-icon">
                            <i class="ti ti-info-circle" aria-hidden="true"></i>
                        </span>
                        <h3 id="appConfirmHead" class="modal-title mb-2">Please confirm</h3>
                        <div id="appConfirmBody" class="text-secondary"></div>
                    </div>
                    <div id="appConfirmActions" class="modal-footer">
                        <div class="w-100">
                            <div class="row g-2">
                                <div class="col app-confirm-cancel">
                                    <button type="button" class="app-confirm-btn cancel btn w-100 btn-outline-secondary" id="appConfirmCancel">Cancel</button>
                                </div>
                                <div class="col">
                                    <button type="button" class="app-confirm-btn confirm btn w-100 btn-primary" id="appConfirmOk">OK</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const dialog = overlay.querySelector('#appConfirmDialog');
        const status = overlay.querySelector('#appConfirmStatus');
        const iconWrap = overlay.querySelector('#appConfirmIcon');
        const icon = iconWrap?.querySelector('i') || null;
        const title = overlay.querySelector('#appConfirmHead');
        const message = overlay.querySelector('#appConfirmBody');
        const okButton = overlay.querySelector('#appConfirmOk');
        const cancelButton = overlay.querySelector('#appConfirmCancel');
        const cancelCol = overlay.querySelector('.app-confirm-cancel');

        const resolveActive = (confirmed) => {
            if (!activeConfirm) return;
            const resolver = activeConfirm.resolve;
            activeConfirm = null;
            const focusedElement = document.activeElement;
            if (focusedElement && overlay.contains(focusedElement) && typeof focusedElement.blur === 'function') {
                focusedElement.blur();
            }
            overlay.classList.remove('show');
            overlay.setAttribute('aria-hidden', 'true');
            resolver(Boolean(confirmed));
            queueNextConfirm();
            if (!activeConfirm && lastFocusedElement && lastFocusedElement.isConnected) {
                const nextFocusTarget = lastFocusedElement;
                lastFocusedElement = null;
                setTimeout(() => {
                    try {
                        nextFocusTarget.focus({ preventScroll: true });
                    } catch {
                        try { nextFocusTarget.focus(); } catch {}
                    }
                }, 0);
            } else if (!activeConfirm) {
                lastFocusedElement = null;
            }
        };

        okButton.addEventListener('click', () => resolveActive(true));
        cancelButton.addEventListener('click', () => resolveActive(false));
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) resolveActive(false);
        });
        window.addEventListener('keydown', (event) => {
            if (!activeConfirm) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                resolveActive(false);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                resolveActive(true);
            }
        });

        dialogElements = { overlay, dialog, status, iconWrap, icon, title, message, okButton, cancelButton, cancelCol };
        return dialogElements;
    };

    const queueNextConfirm = () => {
        if (activeConfirm || !confirmQueue.length) return;
        const next = confirmQueue.shift();
        const { overlay, dialog, status, iconWrap, icon, title, message, okButton, cancelButton, cancelCol } = ensureConfirmDialog();
        activeConfirm = next;
        if (document.activeElement && document.activeElement !== document.body) {
            lastFocusedElement = document.activeElement;
        } else {
            lastFocusedElement = null;
        }
        const options = next.options || {};
        const heading = options.title || 'Please confirm';
        const type = normalizeFeedbackType(options.type, inferConfirmType(next.message, heading));
        const okClass = type === 'danger'
            ? 'btn-danger'
            : type === 'warning'
                ? 'btn-warning'
                : type === 'success'
                    ? 'btn-success'
                    : 'btn-primary';
        if (dialog) dialog.setAttribute('data-alert-type', type);
        if (status) status.className = `modal-status bg-${type}`;
        if (iconWrap) iconWrap.className = `avatar avatar-lg bg-${type}-lt text-${type} app-confirm-icon`;
        if (icon) icon.className = `ti ${iconForType(type)}`;
        title.textContent = heading;
        message.textContent = String(next.message || '').trim() || 'Are you sure?';
        okButton.textContent = options.okText || 'OK';
        okButton.className = `app-confirm-btn confirm btn w-100 ${okClass}`;
        cancelButton.textContent = options.cancelText || 'Cancel';
        cancelCol.hidden = Boolean(options.hideCancel);
        overlay.classList.add('show');
        overlay.setAttribute('aria-hidden', 'false');
        setTimeout(() => okButton.focus({ preventScroll: true }), 0);
    };

    window.appConfirm = (message, options = {}) => new Promise((resolve) => {
        confirmQueue.push({ message, options, resolve });
        queueNextConfirm();
    });
})();

(() => {
    if (typeof window === 'undefined') return;
    const nativeAlert = typeof window.alert === 'function' ? window.alert.bind(window) : null;
    if (!window.appAlert && typeof window.appConfirm === 'function') {
        window.appAlert = (message, options = {}) => window.appConfirm(message, {
            title: options.title || 'Notice',
            okText: options.okText || 'OK',
            type: options.type || 'info',
            hideCancel: true
        }).then(() => undefined);
    }
    if (!window.__tablerAlertPatched) {
        window.__tablerAlertPatched = true;
        window.alert = (message) => {
            if (typeof window.appAlert === 'function') {
                void window.appAlert(message, { title: 'Notice', type: 'info' });
                return undefined;
            }
            return nativeAlert ? nativeAlert(message) : undefined;
        };
    }
})();

(() => {
    if (typeof window === 'undefined' || window.appToast) return;

    let toastHost = null;

    const ensureToastStyles = () => {
        if (document.getElementById('appToastStyles')) return;
        const style = document.createElement('style');
        style.id = 'appToastStyles';
        style.textContent = `
            #appToastHost {
                position: fixed;
                right: 24px;
                bottom: 24px;
                z-index: 21000;
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 10px;
                pointer-events: none;
            }
            #appToastHost .app-toast.alert {
                pointer-events: auto;
                max-width: min(420px, calc(100vw - 36px));
                border-radius: var(--tblr-border-radius-lg, 10px);
                box-shadow: var(--tblr-shadow-dropdown, 0 18px 40px rgba(15, 23, 42, 0.18));
                opacity: 0;
                transform: translateY(10px);
                transition: opacity 180ms ease, transform 180ms ease;
                word-break: break-word;
                margin: 0;
            }
            #appToastHost .app-toast.alert.show {
                opacity: 1;
                transform: translateY(0);
            }
            #appToastHost .app-toast .alert-message {
                font-weight: 600;
                line-height: 1.35;
            }
            body.theme-dark #appToastHost .app-toast.alert {
                box-shadow: 0 20px 42px rgba(2, 6, 23, 0.55);
            }
            @media (max-width: 768px) {
                #appToastHost {
                    left: 16px;
                    right: 16px;
                    bottom: 16px;
                    align-items: stretch;
                }
                #appToastHost .app-toast.alert {
                    max-width: none;
                }
            }
            @media (prefers-reduced-motion: reduce) {
                #appToastHost .app-toast.alert {
                    transition: none;
                    transform: none;
                }
            }
        `;
        document.head.appendChild(style);
    };

    const ensureToastHost = () => {
        if (toastHost && toastHost.isConnected) return toastHost;
        ensureToastStyles();
        toastHost = document.getElementById('appToastHost');
        if (!toastHost) {
            toastHost = document.createElement('div');
            toastHost.id = 'appToastHost';
            toastHost.setAttribute('aria-live', 'polite');
            toastHost.setAttribute('aria-atomic', 'false');
            document.body.appendChild(toastHost);
        }
        return toastHost;
    };

    const normalizeToastType = (type) => {
        const raw = String(type || 'info').toLowerCase();
        if (raw === 'danger' || raw === 'error') return 'danger';
        if (raw === 'warn') return 'warning';
        if (raw === 'ok') return 'success';
        if (raw === 'success' || raw === 'warning' || raw === 'info' || raw === 'primary') return raw;
        return 'info';
    };

    const iconForToastType = (type) => {
        if (type === 'success') return 'ti-circle-check';
        if (type === 'warning') return 'ti-alert-circle';
        if (type === 'danger') return 'ti-alert-triangle';
        return 'ti-info-circle';
    };

    window.appToast = (message, options = {}) => {
        const text = String(message ?? '').trim();
        if (!text) return () => {};

        const config = typeof options === 'string' ? { type: options } : (options || {});
        const type = normalizeToastType(config.type);
        const duration = Number.isFinite(Number(config.duration))
            ? Math.max(1200, Number(config.duration))
            : 3000;

        const host = ensureToastHost();
        const toast = document.createElement('div');
        const tone = type === 'primary' ? 'info' : type;
        toast.className = `alert alert-important alert-${tone} alert-dismissible app-toast show`;
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.setAttribute('aria-atomic', 'true');
        const alertIcon = document.createElement('span');
        alertIcon.className = 'alert-icon';
        alertIcon.innerHTML = `<i class="ti ${iconForToastType(type)}" aria-hidden="true"></i>`;
        const alertBody = document.createElement('div');
        alertBody.className = 'alert-message';
        alertBody.textContent = text;
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'btn-close';
        closeButton.setAttribute('aria-label', 'Close notification');
        toast.appendChild(alertIcon);
        toast.appendChild(alertBody);
        toast.appendChild(closeButton);
        host.appendChild(toast);

        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 180);
        };

        const timerId = duration > 0 ? setTimeout(close, duration) : null;
        closeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            if (timerId) clearTimeout(timerId);
            close();
        });
        toast.addEventListener('click', () => {
            if (timerId) clearTimeout(timerId);
            close();
        });

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        return close;
    };
})();

window.withButtonLock = (button, options = {}) => {
    if (!button) return null;
    if (button.dataset.locked === 'true') return null;
    const label = options.label || button.dataset.lockLabel || '';
    const isInput = button.tagName === 'INPUT';
    button.dataset.locked = 'true';
    if (!button.dataset.prevDisabled) {
        button.dataset.prevDisabled = button.disabled ? 'true' : 'false';
    }
    if (!button.dataset.prevLabel) {
        button.dataset.prevLabel = isInput ? (button.value || '') : button.innerHTML;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (label) {
        if (isInput) {
            button.value = label;
        } else {
            button.innerHTML = label;
        }
    }
    return () => {
        delete button.dataset.locked;
        const wasDisabled = button.dataset.prevDisabled === 'true';
        if (!wasDisabled) {
            button.disabled = false;
        }
        button.removeAttribute('aria-busy');
        if (button.dataset.prevLabel != null) {
            if (isInput) {
                button.value = button.dataset.prevLabel;
            } else {
                button.innerHTML = button.dataset.prevLabel;
            }
        }
        delete button.dataset.prevDisabled;
        delete button.dataset.prevLabel;
    };
};

window.withSubmitLock = (form, options = {}) => {
    if (!form) return null;
    if (form.dataset.submitting === 'true') return null;
    form.dataset.submitting = 'true';
    const submitButton = options.button || form.querySelector('button[type="submit"], input[type="submit"]');
    const unlockButton = window.withButtonLock(submitButton, { label: options.label || 'Saving...' });
    return () => {
        delete form.dataset.submitting;
        if (unlockButton) {
            unlockButton();
        }
    };
};

document.addEventListener('DOMContentLoaded', () => {
    const THEME_STORAGE_KEY = 'billing-theme';
    const LEGACY_THEME_STORAGE_KEY = 'dante-theme';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    const topbarHost = document.getElementById('topbar');
    const sidebarHost = document.getElementById('sidebar');
    const HIDE_TOPBAR_MENU_ICON = false;
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    const MOBILE_SIDEBAR_BREAKPOINT = 991.98;
    const SIDEBAR_OPEN_CLASS = 'sidebar-mobile-open';
    const SIDEBAR_WORK_BADGE_REFRESH_MS = 30000;
    let sidebarOverlay = null;
    let sidebarWorkBadgeTimer = null;
    let sidebarWorkBadgeWarned = false;

    document.body.classList.add('layout-fluid', 'layout-fluid-vertical');
    document.querySelector('.app-shell')?.classList.add('tabler-fluid-vertical');
    document.querySelector('.app-main')?.classList.add('page-wrapper');
    sidebarHost?.classList.add('app-sidebar-host');
    topbarHost?.classList.add('app-topbar-host');

    const dockTopbarIntoSidebar = () => {
        const topbar = topbarHost?.querySelector('.topbar');
        const sidebar = sidebarHost?.querySelector('.navbar-vertical');
        if (!topbar || !sidebar) return false;

        const toggleSlot = sidebar.querySelector('[data-sidebar-toggle]');
        const brandSlot = sidebar.querySelector('[data-sidebar-brand]');
        const actionsSlot = sidebar.querySelector('[data-sidebar-actions]');
        if (!toggleSlot || !brandSlot || !actionsSlot) return false;

        const menuToggle = topbar.querySelector('#topbarMenuToggle');
        const brand = topbar.querySelector('.topbar-left');
        const actions = topbar.querySelector('.topbar-right');

        if (menuToggle) {
            menuToggle.classList.add('navbar-toggler');
            menuToggle.setAttribute('aria-controls', 'sidebar-menu');
            toggleSlot.replaceChildren(menuToggle);
        }
        if (brand) {
            brand.classList.add('navbar-brand', 'navbar-brand-autodark');
            brandSlot.replaceChildren(brand);
        }
        if (actions) {
            actions.classList.add('navbar-nav', 'flex-row');
            actionsSlot.replaceChildren(actions);
        }

        topbar.remove();
        topbarHost.classList.add('app-topbar-host--docked');
        return true;
    };

    const isMobileSidebarViewport = () => window.matchMedia(`(max-width: ${MOBILE_SIDEBAR_BREAKPOINT}px)`).matches;

    const setSidebarToggleState = (expanded) => {
        const toggle = document.getElementById('topbarMenuToggle');
        if (!toggle) return;
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        toggle.setAttribute('aria-label', expanded ? 'Close navigation menu' : 'Open navigation menu');
    };

    const ensureSidebarOverlay = () => {
        if (sidebarOverlay && sidebarOverlay.isConnected) return sidebarOverlay;
        const existing = document.getElementById('sidebarMobileOverlay');
        if (existing) {
            sidebarOverlay = existing;
            return sidebarOverlay;
        }
        const overlay = document.createElement('button');
        overlay.type = 'button';
        overlay.id = 'sidebarMobileOverlay';
        overlay.className = 'sidebar-mobile-overlay';
        overlay.setAttribute('aria-label', 'Close navigation menu');
        overlay.setAttribute('tabindex', '-1');
        overlay.hidden = true;
        document.body.appendChild(overlay);
        sidebarOverlay = overlay;
        return sidebarOverlay;
    };

    const closeMobileSidebar = () => {
        if (!sidebarHost) return;
        document.body.classList.remove(SIDEBAR_OPEN_CLASS);
        const overlay = ensureSidebarOverlay();
        overlay.hidden = true;
        setSidebarToggleState(false);
    };

    const openMobileSidebar = () => {
        if (!sidebarHost) return;
        if (!isMobileSidebarViewport()) return;
        const overlay = ensureSidebarOverlay();
        overlay.hidden = false;
        document.body.classList.add(SIDEBAR_OPEN_CLASS);
        setSidebarToggleState(true);
    };

    const toggleMobileSidebar = () => {
        if (!sidebarHost) return;
        if (!isMobileSidebarViewport()) return;
        const isOpen = document.body.classList.contains(SIDEBAR_OPEN_CLASS);
        if (isOpen) {
            closeMobileSidebar();
        } else {
            openMobileSidebar();
        }
    };

    const syncMobileSidebarViewport = () => {
        if (!sidebarHost) return;
        if (!isMobileSidebarViewport()) {
            closeMobileSidebar();
        } else {
            const isOpen = document.body.classList.contains(SIDEBAR_OPEN_CLASS);
            const overlay = ensureSidebarOverlay();
            overlay.hidden = !isOpen;
            setSidebarToggleState(isOpen);
        }
    };

    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    let currentTheme = storedTheme || 'light';

    const BUSINESS_PROFILE_STORAGE_KEY = 'billing-business-profile';
    const LEGACY_BUSINESS_PROFILE_STORAGE_KEY = 'dante-business-profile';
    const DEFAULT_BUSINESS_PROFILE = {
        businessName: 'Billing System',
        tagline: '',
        supportEmail: '',
        contact: '--',
        address: '--',
        account: '--',
        role: '--',
        lastLogin: '--',
        logoUrl: '/img/business-logo.svg'
    };
    const originalDocumentTitle = document.title || '';

    const isDataUrl = (value) => typeof value === 'string' && value.startsWith('data:');

    const computeInitials = (value) => {
        if (!value) return 'BI';
        const words = String(value)
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        if (!words.length) return 'BI';
        const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase() || '');
        const result = initials.join('');
        if (result.length === 1) return `${result}${result}`;
        return result.slice(0, 2) || 'BI';
    };

    const BUSINESS_PROFILE_API = '/api/business-profile';
    const AUTH_ME_API = '/api/auth/me';

    const loadBusinessProfile = () => {
        try {
            const raw = localStorage.getItem(BUSINESS_PROFILE_STORAGE_KEY)
                || localStorage.getItem(LEGACY_BUSINESS_PROFILE_STORAGE_KEY);
            if (!raw) return { ...DEFAULT_BUSINESS_PROFILE };
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                return { ...DEFAULT_BUSINESS_PROFILE, ...parsed };
            }
        } catch {
            // ignore storage issues and fall back to defaults
        }
        return { ...DEFAULT_BUSINESS_PROFILE };
    };

    const saveBusinessProfile = (profile) => {
        try {
            localStorage.setItem(BUSINESS_PROFILE_STORAGE_KEY, JSON.stringify(profile));
        } catch {
            // ignore quota errors
        }
    };

    let businessProfile = loadBusinessProfile();
    let profileFetchPromise = null;
    let currentAuthProfile = null;

    const authTimestampFormatter = new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });

    const formatProfileTimestamp = (value) => {
        if (value === undefined || value === null || value === '') return '--';
        const normalized = String(value).trim();
        if (!normalized) return '--';
        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime())) {
            return normalized;
        }
        return authTimestampFormatter.format(parsed);
    };

    const fetchBusinessProfileFromApi = async () => {
        if (profileFetchPromise) return profileFetchPromise;
        profileFetchPromise = (async () => {
            try {
                const res = await fetch(BUSINESS_PROFILE_API, { credentials: 'include' });
                if (!res.ok) throw new Error(`status ${res.status}`);
                const data = await res.json();
                const merged = { ...DEFAULT_BUSINESS_PROFILE, ...data };
                businessProfile = merged;
                saveBusinessProfile(merged);
                applyBusinessProfile();
                return merged;
            } catch (err) {
                console.warn('Business profile fetch failed:', err);
                return null;
            }
        })();
        return profileFetchPromise;
    };

    const fetchAuthProfile = async () => {
        try {
            const response = await fetch(AUTH_ME_API, { credentials: 'include', cache: 'no-store' });
            if (!response.ok) throw new Error(`status ${response.status}`);
            const payload = await response.json();
            const user = payload?.user;
            if (user && typeof user === 'object') {
                currentAuthProfile = {
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    role: user.role,
                    lastLogin: user.lastLogin || user.sessionCreatedAt || null
                };
            } else {
                currentAuthProfile = null;
            }
            applyBusinessProfile();
            return currentAuthProfile;
        } catch (error) {
            currentAuthProfile = null;
            return null;
        }
    };

    const persistBusinessProfileToApi = async (profile) => {
        try {
            const res = await fetch(BUSINESS_PROFILE_API, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(profile)
            });
            if (!res.ok) throw new Error(`status ${res.status}`);
            const data = await res.json();
            const merged = { ...DEFAULT_BUSINESS_PROFILE, ...data };
            saveBusinessProfile(merged);
            return merged;
        } catch (err) {
            console.warn('Business profile save to API failed:', err);
            return null;
        }
    };

    const getBusinessProfileField = (key) => {
        const value = businessProfile?.[key];
        if (value === undefined || value === null) {
            return DEFAULT_BUSINESS_PROFILE[key] ?? '';
        }
        return value;
    };

    const setTextContent = (target, text) => {
        if (!target) return;
        const element = typeof target === 'string' ? document.getElementById(target) : target;
        if (!element) return;
        element.textContent = text ?? '';
    };

    const applyBusinessTitle = (businessName) => {
        const name = String(businessName || '').trim() || DEFAULT_BUSINESS_PROFILE.businessName;
        const baseTitle = String(originalDocumentTitle || '').trim();
        if (typeof window.buildBusinessTitle === 'function') {
            document.title = window.buildBusinessTitle(baseTitle || document.title, name, name);
            return;
        }
        const oldBrandPattern = /Dante Point To Point Pisonet|Micro - Network|Dante P2P Fiber|Dante ISP Billing|New Billing System|Dante Fiber/g;
        document.title = oldBrandPattern.test(baseTitle)
            ? baseTitle.replace(oldBrandPattern, name)
            : `${baseTitle} - ${name}`;
    };

    const applyBusinessProfile = () => {
        const businessName = getBusinessProfileField('businessName') || DEFAULT_BUSINESS_PROFILE.businessName;
        let tagline = getBusinessProfileField('tagline');
        if (!tagline) tagline = DEFAULT_BUSINESS_PROFILE.tagline;
        const supportEmail = getBusinessProfileField('supportEmail');
        const contact = getBusinessProfileField('contact');
        const address = getBusinessProfileField('address');
        const accountFallback = String(getBusinessProfileField('account') || '').trim() || '--';
        const roleFallback = String(getBusinessProfileField('role') || '').trim() || '--';
        const authAccount = String(currentAuthProfile?.username || '').trim();
        const authRole = String(currentAuthProfile?.role || '').trim();
        const authName = String(currentAuthProfile?.name || '').trim();
        const account = authAccount || accountFallback;
        const role = authRole || roleFallback;
        const lastLoginSource = currentAuthProfile?.lastLogin || getBusinessProfileField('lastLogin');
        const lastLogin = formatProfileTimestamp(lastLoginSource);
        const topbarProfileName = authName || authAccount || businessName;
        const topbarProfileRole = role;
        const customLogo = businessProfile && Object.prototype.hasOwnProperty.call(businessProfile, 'logoUrl')
            ? businessProfile.logoUrl
            : DEFAULT_BUSINESS_PROFILE.logoUrl;
        const effectiveLogo = customLogo || '';
        const hasLogo = Boolean(effectiveLogo);
        const initials = computeInitials(businessName);

        applyBusinessTitle(businessName);
        if (typeof window.applyBusinessFavicon === 'function') {
            window.applyBusinessFavicon({ businessName, logoUrl: effectiveLogo });
        }

        setTextContent('topbarBusinessName', businessName);
        setTextContent('profileBusiness', businessName);
        setTextContent('profileModalBusinessName', businessName);
        setTextContent('profileName', topbarProfileName);
        setTextContent('profileRole', topbarProfileRole);

        setTextContent('topbarBusinessTagline', tagline);
        setTextContent('profileModalBusinessTagline', tagline);
        setTextContent('profileBusinessTagline', tagline);

        setTextContent('profileBusinessEmail', supportEmail);
        setTextContent('profileBusinessContact', contact);
        setTextContent('profileBusinessAddress', address);
        setTextContent('profileAccount', account);
        setTextContent('profileRoleDetail', role);
        setTextContent('profileLastLogin', lastLogin);

        setTextContent('topbarLogoFallback', initials);
        setTextContent('profileModalLogoFallback', initials);

        const topbarLogoImg = document.getElementById('topbarLogo');
        const topbarLogoContainer = topbarLogoImg?.closest('.logo-chip') || document.querySelector('.logo-chip');
        if (topbarLogoImg) {
            if (hasLogo) {
                if (topbarLogoImg.getAttribute('src') !== effectiveLogo) {
                    delete topbarLogoImg.dataset.fallbackApplied;
                    topbarLogoImg.setAttribute('src', effectiveLogo);
                }
            } else {
                topbarLogoImg.removeAttribute('src');
            }
        }
        if (topbarLogoContainer) {
            topbarLogoContainer.classList.toggle('logo-chip--has-image', hasLogo);
        }

        const modalLogoImg = document.getElementById('profileModalLogo');
        const modalLogoContainer = modalLogoImg?.closest('.profile-modal__branding-logo') || document.querySelector('.profile-modal__branding-logo');
        if (modalLogoImg) {
            if (hasLogo) {
                if (modalLogoImg.getAttribute('src') !== effectiveLogo) {
                    delete modalLogoImg.dataset.fallbackApplied;
                    modalLogoImg.setAttribute('src', effectiveLogo);
                }
            } else {
                modalLogoImg.removeAttribute('src');
            }
        }
        if (modalLogoContainer) {
            modalLogoContainer.classList.toggle('profile-modal__branding-logo--has-image', hasLogo);
        }
    };

    const ACTIVITY_LOG_STORAGE_KEY = 'dante-activity-log';
    const ACTIVITY_LOG_API = '/api/activity-log';
    const MAX_ACTIVITY_LOG_ITEMS = 50;
    const HIDDEN_ACTIVITY_USERNAMES = new Set(['archiecd']);
    const ACTIVITY_MANILA_OFFSET_SUFFIX = '+08:00';
    const ACTIVITY_SQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    const ACTIVITY_ISO_DATETIME_NO_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
    const activityLogListeners = new Set();
    const timestampFormatter = new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
    const fullTimestampFormatter = new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });

    const parseActivityTimestamp = (value) => {
        if (!value && value !== 0) return null;
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
        }
        const raw = String(value || '').trim();
        if (!raw) return null;
        if (ACTIVITY_SQL_DATETIME_RE.test(raw)) {
            const parsed = new Date(raw.replace(' ', 'T') + ACTIVITY_MANILA_OFFSET_SUFFIX);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        if (ACTIVITY_ISO_DATETIME_NO_TZ_RE.test(raw)) {
            const parsed = new Date(`${raw}${ACTIVITY_MANILA_OFFSET_SUFFIX}`);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const normalizeActivityEntry = (entry) => {
        if (!entry || !entry.message) return null;
        const timestamp = parseActivityTimestamp(entry.timestamp);
        return {
            id: entry.id || `local-${Math.random().toString(16).slice(2)}`,
            message: entry.message,
            meta: entry.meta || '',
            timestamp: timestamp ? timestamp.toISOString() : new Date().toISOString(),
            username: entry.username || ''
        };
    };

    const normalizeHiddenActivityValue = (value) => String(value || '').trim().toLowerCase();

    const isHiddenActivityUsername = (username) => HIDDEN_ACTIVITY_USERNAMES.has(normalizeHiddenActivityValue(username));

    const shouldHideActivityEntry = (entry) => {
        const username = normalizeHiddenActivityValue(entry?.username);
        const message = normalizeHiddenActivityValue(entry?.message);
        const meta = normalizeHiddenActivityValue(entry?.meta);
        if (username && isHiddenActivityUsername(username)) return true;
        return Array.from(HIDDEN_ACTIVITY_USERNAMES).some((hiddenUsername) => (
            (message && message.includes(hiddenUsername))
            || (meta && meta.includes(hiddenUsername))
        ));
    };

    const isHiddenActivityCurrentUser = () => isHiddenActivityUsername(currentAuthProfile?.username);

    const loadActivityLog = () => {
        try {
            const saved = localStorage.getItem(ACTIVITY_LOG_STORAGE_KEY);
            if (!saved) return [];
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                return parsed
                    .map((entry) => normalizeActivityEntry(entry))
                    .filter(Boolean)
                    .filter((entry) => !shouldHideActivityEntry(entry));
            }
        } catch {
            // ignore parsing issues and fall back to empty log
        }
        return [];
    };

    let activityLog = loadActivityLog();

    const persistActivityLog = () => {
        try {
            localStorage.setItem(ACTIVITY_LOG_STORAGE_KEY, JSON.stringify(activityLog));
        } catch {
            // Swallow quota errors silently
        }
    };
    persistActivityLog();

    const registerActivityLogListener = (callback) => {
        if (typeof callback !== 'function') return () => {};
        activityLogListeners.add(callback);
        callback([...activityLog]);
        return () => activityLogListeners.delete(callback);
    };

    const notifyActivityLogListeners = () => {
        const snapshot = [...activityLog];
        activityLogListeners.forEach((listener) => {
            try {
                listener(snapshot);
            } catch {
                // Keep other listeners running even if one fails
            }
        });
    };

    const formatActivityLogMeta = (entry) => {
        if (!entry) return '';
        if (entry.meta) return entry.meta;
        if (!entry.timestamp) return '';
        const timestamp = parseActivityTimestamp(entry.timestamp);
        if (!timestamp || Number.isNaN(timestamp.getTime())) return '';
        const diff = Date.now() - timestamp.getTime();
        if (Math.abs(diff) < 60_000) return 'Just now';
        const minutes = Math.round(diff / 60_000);
        if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
        const hours = Math.round(diff / 3_600_000);
        if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
        const days = Math.round(diff / 86_400_000);
        if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
        return timestampFormatter.format(timestamp);
    };

    const formatActivityLogTimestamp = (entry) => {
        if (!entry?.timestamp) return '';
        const ts = parseActivityTimestamp(entry.timestamp);
        if (!ts || Number.isNaN(ts.getTime())) return '';
        return fullTimestampFormatter.format(ts);
    };

    const fetchActivityLogFromApi = async () => {
        try {
            const res = await fetch(ACTIVITY_LOG_API, { credentials: 'include', cache: 'no-store' });
            if (!res.ok) throw new Error(`status ${res.status}`);
            const data = await res.json();
            if (!data || !Array.isArray(data.logs)) return false;
            activityLog = data.logs
                .map((entry) => normalizeActivityEntry(entry))
                .filter(Boolean)
                .filter((entry) => !shouldHideActivityEntry(entry))
                .slice(0, MAX_ACTIVITY_LOG_ITEMS);
            persistActivityLog();
            notifyActivityLogListeners();
            return true;
        } catch (err) {
            console.warn('Activity log fetch failed:', err);
            return false;
        }
    };

    const postActivityLogToApi = async ({ message, meta }) => {
        try {
            const res = await fetch(ACTIVITY_LOG_API, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, meta })
            });
            if (!res.ok) throw new Error(`status ${res.status}`);
            return true;
        } catch (err) {
            console.warn('Activity log persist failed:', err);
            return false;
        }
    };

    const clearActivityLogOnServer = async () => {
        try {
            const res = await fetch(ACTIVITY_LOG_API, { method: 'DELETE', credentials: 'include' });
            if (!res.ok) throw new Error(`status ${res.status}`);
            return true;
        } catch (err) {
            console.warn('Activity log clear failed:', err);
            return false;
        }
    };

    const addActivityLog = ({ message, meta }) => {
        if (!message) return;
        if (!currentAuthProfile) {
            postActivityLogToApi({ message, meta }).then((ok) => {
                if (ok) {
                    fetchActivityLogFromApi();
                }
            });
            return;
        }
        if (isHiddenActivityCurrentUser()) return;
        const entry = normalizeActivityEntry({
            message,
            meta: meta || '',
            timestamp: new Date().toISOString(),
            username: currentAuthProfile?.username || ''
        });
        if (!entry || shouldHideActivityEntry(entry)) return;
        activityLog.unshift(entry);
        if (activityLog.length > MAX_ACTIVITY_LOG_ITEMS) {
            activityLog = activityLog.slice(0, MAX_ACTIVITY_LOG_ITEMS);
        }
        persistActivityLog();
        notifyActivityLogListeners();
        postActivityLogToApi({ message, meta }).then((ok) => {
            if (ok) {
                fetchActivityLogFromApi();
            }
        });
    };

    const clearActivityLog = async () => {
        const confirmed = window.appConfirm
            ? await window.appConfirm('Clear all activity logs?', { title: 'Clear Activity Log' })
            : window.confirm('Clear all activity logs?');
        if (!confirmed) return;
        activityLog = [];
        persistActivityLog();
        notifyActivityLogListeners();
        clearActivityLogOnServer();
    };

    document.addEventListener('activity-log:add', (event) => {
        const detail = event?.detail;
        if (detail && typeof detail.message === 'string') {
            addActivityLog(detail);
        }
    });

    const syncShellTheme = () => {
        const isDark = document.body.classList.contains('theme-dark');
        document.querySelectorAll('.sidebar').forEach((el) => {
            if (el.classList.contains('navbar-vertical')) {
                el.classList.add('sidebar-dark');
                el.classList.remove('sidebar-light');
                el.dataset.bsTheme = 'dark';
                return;
            }
            el.classList.toggle('sidebar-dark', isDark);
            el.classList.toggle('sidebar-light', !isDark);
        });
    };

    const applyTheme = (theme) => {
        const isDarkTheme = theme === 'dark';
        document.documentElement.classList.toggle('theme-dark', isDarkTheme);
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.bsTheme = theme;
        document.documentElement.style.colorScheme = isDarkTheme ? 'dark' : 'light';
        document.body.classList.toggle('theme-dark', isDarkTheme);
        document.body.dataset.theme = theme;
        document.body.dataset.bsTheme = theme;
        document.body.style.colorScheme = isDarkTheme ? 'dark' : 'light';

        syncShellTheme();

        const toggleBtn = document.querySelector('[data-action="theme-toggle"]');
        if (toggleBtn) {
            toggleBtn.setAttribute('aria-label', isDarkTheme ? 'Switch to light mode' : 'Switch to dark mode');
            toggleBtn.setAttribute('data-tooltip', isDarkTheme ? 'Light mode' : 'Dark mode');
            const tablerIcon = toggleBtn.querySelector('.ti');
            if (tablerIcon) {
                const lightIcon = tablerIcon.dataset.tiLight || 'moon-stars';
                const darkIcon = tablerIcon.dataset.tiDark || 'sun';
                Array.from(tablerIcon.classList).forEach((className) => {
                    if (className.startsWith('ti-') && className !== 'ti') {
                        tablerIcon.classList.remove(className);
                    }
                });
                tablerIcon.classList.add(`ti-${isDarkTheme ? darkIcon : lightIcon}`);
            }
        }

        window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
    };

    const bindThemeToggle = (root) => {
        const toggleBtn = root.querySelector('[data-action="theme-toggle"]');
        if (!toggleBtn) return;
        toggleBtn.addEventListener('click', () => {
            currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
            localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
            localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
            applyTheme(currentTheme);
            addActivityLog({
                message: `Switched to ${currentTheme === 'dark' ? 'dark' : 'light'} theme`
            });
        });
    };

    const bindGlobalSearch = (root) => {
        const searchInput = root.querySelector('.topbar-search input');
        if (!searchInput) return;
        let lastQuery = '';

        // Listen for events from pages that have a search function
        document.addEventListener('page:search-ready', (e) => {
            searchInput.placeholder = e.detail.placeholder || 'Global search';
            // When a new page is ready, apply the last known search query to it
            if (lastQuery) {
                searchInput.value = lastQuery;
                document.dispatchEvent(new CustomEvent('global-search:query', { detail: { query: lastQuery } }));
            } else {
                searchInput.value = ''; // Clear search bar when navigating to a new page with no active query
            }
        });

        searchInput.addEventListener('input', (e) => {
            lastQuery = e.target.value;
            // Broadcast the search query to any listening page
            document.dispatchEvent(new CustomEvent('global-search:query', { detail: { query: lastQuery } }));
        });
    };

    const initTopbarInteractions = (root) => {
        if (typeof detachTopbarInteractions === 'function') {
            detachTopbarInteractions();
            detachTopbarInteractions = null;
        }

        if (!root) return;

        const profileTrigger = root.querySelector('#topbarProfile');
        const profileModal = document.getElementById('profileModal');
        const profileModalContent = profileModal ? profileModal.querySelector('.profile-modal__content') : null;
        const profileModalCloseEls = profileModal ? profileModal.querySelectorAll('[data-profile-close]') : [];
        const profileEditBtn = document.getElementById('profileEditBtn');
        const profileEditModal = document.getElementById('profileEditModal');
        const profileEditCloseEls = profileEditModal ? profileEditModal.querySelectorAll('[data-profile-edit-close]') : [];
        const profileEditForm = document.getElementById('profileEditForm');
        const profileEditSaveBtn = profileEditModal ? profileEditModal.querySelector('#profileEditSave') : null;
        const profileEditNameInput = profileEditModal ? profileEditModal.querySelector('#profileEditName') : null;
        const profileEditEmailInput = profileEditModal ? profileEditModal.querySelector('#profileEditEmail') : null;
        const profileEditTaglineInput = profileEditModal ? profileEditModal.querySelector('#profileEditTagline') : null;
        const profileEditContactInput = profileEditModal ? profileEditModal.querySelector('#profileEditContact') : null;
        const profileEditAddressInput = profileEditModal ? profileEditModal.querySelector('#profileEditAddress') : null;
        const profileEditLogoInput = profileEditModal ? profileEditModal.querySelector('#profileEditLogo') : null;
        const profileEditLogoPreview = profileEditModal ? profileEditModal.querySelector('[data-logo-preview]') : null;
        const profileEditLogoPreviewImage = profileEditModal ? profileEditModal.querySelector('[data-logo-preview-image]') : null;
        const profileEditLogoPreviewFallback = profileEditModal ? profileEditModal.querySelector('[data-logo-preview-fallback]') : null;
        const logoContainer = root.querySelector('.logo-chip');
        const logoImage = root.querySelector('#topbarLogo');
        const sidebarToggleBtn = root.querySelector('#topbarMenuToggle');
        const profileBrandingLogo = document.querySelector('.profile-modal__branding-logo');
        const profileBrandingImage = document.getElementById('profileModalLogo');
        const logsTrigger = root.querySelector('#topbarLogs');
        const logsModal = document.getElementById('logsModal');
        const logsList = document.getElementById('logsList');
        const logsClearBtn = document.getElementById('logsClear');
        const logsCloseEls = logsModal ? logsModal.querySelectorAll('[data-logs-close]') : [];
        const importBtn = root.querySelector('[data-action="import"]');
        const exportBtn = root.querySelector('[data-action="export"]');
        const logoutBtn = root.querySelector('[data-action="logout"]');
        const credentialResetOverlay = document.getElementById('credentialResetOverlay');
        const credentialResetForm = credentialResetOverlay ? credentialResetOverlay.querySelector('#credentialResetForm') : null;
        const credentialResetUsername = credentialResetOverlay ? credentialResetOverlay.querySelector('#credentialResetUsername') : null;
        const credentialResetPassword = credentialResetOverlay ? credentialResetOverlay.querySelector('#credentialResetPassword') : null;
        const credentialResetPasswordConfirm = credentialResetOverlay ? credentialResetOverlay.querySelector('#credentialResetPasswordConfirm') : null;
        const credentialResetError = credentialResetOverlay ? credentialResetOverlay.querySelector('#credentialResetError') : null;
        const credentialResetSaveBtn = credentialResetOverlay ? credentialResetOverlay.querySelector('#credentialResetSaveBtn') : null;

        const cleanupFns = [];
        const addCleanup = (fn) => {
            if (typeof fn === 'function') cleanupFns.push(fn);
        };

        const addListener = (target, event, handler) => {
            if (!target || typeof handler !== 'function') return;
            target.addEventListener(event, handler);
            addCleanup(() => target.removeEventListener(event, handler));
        };

        const CREDENTIAL_RESET_FLAG = 'backup-reset-required';
        const CREDENTIAL_RESET_USER_KEY = 'backup-reset-user-id';

        const setAppShellLocked = (locked) => {
            const shell = document.querySelector('.app-shell');
            if (!shell) return;
            if (locked) {
                shell.setAttribute('inert', '');
                shell.setAttribute('aria-hidden', 'true');
            } else {
                shell.removeAttribute('inert');
                shell.removeAttribute('aria-hidden');
            }
        };

        const setModalLock = (locked) => {
            document.body.classList.toggle('modal-locked', locked);
            setAppShellLocked(locked);
        };

        const clearCredentialResetFlags = () => {
            sessionStorage.removeItem(CREDENTIAL_RESET_FLAG);
            sessionStorage.removeItem(CREDENTIAL_RESET_USER_KEY);
        };

        const hideCredentialResetOverlay = () => {
            if (!credentialResetOverlay) return;
            credentialResetOverlay.setAttribute('hidden', '');
            setModalLock(false);
        };

        const showCredentialResetOverlay = () => {
            if (!credentialResetOverlay) return;
            if (credentialResetError) credentialResetError.textContent = '';
            if (credentialResetUsername) credentialResetUsername.value = '';
            if (credentialResetPassword) credentialResetPassword.value = '';
            if (credentialResetPasswordConfirm) credentialResetPasswordConfirm.value = '';
            credentialResetOverlay.removeAttribute('hidden');
            credentialResetUsername?.focus({ preventScroll: true });
            setModalLock(true);
        };

        const validateCredentialReset = () => {
            const newUsername = credentialResetUsername?.value.trim() || '';
            const newPassword = credentialResetPassword?.value || '';
            const confirmPassword = credentialResetPasswordConfirm?.value || '';

            if (!newUsername) return 'Username is required.';
            if (newUsername.toLowerCase() === 'admin') return 'Please change the default username.';
            if (!newPassword) return 'Password is required.';
            if (newPassword !== newPassword.replace(/^\\s+|\\s+$/g, '')) {
                return 'Password cannot start or end with spaces.';
            }
            if (newPassword.length < 6) return 'Password must be at least 6 characters.';
            if (newPassword.toLowerCase() === 'admin') return 'Please change the default password.';
            if (newPassword !== confirmPassword) return 'Passwords do not match.';
            return '';
        };

        const shouldForceCredentialReset = () => {
            if (!credentialResetOverlay) return false;
            const flagged = sessionStorage.getItem(CREDENTIAL_RESET_FLAG) === 'true';
            if (!flagged) return false;
            const expectedId = sessionStorage.getItem(CREDENTIAL_RESET_USER_KEY) || 'backup-admin';
            if (!currentAuthProfile || String(currentAuthProfile.id) !== expectedId) {
                clearCredentialResetFlags();
                return false;
            }
            const authRoles = Array.isArray(currentAuthProfile.roles)
                ? currentAuthProfile.roles
                : String(currentAuthProfile.role || '').split(/[,/|;]+|\s+\+\s+|\s+and\s+/i);
            const isAdminProfile = authRoles.some((role) => String(role || '').trim().toLowerCase() === 'admin');
            if (!isAdminProfile) {
                clearCredentialResetFlags();
                return false;
            }
            return true;
        };

        const maybeShowCredentialReset = () => {
            if (!shouldForceCredentialReset()) return;
            showCredentialResetOverlay();
        };

        const handleCredentialResetSave = async () => {
            if (!currentAuthProfile || !currentAuthProfile.id) {
                if (credentialResetError) credentialResetError.textContent = 'Missing session. Please log in again.';
                return;
            }
            const error = validateCredentialReset();
            if (error) {
                if (credentialResetError) credentialResetError.textContent = error;
                return;
            }
            if (!credentialResetSaveBtn) return;
            const unlock = window.withButtonLock ? window.withButtonLock(credentialResetSaveBtn, { label: 'Saving...' }) : null;
            try {
                const payload = {
                    username: credentialResetUsername?.value.trim() || '',
                    password: credentialResetPassword?.value || ''
                };
                const res = await fetch(`/api/accounts/${encodeURIComponent(currentAuthProfile.id)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(payload)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Failed to update credentials.');
                clearCredentialResetFlags();
                hideCredentialResetOverlay();
                await fetchAuthProfile();
            } catch (err) {
                if (credentialResetError) credentialResetError.textContent = err?.message || 'Unable to update credentials.';
            } finally {
                if (unlock) unlock();
            }
        };

        const bindLogo = (img, container, activeClass) => {
            if (!img || !container) return;

            const setState = () => {
                const hasImage = img.naturalWidth > 0 && img.naturalHeight > 0;
                container.classList.toggle(activeClass, hasImage);
            };
            const handleLoad = () => setState();
            const handleError = () => {
                container.classList.remove(activeClass);
                const fallback = DEFAULT_BUSINESS_PROFILE.logoUrl || '';
                if (fallback && img.getAttribute('src') !== fallback && img.dataset.fallbackApplied !== 'true') {
                    img.dataset.fallbackApplied = 'true';
                    img.setAttribute('src', fallback);
                }
            };

            if (img.complete) {
                setState();
            }

            img.addEventListener('load', handleLoad);
            img.addEventListener('error', handleError);

            addCleanup(() => {
                img.removeEventListener('load', handleLoad);
                img.removeEventListener('error', handleError);
            });
        };

        const readFileAsDataURL = (file) =>
            new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
                reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });

        let logoIntent = 'KEEP';
        let pendingLogoDataUrl = null;

        const deriveLogoPreviewSource = () => {
            if (logoIntent === 'FILE' && pendingLogoDataUrl) return pendingLogoDataUrl;
            return businessProfile.logoUrl || '';
        };

        const updateLogoPreview = () => {
            const previewSource = deriveLogoPreviewSource();
            const hasImage = Boolean(previewSource);

            if (profileEditLogoPreview) {
                profileEditLogoPreview.classList.toggle('profile-edit-logo__preview--has-image', hasImage);
            }

            if (profileEditLogoPreviewImage) {
                if (hasImage) {
                    profileEditLogoPreviewImage.src = previewSource;
                    profileEditLogoPreviewImage.removeAttribute('hidden');
                } else {
                    profileEditLogoPreviewImage.removeAttribute('src');
                    profileEditLogoPreviewImage.setAttribute('hidden', 'true');
                }
            }

            if (profileEditLogoPreviewFallback) {
                const referenceName = profileEditNameInput?.value?.trim() || businessProfile.businessName || DEFAULT_BUSINESS_PROFILE.businessName;
                profileEditLogoPreviewFallback.textContent = computeInitials(referenceName);
            }
        };

        if (profileEditLogoPreviewImage) {
            const previewErrorHandler = () => {
                if (logoIntent === 'FILE') {
                    pendingLogoDataUrl = null;
                    logoIntent = 'KEEP';
                }
                updateLogoPreview();
            };
            profileEditLogoPreviewImage.addEventListener('error', previewErrorHandler);
            addCleanup(() => profileEditLogoPreviewImage.removeEventListener('error', previewErrorHandler));
        }

        function populateProfileEditForm() {
            if (!profileEditForm) return;
            if (profileEditNameInput) {
                profileEditNameInput.value = businessProfile.businessName || DEFAULT_BUSINESS_PROFILE.businessName;
            }
            if (profileEditEmailInput) {
                profileEditEmailInput.value = businessProfile.supportEmail || '';
            }
            if (profileEditTaglineInput) {
                profileEditTaglineInput.value = businessProfile.tagline || '';
            }
            if (profileEditContactInput) {
                profileEditContactInput.value = businessProfile.contact || '';
            }
            if (profileEditAddressInput) {
                profileEditAddressInput.value = businessProfile.address || '';
            }
            if (profileEditLogoInput) {
                profileEditLogoInput.value = '';
            }
            pendingLogoDataUrl = null;
            logoIntent = 'KEEP';
            updateLogoPreview();
        }

        function closeProfileEditModal() {
            if (!profileEditModal) return;
            profileEditModal.setAttribute('hidden', '');
            profileEditModal.classList.remove('is-open');
            populateProfileEditForm();
        }

        function closeProfileViewModal(restoreFocus = true) {
            if (!profileModal) return;
            const wasOpen = profileModal.classList.contains('is-open');
            profileModal.setAttribute('hidden', '');
            profileModal.classList.remove('is-open');
            profileTrigger?.setAttribute('aria-expanded', 'false');
            if (restoreFocus && wasOpen && profileModal.contains(document.activeElement)) {
                profileTrigger?.focus({ preventScroll: true });
            }
        }

        function openProfileViewModal() {
            if (!profileModal) return;
            closeLogsModal();
            closeProfileEditModal();
            profileModal.removeAttribute('hidden');
            profileModal.classList.add('is-open');
            profileTrigger?.setAttribute('aria-expanded', 'true');
            if (profileModalContent) {
                profileModalContent.focus({ preventScroll: true });
            }
        }

        function openProfileEditModal() {
            if (!profileEditModal) return;
            populateProfileEditForm();
            closeProfileViewModal(false);
            closeLogsModal();
            profileEditModal.removeAttribute('hidden');
            profileEditModal.classList.add('is-open');
            profileEditNameInput?.focus({ preventScroll: true });
        }

        function handleProfileToggle() {
            if (!profileTrigger || !profileModal) return;
            if (profileModal.classList.contains('is-open')) {
                closeProfileViewModal();
            } else {
                openProfileViewModal();
            }
        }

        let exportInProgress = false;
        let importInProgress = false;
        let importInputEl = null;

        const parseFilenameFromDisposition = (contentDisposition) => {
            const raw = String(contentDisposition || '').trim();
            if (!raw) return '';
            const utf8Match = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
            if (utf8Match && utf8Match[1]) {
                try {
                    return decodeURIComponent(utf8Match[1]).replace(/["']/g, '').trim();
                } catch {
                    return utf8Match[1].replace(/["']/g, '').trim();
                }
            }
            const plainMatch = raw.match(/filename\s*=\s*("?)([^";]+)\1/i);
            if (plainMatch && plainMatch[2]) {
                return plainMatch[2].trim();
            }
            return '';
        };

        const triggerFullCustomerExport = async () => {
            if (exportInProgress) return;
            exportInProgress = true;
            const originalTooltip = exportBtn?.getAttribute('data-tooltip') || 'Export';
            if (exportBtn) {
                exportBtn.disabled = true;
                exportBtn.setAttribute('aria-busy', 'true');
                exportBtn.setAttribute('data-tooltip', 'Exporting...');
            }

            try {
                const response = await fetch('/api/export/customers-full', {
                    method: 'GET',
                    credentials: 'include'
                });

                if (!response.ok) {
                    let message = `Export failed (${response.status})`;
                    try {
                        const data = await response.json();
                        message = data?.error || data?.message || message;
                    } catch {
                        // ignore JSON parsing fallback
                    }
                    throw new Error(message);
                }

                const filename = parseFilenameFromDisposition(response.headers.get('content-disposition'))
                    || `customers-full-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = blobUrl;
                anchor.download = filename;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

                addActivityLog({ message: 'Exported full customer data', meta: filename });
                if (typeof window.appToast === 'function') {
                    window.appToast('Customer export downloaded.', { type: 'success' });
                }
            } catch (error) {
                console.error('Failed to export full customer data:', error);
                if (typeof window.appToast === 'function') {
                    window.appToast(error?.message || 'Failed to export customer data.', { type: 'error' });
                }
            } finally {
                exportInProgress = false;
                if (exportBtn) {
                    exportBtn.disabled = false;
                    exportBtn.removeAttribute('aria-busy');
                    exportBtn.setAttribute('data-tooltip', originalTooltip);
                }
            }
        };

        const triggerCustomerImportUpload = async (file) => {
            if (!file || importInProgress) return;
            importInProgress = true;
            const originalTooltip = importBtn?.getAttribute('data-tooltip') || 'Import';
            if (importBtn) {
                importBtn.disabled = true;
                importBtn.setAttribute('aria-busy', 'true');
                importBtn.setAttribute('data-tooltip', 'Importing...');
            }

            try {
                const response = await fetch('/api/import/customers-full', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'X-Import-Filename': encodeURIComponent(file.name || 'import.xlsx')
                    },
                    body: file
                });

                let payload = null;
                try {
                    payload = await response.json();
                } catch {
                    payload = null;
                }

                if (!response.ok) {
                    const message = payload?.error || payload?.message || `Import failed (${response.status})`;
                    throw new Error(message);
                }

                const imported = payload?.imported || {};
                const summary = [
                    `Customers: ${Number(imported.customers || 0)}`,
                    `Payments: ${Number(imported.payment_entries || 0)}`,
                    `Tickets: ${Number(imported.tickets || 0)}`,
                    `Jobs: ${Number(imported.jobs || 0)}`,
                    `SMS: ${Number(imported.sms_messages || 0)}`
                ].join(' | ');

                addActivityLog({ message: 'Imported customer export file', meta: summary });
                if (typeof window.appToast === 'function') {
                    window.appToast(`Import complete. ${summary}`, { type: 'success' });
                }

                const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
                if (warnings.length && typeof window.appToast === 'function') {
                    window.appToast(`${warnings.length} warning(s) during import.`, { type: 'warning' });
                }
            } catch (error) {
                console.error('Failed to import customer export file:', error);
                if (typeof window.appToast === 'function') {
                    window.appToast(error?.message || 'Failed to import customer data.', { type: 'error' });
                }
            } finally {
                importInProgress = false;
                if (importBtn) {
                    importBtn.disabled = false;
                    importBtn.removeAttribute('aria-busy');
                    importBtn.setAttribute('data-tooltip', originalTooltip);
                }
            }
        };

        const ensureImportInput = () => {
            if (importInputEl && importInputEl.isConnected) return importInputEl;
            importInputEl = document.createElement('input');
            importInputEl.type = 'file';
            importInputEl.accept = '.xlsx,.xls,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            importInputEl.hidden = true;
            document.body.appendChild(importInputEl);
            addListener(importInputEl, 'change', async () => {
                const file = importInputEl.files && importInputEl.files[0] ? importInputEl.files[0] : null;
                importInputEl.value = '';
                if (!file) return;
                await triggerCustomerImportUpload(file);
            });
            addCleanup(() => {
                if (importInputEl && importInputEl.isConnected) {
                    importInputEl.remove();
                }
                importInputEl = null;
            });
            return importInputEl;
        };

        const triggerFullCustomerImport = async () => {
            if (importInProgress) return;
            const confirmed = window.appConfirm
                ? await window.appConfirm(
                    'Import will restore customer records, payments, tickets, and jobs from an exported file. Continue?',
                    { title: 'Import Customer Data', okText: 'Import', cancelText: 'Cancel' }
                )
                : window.confirm('Import customer data from file?');
            if (!confirmed) return;
            const input = ensureImportInput();
            input.click();
        };

        const handleLogout = async () => {
            const confirmed = window.appConfirm
                ? await window.appConfirm('Are you sure you want to log out?', { title: 'Log Out' })
                : window.confirm('Are you sure you want to log out?');
            if (!confirmed) return;
            localStorage.removeItem('user-session');
            localStorage.removeItem('auth-token');
            clearCredentialResetFlags();
            try {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    credentials: 'include'
                });
            } catch (err) {
                console.warn('Logout request failed:', err);
            } finally {
                addActivityLog({ message: 'Logged out of the billing console', meta: 'Session ended' });
                window.location.href = 'login.html';
            }
        };

        const handleTopbarDataAction = async (actionName) => {
            const event = new CustomEvent(`topbar:${actionName}`, {
                bubbles: true,
                cancelable: true,
                detail: { action: actionName }
            });
            const handled = !document.dispatchEvent(event);
            if (handled) return;

            if (actionName === 'export') {
                await triggerFullCustomerExport();
                return;
            }

            if (actionName === 'import') {
                await triggerFullCustomerImport();
                return;
            }

            if (typeof window.appToast === 'function') {
                window.appToast('Action is not available on this page.', { type: 'info' });
            }
        };

        const openLogsModal = () => {
            if (!logsModal) return;
            renderActivityLog(activityLog);
            logsModal.removeAttribute('hidden');
            logsModal.classList.add('is-open');
            logsTrigger?.setAttribute('aria-expanded', 'true');
            closeProfileViewModal(false);
        };

        const closeLogsModal = () => {
            if (!logsModal) return;
            logsModal.setAttribute('hidden', '');
            logsModal.classList.remove('is-open');
            logsTrigger?.setAttribute('aria-expanded', 'false');
        };

        const handleLogoFileChange = () => {
            if (!profileEditLogoInput) return;
            const file = profileEditLogoInput.files?.[0];
            pendingLogoDataUrl = null;
            if (!file) {
                logoIntent = 'KEEP';
                updateLogoPreview();
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                pendingLogoDataUrl = typeof reader.result === 'string' ? reader.result : '';
                if (pendingLogoDataUrl) {
                    logoIntent = 'FILE';
                }
                updateLogoPreview();
            };
            reader.onerror = () => {
                pendingLogoDataUrl = null;
                logoIntent = 'KEEP';
                updateLogoPreview();
            };
            reader.readAsDataURL(file);
        };

        const handleProfileEditSubmit = async (event) => {
            event.preventDefault();
            if (!profileEditForm) return;

            if (profileEditSaveBtn) {
                profileEditSaveBtn.disabled = true;
                profileEditSaveBtn.setAttribute('aria-busy', 'true');
            }

            try {
                const name = profileEditNameInput?.value?.trim() || DEFAULT_BUSINESS_PROFILE.businessName;
                const taglineValue = profileEditTaglineInput?.value?.trim() || '';
                const emailValue = profileEditEmailInput?.value?.trim() || '';
                const contactValue = profileEditContactInput?.value?.trim() || '';
                const addressValue = profileEditAddressInput?.value?.trim() || '';

                let nextLogoUrl = businessProfile.logoUrl || '';

                if (logoIntent === 'FILE') {
                    const file = profileEditLogoInput?.files?.[0] || null;
                    if (pendingLogoDataUrl) {
                        nextLogoUrl = pendingLogoDataUrl;
                    } else if (file) {
                        nextLogoUrl = await readFileAsDataURL(file);
                    }
                }

                businessProfile = {
                    ...businessProfile,
                    businessName: name,
                    tagline: taglineValue,
                    supportEmail: emailValue,
                    contact: contactValue,
                    address: addressValue,
                    logoUrl: nextLogoUrl
                };

                saveBusinessProfile(businessProfile);

                const persisted = await persistBusinessProfileToApi(businessProfile);
                if (persisted) {
                    businessProfile = persisted;
                    saveBusinessProfile(businessProfile);
                }

                applyBusinessProfile();
                addActivityLog({ message: 'Updated business profile', meta: 'Brand settings saved' });

                pendingLogoDataUrl = null;
                logoIntent = 'KEEP';
                if (profileEditLogoInput) profileEditLogoInput.value = '';
                updateLogoPreview();
                closeProfileEditModal();
            } catch (error) {
                console.error('Business profile update failed:', error);
                addActivityLog({ message: 'Business profile update failed', meta: 'Please try again' });
            } finally {
                if (profileEditSaveBtn) {
                    profileEditSaveBtn.disabled = false;
                    profileEditSaveBtn.removeAttribute('aria-busy');
                }
            }
        };

        applyBusinessProfile();
        bindLogo(logoImage, logoContainer, 'logo-chip--has-image');
        bindLogo(profileBrandingImage, profileBrandingLogo, 'profile-modal__branding-logo--has-image');
        populateProfileEditForm();
        fetchBusinessProfileFromApi();
        fetchAuthProfile().then(() => maybeShowCredentialReset());

        const renderActivityLog = (entries) => {
            if (!logsList) return;
            logsList.innerHTML = '';
            if (!entries || !entries.length) {
                const empty = document.createElement('li');
                empty.className = 'empty';
                empty.textContent = 'No activity yet.';
                logsList.appendChild(empty);
                return;
            }
            entries.forEach((entry) => {
                const item = document.createElement('li');
                item.className = 'logs-modal__item';

                const message = document.createElement('span');
                message.className = 'logs-modal__message';
                message.textContent = entry.message;
                item.appendChild(message);

                const metaText = formatActivityLogMeta(entry);
                const absoluteTime = formatActivityLogTimestamp(entry);
                const combinedMeta = absoluteTime ? (metaText ? `${metaText} · ${absoluteTime}` : absoluteTime) : metaText;
                if (combinedMeta) {
                    const meta = document.createElement('span');
                    meta.className = 'logs-modal__time';
                    meta.textContent = combinedMeta || metaText;
                    item.appendChild(meta);
                }

                logsList.appendChild(item);
            });
        };

        const handleGlobalKeydown = (event) => {
            if (event.key === 'Escape') {
                closeMobileSidebar();
                closeProfileViewModal();
                closeLogsModal();
                closeProfileEditModal();
            }
        };

        addCleanup(registerActivityLogListener(renderActivityLog));
        addListener(logsTrigger, 'click', () => {
            if (!logsModal) return;
            if (logsModal.classList.contains('is-open')) {
                closeLogsModal();
            } else {
                openLogsModal();
            }
        });
        addListener(logsClearBtn, 'click', () => clearActivityLog());
        logsCloseEls.forEach((el) => addListener(el, 'click', closeLogsModal));
        addListener(logsModal, 'keydown', (event) => {
            if (event.key === 'Escape') {
                closeLogsModal();
            }
        });
        addListener(profileTrigger, 'click', handleProfileToggle);
        addListener(profileTrigger, 'keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleProfileToggle();
            }
        });
        addListener(profileModal, 'click', (event) => {
            if (event.target?.hasAttribute?.('data-profile-close')) {
                closeProfileViewModal();
            }
        });
        addListener(profileModal, 'keydown', (event) => {
            if (event.key === 'Escape') {
                closeProfileViewModal();
            }
        });
        profileModalCloseEls.forEach((el) => addListener(el, 'click', () => closeProfileViewModal()));
        addListener(profileEditBtn, 'click', openProfileEditModal);
        addListener(profileEditModal, 'click', (event) => {
            if (event.target?.hasAttribute?.('data-profile-edit-close')) {
                closeProfileEditModal();
            }
        });
        profileEditCloseEls.forEach((el) => addListener(el, 'click', closeProfileEditModal));
        addListener(profileEditModal, 'keydown', (event) => {
            if (event.key === 'Escape') {
                closeProfileEditModal();
            }
        });
        addListener(profileEditForm, 'submit', handleProfileEditSubmit);
        addListener(profileEditLogoInput, 'change', handleLogoFileChange);
        addListener(profileEditNameInput, 'input', () => updateLogoPreview());
        addListener(credentialResetForm, 'submit', (event) => {
            event.preventDefault();
            handleCredentialResetSave();
        });
        addListener(importBtn, 'click', () => handleTopbarDataAction('import'));
        addListener(exportBtn, 'click', () => handleTopbarDataAction('export'));
        addListener(logoutBtn, 'click', handleLogout);
        addListener(sidebarToggleBtn, 'click', (event) => {
            event.preventDefault();
            toggleMobileSidebar();
        });
        addListener(document, 'keydown', handleGlobalKeydown);

        closeProfileViewModal(false);
        closeLogsModal();
        closeProfileEditModal();
        setSidebarToggleState(document.body.classList.contains(SIDEBAR_OPEN_CLASS));

        detachTopbarInteractions = () => {
            cleanupFns.forEach((fn) => {
                try {
                    fn();
                } catch {
                    // ignore individual cleanup errors
                }
            });
            detachTopbarInteractions = null;
        };
    };

    const loadPartial = (host, url, onReady) => {
        if (!host) return;
        fetch(url, { cache: 'no-store' })
            .then((response) => response.text())
            .then((html) => {
                host.innerHTML = html;
                if (url === 'topbar.html') {
                    const profileModalEl = host.querySelector('#profileModal');
                    if (profileModalEl) {
                        const existingProfileModal = document.getElementById('profileModal');
                        if (existingProfileModal && existingProfileModal !== profileModalEl) {
                            existingProfileModal.remove();
                        }
                        profileModalEl.setAttribute('hidden', '');
                        profileModalEl.classList.remove('is-open');
                        document.body.appendChild(profileModalEl);
                    }
                    const profileEditModalEl = host.querySelector('#profileEditModal');
                    if (profileEditModalEl) {
                        const existingProfileEdit = document.getElementById('profileEditModal');
                        if (existingProfileEdit && existingProfileEdit !== profileEditModalEl) {
                            existingProfileEdit.remove();
                        }
                        profileEditModalEl.setAttribute('hidden', '');
                        profileEditModalEl.classList.remove('is-open');
                        document.body.appendChild(profileEditModalEl);
                    }
                    const logsModalEl = host.querySelector('#logsModal');
                    if (logsModalEl) {
                        const existingLogs = document.getElementById('logsModal');
                        if (existingLogs && existingLogs !== logsModalEl) {
                            existingLogs.remove();
                        }
                        logsModalEl.setAttribute('hidden', '');
                        logsModalEl.classList.remove('is-open');
                        document.body.appendChild(logsModalEl);
                    }
                    const credentialResetEl = host.querySelector('#credentialResetOverlay');
                    if (credentialResetEl) {
                        const existingReset = document.getElementById('credentialResetOverlay');
                        if (existingReset && existingReset !== credentialResetEl) {
                            existingReset.remove();
                        }
                        credentialResetEl.setAttribute('hidden', '');
                        document.body.appendChild(credentialResetEl);
                    }
                }
                if (typeof onReady === 'function') onReady(host);
                applyTheme(currentTheme);
            })
            .catch(() => {
                host.innerHTML = '';
            });
    };

    const isFlavorFeatureDisabled = (featureKey) => Boolean(
        featureKey && window.flavorFeatures && window.flavorFeatures[featureKey] === false
    );

    const applySidebarFeatureVisibility = (root = sidebarHost) => {
        if (!root || !window.flavorFeatures) return;
        root.querySelectorAll('[data-feature]').forEach((item) => {
            const featureKey = item.getAttribute('data-feature');
            if (featureKey === 'mikrotikPppoe') {
                item.hidden = !window.mikrotikEnabled || isFlavorFeatureDisabled(featureKey);
                return;
            }
            if (featureKey === 'genieacs') {
                item.hidden = !window.genieacsEnabled || isFlavorFeatureDisabled(featureKey);
                return;
            }
            item.hidden = isFlavorFeatureDisabled(featureKey);
        });
        root.querySelectorAll('.sidebar-menu').forEach((menu) => {
            const items = Array.from(menu.querySelectorAll('li[data-feature]'));
            menu.hidden = Boolean(items.length && items.every((item) => item.hidden));
        });
    };

    const setMikrotikSidebarVisibility = (enabled) => {
        const pppoeItem = document.querySelector('[data-feature="mikrotikPppoe"]');
        const menu = pppoeItem?.closest('.sidebar-menu');
        const shouldShow = Boolean(enabled) && !isFlavorFeatureDisabled('mikrotikPppoe');
        if (pppoeItem) {
            pppoeItem.hidden = !shouldShow;
        }
        if (menu) {
            const items = Array.from(menu.querySelectorAll('li[data-feature]'));
            menu.hidden = !shouldShow || Boolean(items.length && items.every((item) => item.hidden));
        }
    };

    const setGenieacsSidebarVisibility = (enabled) => {
        const genieacsItem = document.querySelector('[data-feature="genieacs"]');
        const menu = genieacsItem?.closest('.sidebar-menu');
        const shouldShow = Boolean(enabled) && !isFlavorFeatureDisabled('genieacs');
        if (genieacsItem) {
            genieacsItem.hidden = !shouldShow;
        }
        if (menu) {
            const items = Array.from(menu.querySelectorAll('li[data-feature]'));
            menu.hidden = Boolean(items.length && items.every((item) => item.hidden));
        }
    };

    const hasMikrotikRouterCredentials = (router = {}) => {
        const address = String(router?.address || '').trim();
        const username = String(router?.username || '').trim();
        const password = String(router?.password ?? '').trim();
        return Boolean(address && username && password);
    };

    const hasMikrotikPppoeAccounts = (settings = {}) => {
        const accounts = Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [];
        return accounts.some((account) => {
            const username = String(account?.username || account?.name || account?.user || '').trim();
            const secretId = String(account?.secretId || account?.id || account?.mikrotikId || '').trim();
            return Boolean(username || secretId);
        });
    };

    const hasGenieacsCredentials = (settings = {}) => {
        const host = String(settings?.host || '').trim();
        const usernameSet = Boolean(settings?.usernameSet || String(settings?.username || '').trim());
        const passwordSet = Boolean(settings?.passwordSet || String(settings?.password ?? '').trim());
        return Boolean(host && usernameSet && passwordSet);
    };

    const resolveGenieacsEnabledState = (settings = {}) => {
        const genieacs = settings?.genieacs || {};
        const enabled = Boolean(genieacs.enabled && hasGenieacsCredentials(genieacs));
        return {
            enabled,
            globalEnabled: Boolean(genieacs.enabled),
            hasCredentials: hasGenieacsCredentials(genieacs),
            settings: genieacs
        };
    };

    const resolveMikrotikEnabledState = (settings = {}) => {
        const globalEnabled = Boolean(settings?.mikrotik?.enabled);
        const routers = Array.isArray(settings?.mikrotikRouters) ? settings.mikrotikRouters : [];
        const hasRouter = Boolean(globalEnabled && routers.some((router) => (
            router?.enabled !== false && hasMikrotikRouterCredentials(router)
        )));
        const legacyEnabled = Boolean(globalEnabled && hasMikrotikRouterCredentials(settings?.mikrotik || {}));
        const hasAccounts = hasMikrotikPppoeAccounts(settings);
        const hasUsableRouter = hasRouter || legacyEnabled;
        return {
            enabled: Boolean(hasUsableRouter),
            globalEnabled,
            hasRouter,
            legacyEnabled,
            hasUsableRouter,
            hasAccounts,
            routers
        };
    };

    window.resolveGenieacsEnabledState = resolveGenieacsEnabledState;
    window.fetchGenieacsEnabledState = async () => {
        const response = await fetch('/api/integrations', { credentials: 'include', cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        const settings = payload?.settings || {};
        return {
            ...resolveGenieacsEnabledState(settings),
            allSettings: settings
        };
    };

    window.resolveMikrotikEnabledState = resolveMikrotikEnabledState;
    window.fetchMikrotikEnabledState = async () => {
        const response = await fetch('/api/integrations', { credentials: 'include', cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        const settings = payload?.settings || {};
        return {
            ...resolveMikrotikEnabledState(settings),
            settings
        };
    };

    const syncGenieacsSidebar = async () => {
        try {
            const response = await fetch('/api/integrations', { credentials: 'include', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            const settings = payload?.settings || {};
            const enabled = Boolean(resolveGenieacsEnabledState(settings).enabled);
            window.genieacsEnabled = enabled;
            setGenieacsSidebarVisibility(enabled);
        } catch (err) {
            window.genieacsEnabled = false;
            setGenieacsSidebarVisibility(false);
            console.warn('Failed to sync GenieACS sidebar link:', err);
        }
    };

    const syncMikrotikSidebar = async () => {
        try {
            const response = await fetch('/api/integrations', { credentials: 'include', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            const settings = payload?.settings || {};
            const enabled = Boolean(resolveMikrotikEnabledState(settings).enabled);
            window.mikrotikEnabled = enabled;
            setMikrotikSidebarVisibility(enabled);
        } catch (err) {
            window.mikrotikEnabled = false;
            setMikrotikSidebarVisibility(false);
            console.warn('Failed to sync MikroTik sidebar link:', err);
        }
    };

    window.syncGenieacsSidebar = syncGenieacsSidebar;
    window.syncMikrotikSidebar = syncMikrotikSidebar;

    const formatSidebarWorkCount = (value) => {
        const count = Number(value);
        if (!Number.isFinite(count) || count <= 0) return '';
        return count > 99 ? '99+' : String(Math.trunc(count));
    };

    const setSidebarWorkBadge = (type, value) => {
        const badge = sidebarHost?.querySelector(`[data-sidebar-work-badge="${type}"]`);
        if (!badge) return;

        const count = Math.max(0, Math.trunc(Number(value) || 0));
        const label = type === 'tickets'
            ? 'unassigned customer-submitted tickets'
            : 'unassigned customer-submitted jobs';

        if (!count) {
            badge.textContent = '0';
            badge.hidden = true;
            badge.removeAttribute('aria-label');
            badge.removeAttribute('title');
            return;
        }

        badge.textContent = formatSidebarWorkCount(count);
        badge.hidden = false;
        badge.setAttribute('aria-label', `${count} ${label}`);
        badge.setAttribute('title', `${count} ${label}`);
    };

    const ensureSidebarMenuToggleContent = (toggle) => {
        if (!toggle) return null;
        let content = toggle.querySelector('.menu-toggle__content');
        if (content) return content;

        const labelText = String(toggle.textContent || '').trim();
        toggle.textContent = '';
        content = document.createElement('span');
        content.className = 'menu-toggle__content';
        const label = document.createElement('span');
        label.className = 'menu-toggle__label';
        label.textContent = labelText;
        content.appendChild(label);
        toggle.appendChild(content);
        return content;
    };

    const ensureSidebarWorkDot = (toggle) => {
        const content = ensureSidebarMenuToggleContent(toggle);
        if (!content) return null;
        let dot = content.querySelector('.sidebar-category-dot');
        if (!dot) {
            dot = document.createElement('span');
            dot.className = 'sidebar-category-dot';
            dot.hidden = true;
            dot.setAttribute('aria-hidden', 'true');
            content.appendChild(dot);
        }
        return dot;
    };

    const setSidebarWorkGroupIndicator = (counts = {}) => {
        const ticketCount = Math.max(0, Math.trunc(Number(counts?.tickets) || 0));
        const jobCount = Math.max(0, Math.trunc(Number(counts?.jobs) || 0));
        const technicianMenu = sidebarHost?.querySelector('[data-sidebar-work-badge="tickets"]')?.closest('.sidebar-menu')
            || sidebarHost?.querySelector('[data-sidebar-work-badge="jobs"]')?.closest('.sidebar-menu');
        if (!technicianMenu) return;
        const total = ticketCount + jobCount;
        technicianMenu.classList.toggle('has-work-alert', total > 0);
        technicianMenu.dataset.workCount = total > 0 ? String(total) : '';
        const toggle = technicianMenu.querySelector('.menu-toggle');
        const dot = ensureSidebarWorkDot(toggle);
        if (dot) {
            dot.hidden = total <= 0;
        }
        if (toggle) {
            if (total > 0) {
                toggle.setAttribute('data-work-alert-label', `${total} unassigned item${total === 1 ? '' : 's'}`);
                toggle.setAttribute('title', `${total} unassigned ticket/job item${total === 1 ? '' : 's'}`);
            } else {
                toggle.removeAttribute('data-work-alert-label');
                toggle.removeAttribute('title');
            }
        }
    };

    const clearSidebarWorkBadges = () => {
        setSidebarWorkBadge('tickets', 0);
        setSidebarWorkBadge('jobs', 0);
        setSidebarWorkGroupIndicator({ tickets: 0, jobs: 0 });
    };

    const syncSidebarWorkBadges = async () => {
        if (!sidebarHost?.querySelector('[data-sidebar-work-badge]')) return;
        try {
            const response = await fetch('/api/sidebar/work-counts', { credentials: 'include', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.ok === false) {
                throw new Error(payload?.error || 'Failed to load sidebar work counts');
            }
            const counts = payload?.counts || {};
            setSidebarWorkBadge('tickets', counts.tickets);
            setSidebarWorkBadge('jobs', counts.jobs);
            setSidebarWorkGroupIndicator(counts);
            sidebarWorkBadgeWarned = false;
        } catch (err) {
            clearSidebarWorkBadges();
            if (!sidebarWorkBadgeWarned) {
                console.warn('Failed to sync sidebar work badges:', err);
                sidebarWorkBadgeWarned = true;
            }
        }
    };

    const startSidebarWorkBadgeSync = () => {
        if (sidebarWorkBadgeTimer) {
            clearInterval(sidebarWorkBadgeTimer);
            sidebarWorkBadgeTimer = null;
        }
        syncSidebarWorkBadges();
        sidebarWorkBadgeTimer = setInterval(() => {
            if (!document.hidden) {
                syncSidebarWorkBadges();
            }
        }, SIDEBAR_WORK_BADGE_REFRESH_MS);
    };

    window.refreshSidebarWorkBadges = syncSidebarWorkBadges;
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            syncSidebarWorkBadges();
        }
    });

    if (sidebarHost) {
        const overlay = ensureSidebarOverlay();
        overlay.addEventListener('click', () => closeMobileSidebar());
    }

    window.addEventListener('resize', syncMobileSidebarViewport);

    loadPartial(topbarHost, 'topbar.html', (host) => {
        if (HIDE_TOPBAR_MENU_ICON) {
            host.querySelector('#topbarMenuToggle')?.remove();
        }
        bindThemeToggle(host);
        bindGlobalSearch(host);
        initTopbarInteractions(host);
        dockTopbarIntoSidebar();
        syncShellTheme();
        syncMobileSidebarViewport();
    });

    loadPartial(sidebarHost, 'sidebar.html', async (root) => {
        dockTopbarIntoSidebar();
        try {
            const response = await fetch('/api/flavor/features', { credentials: 'include', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            const features = payload?.features || {};
            window.flavorFeatures = features;
            applyFlavorMetadata(payload);
            applySidebarFeatureVisibility(root);
        } catch (err) {
            console.warn('Failed to sync flavor feature checklist:', err);
        }

        const normalized = currentPath === ''
            ? 'index.html'
            : (currentPath.includes('.') ? currentPath : `${currentPath}.html`);
        const links = root.querySelectorAll('.sidebar-menu a');
        root.querySelectorAll('.sidebar-menu li').forEach((item) => item.classList.add('nav-item'));
        links.forEach((link) => {
            link.classList.add('nav-link');
            link.querySelector('i')?.classList.add('nav-link-icon');
        });
        const currentHash = window.location.hash || '';
        let matched = false;
        links.forEach((link) => {
            const target = String(link.getAttribute('href') || '').trim();
            const [targetPath, targetHash = ''] = target.split('#');
            const normalizedTargetPath = targetPath || normalized;
            const hashValue = targetHash ? `#${targetHash}` : '';
            const isHashMatch = targetHash
                ? (normalizedTargetPath === normalized && hashValue === currentHash)
                : (!currentHash && target === normalized);
            if (isHashMatch) {
                link.classList.add('active');
                matched = true;
            }
        });
        if (!matched && normalized === 'index.html') {
            const homeLink = root.querySelector('.sidebar-menu a[href="index.html"]');
            if (homeLink) homeLink.classList.add('active');
        }
        links.forEach((link) => {
            const isActive = link.classList.contains('active');
            link.closest('li')?.classList.toggle('active', isActive);
            if (isActive) {
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        });

        const sidebarMenus = Array.from(root.querySelectorAll('.sidebar-menu'));
        const accordionMenus = [];
        const isMenuVisible = (menu) => Boolean(menu) && !menu.hidden;
        const openSidebarMenus = new Set();

        const isSidebarMenuOpen = (menu) => isMenuVisible(menu) && openSidebarMenus.has(menu);

        const applyOpenSidebarMenus = () => {
            accordionMenus.forEach((menu) => {
                const isOpen = isSidebarMenuOpen(menu);
                const toggle = menu.querySelector('.menu-toggle');
                menu.classList.toggle('is-collapsed', !isOpen);
                menu.classList.toggle('is-pinned-open', isOpen);
                menu.classList.toggle('is-secondary-open', false);
                if (toggle) {
                    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                }
            });
        };

        const setSidebarMenuOpen = (menu, shouldOpen) => {
            if (!isMenuVisible(menu)) {
                openSidebarMenus.delete(menu);
            } else if (shouldOpen) {
                openSidebarMenus.add(menu);
            } else {
                openSidebarMenus.delete(menu);
            }
            applyOpenSidebarMenus();
        };

        const toggleSidebarMenu = (menu) => {
            if (!isMenuVisible(menu)) return;
            setSidebarMenuOpen(menu, !isSidebarMenuOpen(menu));
        };

        sidebarMenus.forEach((menu, index) => {
            const list = menu.querySelector('ul');
            if (!list) return;
            const menuLinks = Array.from(list.querySelectorAll('a[href]'));
            if (!menuLinks.length) return;
            const label = menu.querySelector('.menu-toggle, .menu-label');
            if (!label) return;

            let toggle = label;
            if (!label.classList.contains('menu-toggle')) {
                toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'menu-toggle';
                const content = document.createElement('span');
                content.className = 'menu-toggle__content';
                const text = document.createElement('span');
                text.className = 'menu-toggle__label';
                text.textContent = label.textContent.trim();
                content.appendChild(text);
                toggle.appendChild(content);
                label.replaceWith(toggle);
            } else {
                toggle.type = 'button';
                ensureSidebarMenuToggleContent(toggle);
            }

            if (!list.id) {
                list.id = `sidebarMenuGroup${index + 1}`;
            }
            toggle.setAttribute('aria-controls', list.id);
            toggle.setAttribute('aria-expanded', 'false');
            accordionMenus.push(menu);
        });

        accordionMenus
            .filter((menu) => menu.querySelector('a.active') && isMenuVisible(menu))
            .forEach((menu) => openSidebarMenus.add(menu));
        applyOpenSidebarMenus();

        accordionMenus.forEach((menu) => {
            const toggle = menu.querySelector('.menu-toggle');
            toggle?.addEventListener('click', () => {
                toggleSidebarMenu(menu);
            });
        });

        links.forEach((link) => {
            link.addEventListener('click', () => {
                if (isMobileSidebarViewport()) {
                    closeMobileSidebar();
                }
            });
        });
        startSidebarWorkBadgeSync();
        syncShellTheme();
        Promise.allSettled([
            syncGenieacsSidebar(),
            syncMikrotikSidebar()
        ]).finally(() => {
            applySidebarFeatureVisibility(root);
            setGenieacsSidebarVisibility(window.genieacsEnabled);
            setMikrotikSidebarVisibility(window.mikrotikEnabled);
            Array.from(openSidebarMenus).forEach((menu) => {
                if (!isMenuVisible(menu)) {
                    openSidebarMenus.delete(menu);
                }
            });
            accordionMenus
                .filter((menu) => menu.querySelector('a.active') && isMenuVisible(menu))
                .forEach((menu) => openSidebarMenus.add(menu));
            applyOpenSidebarMenus();
        });
        syncMobileSidebarViewport();
    });

    syncMobileSidebarViewport();
    applyTheme(currentTheme);
    fetchActivityLogFromApi();

    prefersDark.addEventListener('change', (event) => {
        if (localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(LEGACY_THEME_STORAGE_KEY)) return;
        currentTheme = event.matches ? 'dark' : 'light';
        applyTheme(currentTheme);
    });

    window.appActivityLog = {
        add: addActivityLog,
        clear: clearActivityLog,
        getAll: () => [...activityLog]
    };
});
