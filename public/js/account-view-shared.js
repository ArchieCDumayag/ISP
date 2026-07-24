(function (global) {
    'use strict';

    const pesoSign = '\u20B1';
    const MANILA_TIME_ZONE = 'Asia/Manila';
    const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
    const SQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    const ISO_DATETIME_NO_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
    const MANILA_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
        timeZone: MANILA_TIME_ZONE,
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
    const MANILA_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
        timeZone: MANILA_TIME_ZONE,
        hour: 'numeric',
        minute: '2-digit'
    });
    const MANILA_YEAR_FORMATTER = new Intl.DateTimeFormat('en-US', {
        timeZone: MANILA_TIME_ZONE,
        year: 'numeric'
    });

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const titleCase = (value) => {
        const text = String(value || '').trim().toLowerCase();
        if (!text) return '';
        return text.charAt(0).toUpperCase() + text.slice(1);
    };

    const formatText = (value, fallback = 'Not set') => {
        const text = String(value ?? '').trim();
        return text || fallback;
    };

    const UNAVAILABLE_BROWSER_TARGETS = new Set(['', '-', 'n/a', 'na', 'none', 'not set']);
    const IPV4_WITH_PORT_RE = /\b((?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))(?::(\d{1,5}))?\b/;
    const IPV6_HOST_RE = /^[0-9a-f:]+$/i;

    const isUnavailableBrowserTarget = (value) =>
        UNAVAILABLE_BROWSER_TARGETS.has(String(value || '').trim().toLowerCase());

    const sanitizeDirectWifiTargetValue = (value) => {
        const text = String(value || '').trim();
        return text && !isUnavailableBrowserTarget(text) ? text : '';
    };

    const normalizeBrowserPort = (port) => {
        const num = Number(port);
        if (!Number.isInteger(num) || num < 1 || num > 65535) return '';
        return String(num);
    };

    const parseIpv4Parts = (value) => {
        const host = String(value || '').trim();
        if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return null;
        const parts = host.split('.').map((part) => Number(part));
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
        return parts;
    };

    const isPrivateOrCgnatHost = (value) => {
        const host = String(value || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
        const ipv4 = parseIpv4Parts(host);
        if (ipv4) {
            const [a, b] = ipv4;
            return a === 10
                || (a === 172 && b >= 16 && b <= 31)
                || (a === 192 && b === 168)
                || (a === 100 && b >= 64 && b <= 127);
        }
        return host.startsWith('fc') || host.startsWith('fd');
    };

    const isLocalOrLanAppHost = () => {
        const host = String(window.location.hostname || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
        if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
        return isPrivateOrCgnatHost(host);
    };

    const buildIpBrowserProxyUrl = (urlValue) => {
        try {
            const parsed = new URL(urlValue);
            const protocol = parsed.protocol.replace(':', '').toLowerCase();
            if (protocol !== 'http' && protocol !== 'https') return '';
            return `/api/ip-browser/proxy/${protocol}/${encodeURIComponent(parsed.host)}${parsed.pathname || '/'}${parsed.search || ''}`;
        } catch (_error) {
            return '';
        }
    };

    const withIpBrowserProxyUrl = (target) => {
        if (!target?.url) return target;
        return {
            ...target,
            proxyUrl: buildIpBrowserProxyUrl(target.url)
        };
    };

    const buildIpBrowserTarget = (value) => {
        const raw = String(value || '').trim();
        if (isUnavailableBrowserTarget(raw)) return null;

        if (/^https?:\/\//i.test(raw)) {
            try {
                const parsed = new URL(raw);
                const host = String(parsed.hostname || '').replace(/^\[|\]$/g, '');
                const isIpv4 = IPV4_WITH_PORT_RE.test(host);
                const isIpv6 = host.includes(':') && IPV6_HOST_RE.test(host);
                if (!isIpv4 && !isIpv6) return null;
                return withIpBrowserProxyUrl({
                    url: parsed.href,
                    label: parsed.host || host
                });
            } catch (_error) {
                return null;
            }
        }

        const ipv4Match = raw.match(IPV4_WITH_PORT_RE);
        if (ipv4Match) {
            const host = ipv4Match[1];
            const port = normalizeBrowserPort(ipv4Match[2]);
            return withIpBrowserProxyUrl({
                url: `http://${host}${port ? `:${port}` : ''}/`,
                label: `${host}${port ? `:${port}` : ''}`
            });
        }

        const ipv6Candidate = raw.replace(/^\[|\]$/g, '').split(/[/?#]/)[0];
        if (ipv6Candidate.includes(':') && IPV6_HOST_RE.test(ipv6Candidate)) {
            return withIpBrowserProxyUrl({
                url: `http://[${ipv6Candidate}]/`,
                label: `[${ipv6Candidate}]`
            });
        }

        return null;
    };

    const syncBrowserPlayerTriggers = (root = document) => {
        const scope = root || document;
        scope.querySelectorAll?.('[data-browser-player-ip]').forEach((node) => {
            const explicit = String(node.dataset.browserPlayerSource || '').trim();
            const target = buildIpBrowserTarget(explicit || node.textContent);
            const disabled = !target;
            node.dataset.browserPlayerUrl = target?.url || '';
            node.dataset.browserPlayerLabel = target?.label || '';
            node.classList.toggle('is-disabled', disabled);
            node.setAttribute('aria-disabled', disabled ? 'true' : 'false');
            node.setAttribute('aria-label', disabled ? 'Assigned IP not available' : `Open ${target.label} in browser player`);
            node.setAttribute('title', disabled ? 'Assigned IP not available' : `Open ${target.label}`);
        });
    };

    const isDirectWifiEnabled = () => Boolean(global.directWifiEnabled ?? global.isDanteFlavor);

    let browserPlayerModal = null;
    let browserPlayerFrame = null;
    let browserPlayerTitle = null;
    let browserPlayerSubtitle = null;
    let browserPlayerStatus = null;
    let browserPlayerOpenLink = null;
    let browserPlayerRefreshBtn = null;
    let browserPlayerLoadTimer = null;
    let browserPlayerTargetUrl = '';
    let browserPlayerDelegatesReady = false;
    let wifiChangeModal = null;
    let wifiChangeForm = null;
    let wifiChangeSubtitle = null;
    let wifiChangeSaveBtn = null;
    let wifiChangeDevice = null;
    let wifiChangeMode = 'genieacs';
    let wifiChangeAccountNumber = '';
    let wifiChangeTargetUrl = '';
    let wifiChangeInputs = {};
    let connectedDevicesModal = null;
    let connectedDevicesTitle = null;
    let connectedDevicesSubtitle = null;
    let connectedDevicesBody = null;
    let connectedDevicesStatus = null;

    const setBrowserPlayerLoading = (isLoading, text = '') => {
        if (!browserPlayerStatus) return;
        browserPlayerStatus.hidden = !isLoading && !text;
        browserPlayerStatus.textContent = text || (isLoading ? 'Loading device page...' : '');
        browserPlayerStatus.classList.toggle('is-loading', Boolean(isLoading));
    };

    const closeBrowserPlayer = () => {
        if (!browserPlayerModal) return;
        window.clearTimeout(browserPlayerLoadTimer);
        browserPlayerLoadTimer = null;
        browserPlayerTargetUrl = '';
        browserPlayerModal.classList.remove('is-open');
        browserPlayerModal.setAttribute('aria-hidden', 'true');
        browserPlayerModal.setAttribute('hidden', '');
        document.body.classList.remove('account-browser-player-open');
        if (browserPlayerFrame) browserPlayerFrame.src = 'about:blank';
        setBrowserPlayerLoading(false);
    };

    const ensureBrowserPlayerModal = () => {
        if (browserPlayerModal) return browserPlayerModal;

        const modal = document.createElement('div');
        modal.id = 'accountBrowserPlayerModal';
        modal.className = 'account-browser-player';
        modal.setAttribute('hidden', '');
        modal.setAttribute('aria-hidden', 'true');
        modal.innerHTML = `
            <div class="account-browser-player__backdrop" data-browser-player-close></div>
            <section class="account-browser-player__panel" role="dialog" aria-modal="true" aria-labelledby="accountBrowserPlayerTitle">
                <header class="account-browser-player__header">
                    <div class="account-browser-player__title-block">
                        <p class="account-browser-player__eyebrow">Browser Player</p>
                        <h2 id="accountBrowserPlayerTitle">Assigned IP</h2>
                        <p class="account-browser-player__subtitle" data-browser-player-subtitle></p>
                    </div>
                    <div class="account-browser-player__actions">
                        <a class="account-browser-player__action" data-browser-player-open href="#" target="_blank" rel="noopener" aria-label="Open in new tab" title="Open in new tab">
                            <i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i>
                            <span>Open Tab</span>
                        </a>
                        <button type="button" class="account-browser-player__action" data-browser-player-refresh aria-label="Refresh" title="Refresh">
                            <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="account-browser-player__close" data-browser-player-close aria-label="Close" title="Close">
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                    </div>
                </header>
                <div class="account-browser-player__body">
                    <iframe class="account-browser-player__frame" title="Assigned IP browser" referrerpolicy="no-referrer"></iframe>
                    <div class="account-browser-player__status" data-browser-player-status hidden></div>
                </div>
            </section>
        `;
        document.body.appendChild(modal);

        browserPlayerModal = modal;
        browserPlayerFrame = modal.querySelector('.account-browser-player__frame');
        browserPlayerTitle = modal.querySelector('#accountBrowserPlayerTitle');
        browserPlayerSubtitle = modal.querySelector('[data-browser-player-subtitle]');
        browserPlayerStatus = modal.querySelector('[data-browser-player-status]');
        browserPlayerOpenLink = modal.querySelector('[data-browser-player-open]');
        browserPlayerRefreshBtn = modal.querySelector('[data-browser-player-refresh]');

        modal.addEventListener('click', (event) => {
            if (event.target.closest('[data-browser-player-close]')) closeBrowserPlayer();
        });
        browserPlayerRefreshBtn?.addEventListener('click', () => {
            if (!browserPlayerFrame || !browserPlayerTargetUrl) return;
            setBrowserPlayerLoading(true);
            browserPlayerFrame.src = browserPlayerTargetUrl;
        });
        browserPlayerFrame?.addEventListener('load', () => {
            window.clearTimeout(browserPlayerLoadTimer);
            browserPlayerLoadTimer = null;
            setBrowserPlayerLoading(false);
        });

        return modal;
    };

    const openBrowserPlayer = (target) => {
        if (!target?.url) return false;
        ensureBrowserPlayerModal();
        const loadUrl = target.proxyUrl || target.url;
        browserPlayerTargetUrl = loadUrl;
        if (browserPlayerTitle) browserPlayerTitle.textContent = target.label || 'Assigned IP';
        if (browserPlayerSubtitle) browserPlayerSubtitle.textContent = target.url;
        if (browserPlayerOpenLink) browserPlayerOpenLink.href = loadUrl;
        browserPlayerModal.removeAttribute('hidden');
        browserPlayerModal.setAttribute('aria-hidden', 'false');
        browserPlayerModal.classList.add('is-open');
        document.body.classList.add('account-browser-player-open');
        setBrowserPlayerLoading(true);
        if (browserPlayerFrame) {
            browserPlayerFrame.src = loadUrl;
        }
        window.clearTimeout(browserPlayerLoadTimer);
        browserPlayerLoadTimer = window.setTimeout(() => {
            setBrowserPlayerLoading(false, 'Open in a new tab if this page stays blank.');
        }, 4500);
        browserPlayerModal.querySelector('[data-browser-player-open]')?.focus({ preventScroll: true });
        return true;
    };

    const shouldUseIpBrowserProxy = (target = {}) => {
        if (!target?.proxyUrl) return false;
        try {
            const parsed = new URL(target.url);
            return isPrivateOrCgnatHost(parsed.hostname);
        } catch (_error) {
            return false;
        }
    };

    const openIpInExternalTab = (target = {}) => {
        const targetUrl = String(shouldUseIpBrowserProxy(target) ? target.proxyUrl : target?.url || '').trim();
        if (!targetUrl) return false;
        const opened = window.open(targetUrl, '_blank', 'noopener,noreferrer');
        return Boolean(opened);
    };

    const setupBrowserPlayerDelegates = () => {
        if (browserPlayerDelegatesReady) return;
        browserPlayerDelegatesReady = true;
        document.addEventListener('click', (event) => {
            const trigger = event.target.closest?.('[data-browser-player-ip]');
            if (!trigger) return;
            const target = buildIpBrowserTarget(trigger.dataset.browserPlayerUrl || trigger.dataset.browserPlayerSource || trigger.textContent);
            if (!target) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            openIpInExternalTab(target);
        }, true);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && browserPlayerModal?.classList.contains('is-open')) {
                closeBrowserPlayer();
            }
        });
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => syncBrowserPlayerTriggers(document), { once: true });
        } else {
            syncBrowserPlayerTriggers(document);
        }
    };

    const showSharedToast = (message, type = 'info') => {
        const text = String(message || '').trim();
        if (!text) return;
        if (typeof global.appToast === 'function') {
            global.appToast(text, { type });
            return;
        }
        const toast = document.getElementById('toast');
        if (!toast) {
            global.alert?.(text);
            return;
        }
        toast.textContent = text;
        toast.className = `toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'} show`;
        clearTimeout(showSharedToast._timer);
        showSharedToast._timer = setTimeout(() => toast.classList.remove('show'), 2600);
    };

    const normalizeDeviceId = (value) => {
        let decoded = String(value || '').trim();
        for (let index = 0; index < 3; index += 1) {
            try {
                const next = decodeURIComponent(decoded);
                if (next === decoded) break;
                decoded = next;
            } catch (_error) {
                break;
            }
        }
        return decoded;
    };

    const setWifiChangeModalOpen = (open) => {
        if (!wifiChangeModal) return;
        if (!open && wifiChangeModal.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        wifiChangeModal.classList.toggle('is-open', Boolean(open));
        wifiChangeModal.toggleAttribute('hidden', !open);
        wifiChangeModal.setAttribute('aria-hidden', open ? 'false' : 'true');
        document.body.classList.toggle('account-wifi-modal-open', Boolean(open));
    };

    const closeWifiChangeModal = () => {
        setWifiChangeModalOpen(false);
        wifiChangeDevice = null;
        wifiChangeMode = 'genieacs';
        wifiChangeAccountNumber = '';
        wifiChangeTargetUrl = '';
        if (wifiChangeForm) wifiChangeForm.reset();
    };

    const ensureWifiChangeModal = () => {
        if (wifiChangeModal) return wifiChangeModal;
        const modal = document.createElement('div');
        modal.id = 'accountWifiChangeModal';
        modal.className = 'account-wifi-modal';
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        modal.innerHTML = `
            <div class="account-wifi-modal__backdrop" data-account-wifi-close></div>
            <section class="account-wifi-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="accountWifiChangeTitle">
                <header class="account-wifi-modal__header">
                    <div>
                        <h2 id="accountWifiChangeTitle">Change WiFi</h2>
                        <p data-account-wifi-subtitle>Update WiFi name and password.</p>
                    </div>
                    <button type="button" class="account-wifi-modal__close" data-account-wifi-close aria-label="Close WiFi editor" title="Close">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </header>
                <form class="account-wifi-modal__form" data-account-wifi-form>
                    <section class="account-wifi-modal__band">
                        <h3><i class="fa-solid fa-wifi" aria-hidden="true"></i> 2.4G</h3>
                        <label>
                            <span>WiFi Name</span>
                            <input type="text" data-account-wifi-input="wifi24Ssid" autocomplete="off">
                        </label>
                        <label>
                            <span>Password</span>
                            <input type="text" data-account-wifi-input="wifi24Password" autocomplete="off" minlength="8">
                        </label>
                    </section>
                    <section class="account-wifi-modal__band">
                        <h3><i class="fa-solid fa-wifi" aria-hidden="true"></i> 5G</h3>
                        <label>
                            <span>WiFi Name</span>
                            <input type="text" data-account-wifi-input="wifi5Ssid" autocomplete="off">
                        </label>
                        <label>
                            <span>Password</span>
                            <input type="text" data-account-wifi-input="wifi5Password" autocomplete="off" minlength="8">
                        </label>
                    </section>
                    <footer class="account-wifi-modal__actions">
                        <button type="button" class="ghost-btn" data-account-wifi-close>Cancel</button>
                        <button type="submit" class="primary-btn" data-account-wifi-save>
                            <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save
                        </button>
                    </footer>
                </form>
            </section>
        `;
        document.body.appendChild(modal);
        wifiChangeModal = modal;
        wifiChangeForm = modal.querySelector('[data-account-wifi-form]');
        wifiChangeSubtitle = modal.querySelector('[data-account-wifi-subtitle]');
        wifiChangeSaveBtn = modal.querySelector('[data-account-wifi-save]');
        wifiChangeInputs = {
            wifi24Ssid: modal.querySelector('[data-account-wifi-input="wifi24Ssid"]'),
            wifi24Password: modal.querySelector('[data-account-wifi-input="wifi24Password"]'),
            wifi5Ssid: modal.querySelector('[data-account-wifi-input="wifi5Ssid"]'),
            wifi5Password: modal.querySelector('[data-account-wifi-input="wifi5Password"]')
        };

        modal.addEventListener('click', (event) => {
            if (event.target.closest('[data-account-wifi-close]')) {
                event.preventDefault();
                closeWifiChangeModal();
            }
        });
        wifiChangeForm?.addEventListener('submit', async (event) => {
            event.preventDefault();
            await saveWifiChange();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && wifiChangeModal?.classList.contains('is-open')) {
                closeWifiChangeModal();
            }
        });
        return modal;
    };

    const findBoundGenieacsDeviceForAccount = async (accountNumber) => {
        const targetAccount = String(accountNumber || '').trim();
        if (!targetAccount) throw new Error('Account number is missing.');
        const response = await fetch('/api/genieacs/devices', {
            credentials: 'include',
            cache: 'no-store'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.error || 'Unable to load GenieACS modems.');
        }
        const devices = Array.isArray(payload.devices) ? payload.devices : [];
        return devices.find((device) => String(device?.customerAccountNumber || '').trim() === targetAccount) || null;
    };

    const openWifiChangeModalForDevice = (device, accountNumber = '') => {
        ensureWifiChangeModal();
        wifiChangeDevice = device;
        wifiChangeMode = 'genieacs';
        wifiChangeAccountNumber = String(accountNumber || device?.customerAccountNumber || '').trim();
        wifiChangeTargetUrl = '';
        const bands = wifiChangeModal?.querySelectorAll('.account-wifi-modal__band') || [];
        if (bands[0]) {
            bands[0].hidden = false;
            const title = bands[0].querySelector('h3');
            if (title) title.innerHTML = '<i class="fa-solid fa-wifi" aria-hidden="true"></i> 2.4G';
        }
        if (bands[1]) {
            bands[1].hidden = false;
            const title = bands[1].querySelector('h3');
            if (title) title.innerHTML = '<i class="fa-solid fa-wifi" aria-hidden="true"></i> 5G';
        }
        const label = [
            String(accountNumber || device?.customerAccountNumber || '').trim(),
            device?.manufacturer,
            device?.model,
            device?.ipAddress
        ].filter(Boolean).join(' | ') || 'Selected modem';
        if (wifiChangeSubtitle) wifiChangeSubtitle.textContent = label;
        if (wifiChangeInputs.wifi24Ssid) wifiChangeInputs.wifi24Ssid.value = device?.ssid24 || '';
        if (wifiChangeInputs.wifi24Password) wifiChangeInputs.wifi24Password.value = device?.ssid24Password || '';
        if (wifiChangeInputs.wifi5Ssid) wifiChangeInputs.wifi5Ssid.value = device?.ssid5 || '';
        if (wifiChangeInputs.wifi5Password) wifiChangeInputs.wifi5Password.value = device?.ssid5Password || '';
        setWifiChangeModalOpen(true);
        setTimeout(() => {
            wifiChangeInputs.wifi24Ssid?.focus();
            wifiChangeInputs.wifi24Ssid?.select();
        }, 50);
    };

    const openWifiChangeModalForDirect = (accountNumber = '', options = {}) => {
        ensureWifiChangeModal();
        const target = buildIpBrowserTarget(options.url || options.targetUrl || options.ip || '');
        wifiChangeDevice = null;
        wifiChangeMode = 'direct';
        wifiChangeAccountNumber = String(accountNumber || '').trim();
        wifiChangeTargetUrl = target?.url || String(options.url || options.targetUrl || options.ip || '').trim();
        const bands = wifiChangeModal?.querySelectorAll('.account-wifi-modal__band') || [];
        if (bands[0]) {
            bands[0].hidden = false;
            const title = bands[0].querySelector('h3');
            if (title) title.innerHTML = '<i class="fa-solid fa-wifi" aria-hidden="true"></i> WiFi';
        }
        if (bands[1]) bands[1].hidden = true;
        if (wifiChangeSubtitle) {
            wifiChangeSubtitle.textContent = [
                wifiChangeAccountNumber ? `Account #${wifiChangeAccountNumber}` : '',
                'Direct web login',
                target?.label || sanitizeDirectWifiTargetValue(wifiChangeTargetUrl) || 'Assigned IP from customer record'
            ].filter(Boolean).join(' | ');
        }
        if (wifiChangeInputs.wifi24Ssid) wifiChangeInputs.wifi24Ssid.value = String(options.ssid24 || '').trim();
        if (wifiChangeInputs.wifi24Password) wifiChangeInputs.wifi24Password.value = String(options.password24 || '').trim();
        if (wifiChangeInputs.wifi5Ssid) wifiChangeInputs.wifi5Ssid.value = '';
        if (wifiChangeInputs.wifi5Password) wifiChangeInputs.wifi5Password.value = '';
        setWifiChangeModalOpen(true);
        setTimeout(() => {
            wifiChangeInputs.wifi24Ssid?.focus();
            wifiChangeInputs.wifi24Ssid?.select();
        }, 50);
    };

    const buildWifiChangeFormPayload = () => ({
        wifi24: {
            ssid: String(wifiChangeInputs.wifi24Ssid?.value || '').trim(),
            password: String(wifiChangeInputs.wifi24Password?.value || '').trim()
        },
        wifi5: {
            ssid: String(wifiChangeInputs.wifi5Ssid?.value || '').trim(),
            password: String(wifiChangeInputs.wifi5Password?.value || '').trim()
        }
    });

    const validateWifiChangePayload = ({ wifi24 = {}, wifi5 = {} } = {}) => {
        const requested = [wifi24, wifi5].some((entry) => entry.ssid || entry.password);
        if (!requested) {
            showSharedToast('Enter at least one WiFi name or password.', 'error');
            return false;
        }
        const invalidPassword = [wifi24, wifi5].find((entry) => entry.password && entry.password.length < 8);
        if (invalidPassword) {
            showSharedToast('WiFi password must be at least 8 characters.', 'error');
            return false;
        }
        return true;
    };

    const setWifiChangeSaving = (isSaving, label = 'Saving') => {
        if (!wifiChangeSaveBtn) return '';
        const originalHtml = wifiChangeSaveBtn.innerHTML || '';
        wifiChangeSaveBtn.disabled = Boolean(isSaving);
        if (isSaving) {
            wifiChangeSaveBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> ${label}`;
        }
        return originalHtml;
    };

    const restoreWifiChangeSaveButton = (originalHtml = '') => {
        if (!wifiChangeSaveBtn) return;
        wifiChangeSaveBtn.disabled = false;
        if (originalHtml) wifiChangeSaveBtn.innerHTML = originalHtml;
    };

    const saveDirectWifiChange = async () => {
        const accountNumber = String(wifiChangeAccountNumber || '').trim();
        if (!accountNumber) {
            showSharedToast('Account number is missing.', 'error');
            return;
        }
        const payload = buildWifiChangeFormPayload();
        if (!validateWifiChangePayload(payload)) return;

        const originalHtml = setWifiChangeSaving(true, 'Running');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000);
        try {
            const response = await fetch(`/api/customers/${encodeURIComponent(accountNumber)}/direct-wifi`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    url: wifiChangeTargetUrl,
                    ...payload
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result?.ok === false) {
                throw new Error(result?.error || 'Direct web WiFi change failed.');
            }
            showSharedToast(result.message || 'Direct web WiFi change submitted.', 'success');
            closeWifiChangeModal();
        } catch (error) {
            showSharedToast(error?.name === 'AbortError'
                ? 'Direct web WiFi change is taking too long. The device may be offline.'
                : (error.message || 'Direct web WiFi change failed.'), 'error');
        } finally {
            clearTimeout(timeoutId);
            restoreWifiChangeSaveButton(originalHtml);
        }
    };

    const saveGenieacsWifiChange = async () => {
        const device = wifiChangeDevice;
        if (!device?.id) {
            showSharedToast('No GenieACS modem selected.', 'error');
            return;
        }
        const formPayload = buildWifiChangeFormPayload();
        const wifi24 = {
            currentSsid: device.ssid24 || '',
            ...formPayload.wifi24
        };
        const wifi5 = {
            currentSsid: device.ssid5 || '',
            ...formPayload.wifi5
        };
        const changed24 = wifi24.ssid !== String(device.ssid24 || '').trim()
            || wifi24.password !== String(device.ssid24Password || '').trim();
        const changed5 = wifi5.ssid !== String(device.ssid5 || '').trim()
            || wifi5.password !== String(device.ssid5Password || '').trim();
        if (!changed24 && !changed5) {
            showSharedToast('No WiFi changes to save.');
            return;
        }
        if (!validateWifiChangePayload({ wifi24: changed24 ? wifi24 : {}, wifi5: changed5 ? wifi5 : {} })) return;

        const originalHtml = setWifiChangeSaving(true, 'Saving');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(`/api/genieacs/devices/${encodeURIComponent(normalizeDeviceId(device.id))}/wifi`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    rawDeviceId: device.id || '',
                    wifi24: changed24 ? wifi24 : {},
                    wifi5: changed5 ? wifi5 : {}
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.ok === false) {
                throw new Error(payload?.error || 'Failed to change WiFi settings.');
            }
            showSharedToast('WiFi change queued. Offline modems apply it on next inform.', 'success');
            closeWifiChangeModal();
        } catch (error) {
            showSharedToast(error?.name === 'AbortError'
                ? 'WiFi change is taking too long. The modem may be offline.'
                : (error.message || 'Failed to change WiFi settings.'), 'error');
        } finally {
            clearTimeout(timeoutId);
            restoreWifiChangeSaveButton(originalHtml);
        }
    };

    const saveWifiChange = async () => {
        if (wifiChangeMode === 'direct') {
            await saveDirectWifiChange();
            return;
        }
        await saveGenieacsWifiChange();
    };

    const openWifiChangeForAccount = async (accountNumber, options = {}) => {
        if (!isDirectWifiEnabled()) {
            showSharedToast('WiFi editor is only available for Dante Fiber.', 'error');
            return false;
        }
        const targetAccount = String(accountNumber || '').trim();
        if (!targetAccount) {
            showSharedToast('Account number is missing.', 'error');
            return false;
        }
        if (String(options.mode || '').trim().toLowerCase() === 'direct') {
            openWifiChangeModalForDirect(targetAccount, options);
            return true;
        }
        showSharedToast('Loading bound modem...');
        try {
            const device = await findBoundGenieacsDeviceForAccount(targetAccount);
            if (!device?.id) {
                showSharedToast('No GenieACS modem is bound to this customer account.', 'error');
                return false;
            }
            openWifiChangeModalForDevice(device, targetAccount);
            return true;
        } catch (error) {
            showSharedToast(error.message || 'Unable to open WiFi editor.', 'error');
            return false;
        }
    };

    const setConnectedDevicesModalOpen = (open) => {
        if (!connectedDevicesModal) return;
        if (!open && connectedDevicesModal.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        connectedDevicesModal.classList.toggle('is-open', Boolean(open));
        connectedDevicesModal.toggleAttribute('hidden', !open);
        connectedDevicesModal.setAttribute('aria-hidden', open ? 'false' : 'true');
        document.body.classList.toggle('account-devices-modal-open', Boolean(open));
    };

    const closeConnectedDevicesModal = () => {
        setConnectedDevicesModalOpen(false);
    };

    const ensureConnectedDevicesModal = () => {
        if (connectedDevicesModal) return connectedDevicesModal;

        const modal = document.createElement('div');
        modal.id = 'accountConnectedDevicesModal';
        modal.className = 'account-devices-modal';
        modal.setAttribute('hidden', '');
        modal.setAttribute('aria-hidden', 'true');
        modal.innerHTML = `
            <div class="account-devices-modal__backdrop" data-account-devices-close></div>
            <section class="account-devices-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="accountConnectedDevicesTitle">
                <header class="account-devices-modal__header">
                    <div>
                        <h2 id="accountConnectedDevicesTitle">Connected Devices</h2>
                        <p data-account-devices-subtitle></p>
                    </div>
                    <button type="button" class="account-devices-modal__close" data-account-devices-close aria-label="Close connected devices" title="Close">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </header>
                <div class="account-devices-modal__status" data-account-devices-status></div>
                <div class="account-devices-modal__table-wrap">
                    <table class="account-devices-modal__table">
                        <thead>
                            <tr>
                                <th>Status</th>
                                <th>Band</th>
                                <th>Device</th>
                                <th>MAC</th>
                                <th>IP</th>
                                <th>Signal</th>
                            </tr>
                        </thead>
                        <tbody data-account-devices-body></tbody>
                    </table>
                </div>
            </section>
        `;
        document.body.appendChild(modal);

        connectedDevicesModal = modal;
        connectedDevicesTitle = modal.querySelector('#accountConnectedDevicesTitle');
        connectedDevicesSubtitle = modal.querySelector('[data-account-devices-subtitle]');
        connectedDevicesBody = modal.querySelector('[data-account-devices-body]');
        connectedDevicesStatus = modal.querySelector('[data-account-devices-status]');

        modal.addEventListener('click', (event) => {
            if (event.target.closest('[data-account-devices-close]')) {
                closeConnectedDevicesModal();
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && connectedDevicesModal?.classList.contains('is-open')) {
                closeConnectedDevicesModal();
            }
        });

        return modal;
    };

    const setConnectedDevicesLoading = (message = '') => {
        ensureConnectedDevicesModal();
        if (connectedDevicesStatus) {
            connectedDevicesStatus.hidden = false;
            connectedDevicesStatus.textContent = message || 'Loading connected devices...';
        }
        if (connectedDevicesBody) {
            connectedDevicesBody.innerHTML = '<tr><td colspan="6" class="account-devices-modal__empty">Loading...</td></tr>';
        }
    };

    const renderConnectedDevices = (devices = [], meta = {}) => {
        ensureConnectedDevicesModal();
        const rows = Array.isArray(devices) ? devices : [];
        const onlineCount = Number.isFinite(Number(meta.onlineCount))
            ? Number(meta.onlineCount)
            : rows.filter((device) => Boolean(device?.online)).length;
        const totalCount = Number.isFinite(Number(meta.totalCount)) ? Number(meta.totalCount) : rows.length;
        if (connectedDevicesStatus) {
            connectedDevicesStatus.hidden = false;
            connectedDevicesStatus.textContent = `${onlineCount} online / ${totalCount} total`;
        }
        if (!connectedDevicesBody) return;
        if (!rows.length) {
            connectedDevicesBody.innerHTML = '<tr><td colspan="6" class="account-devices-modal__empty">No connected devices found on the modem pages inspected.</td></tr>';
            return;
        }
        connectedDevicesBody.innerHTML = rows.map((device) => {
            const online = Boolean(device?.online);
            const name = formatText(device?.hostname || device?.macAddress || device?.ipAddress, 'Unknown device');
            return `
                <tr>
                    <td><span class="account-devices-status ${online ? 'is-online' : 'is-offline'}">${online ? 'Online' : 'Offline'}</span></td>
                    <td>${escapeHtml(formatText(device?.band, '-'))}</td>
                    <td>${escapeHtml(name)}</td>
                    <td class="account-devices-mono">${escapeHtml(formatText(device?.macAddress, '-'))}</td>
                    <td class="account-devices-mono">${escapeHtml(formatText(device?.ipAddress, '-'))}</td>
                    <td>${escapeHtml(formatText(device?.signal, '-'))}</td>
                </tr>
            `;
        }).join('');
    };

    const openConnectedDevicesForAccount = async (accountNumber, options = {}) => {
        const targetAccount = String(accountNumber || '').trim();
        if (!targetAccount) {
            showSharedToast('Account number is missing.', 'error');
            return false;
        }
        const target = buildIpBrowserTarget(options.url || options.targetUrl || options.ip || '');
        ensureConnectedDevicesModal();
        if (connectedDevicesTitle) connectedDevicesTitle.textContent = 'Connected Devices';
        if (connectedDevicesSubtitle) {
            connectedDevicesSubtitle.textContent = [
                `Account #${targetAccount}`,
                target?.label || sanitizeDirectWifiTargetValue(options.url || options.targetUrl || options.ip || '') || 'Assigned IP from customer record'
            ].filter(Boolean).join(' | ');
        }
        setConnectedDevicesModalOpen(true);
        setConnectedDevicesLoading('Reading modem connected devices...');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000);
        try {
            const response = await fetch(`/api/customers/${encodeURIComponent(targetAccount)}/direct-connected-devices`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    url: target?.url || String(options.url || options.targetUrl || options.ip || '').trim()
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result?.ok === false) {
                throw new Error(result?.error || 'Unable to read connected devices.');
            }
            renderConnectedDevices(result.devices || [], {
                onlineCount: result.onlineCount,
                totalCount: result.totalCount
            });
            return true;
        } catch (error) {
            const message = error?.name === 'AbortError'
                ? 'Connected device scan is taking too long. The modem may be offline.'
                : (error.message || 'Unable to read connected devices.');
            if (connectedDevicesStatus) {
                connectedDevicesStatus.hidden = false;
                connectedDevicesStatus.textContent = message;
            }
            if (connectedDevicesBody) {
                connectedDevicesBody.innerHTML = `<tr><td colspan="6" class="account-devices-modal__empty">${escapeHtml(message)}</td></tr>`;
            }
            showSharedToast(message, 'error');
            return false;
        } finally {
            clearTimeout(timeoutId);
        }
    };

    const parseDateOnlyParts = (value) => {
        const raw = String(value ?? '').trim();
        if (!raw) return null;
        const match = raw.match(DATE_ONLY_RE);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
        return { year, month, day };
    };

    const buildStableManilaDate = (year, month, day) => new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

    const parseDate = (value) => {
        if (!value && value !== 0) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        const dateOnlyParts = parseDateOnlyParts(raw);
        if (dateOnlyParts) {
            return new Date(dateOnlyParts.year, dateOnlyParts.month - 1, dateOnlyParts.day);
        }
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const parseTimestamp = (value) => {
        if (!value && value !== 0) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        const dateOnlyParts = parseDateOnlyParts(raw);
        if (dateOnlyParts) {
            return new Date(dateOnlyParts.year, dateOnlyParts.month - 1, dateOnlyParts.day);
        }
        if (SQL_DATETIME_RE.test(raw)) {
            const parsed = new Date(raw.replace(' ', 'T') + 'Z');
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        if (ISO_DATETIME_NO_TZ_RE.test(raw)) {
            const parsed = new Date(`${raw}Z`);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const formatDate = (value, fallback = 'Not set') => {
        const dateOnlyParts = parseDateOnlyParts(value);
        if (dateOnlyParts) {
            return MANILA_DATE_FORMATTER.format(
                buildStableManilaDate(dateOnlyParts.year, dateOnlyParts.month, dateOnlyParts.day)
            );
        }
        const parsed = parseDate(value);
        if (!parsed) return fallback;
        return MANILA_DATE_FORMATTER.format(parsed);
    };

    const hasExplicitTime = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return false;
        return /T\d{2}:\d{2}/.test(raw) || /\d{2}:\d{2}(:\d{2})?/.test(raw);
    };

    const formatDateTime = (value, fallback = 'Not set') => {
        if (!hasExplicitTime(value)) return formatDate(value, fallback);
        const parsed = parseTimestamp(value);
        if (!parsed) return fallback;
        const dateText = MANILA_DATE_FORMATTER.format(parsed);
        const timeText = MANILA_TIME_FORMATTER.format(parsed);
        return `${dateText}, ${timeText}`;
    };

    const formatCurrency = (value, fallback = 'Not set') => {
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        return `${pesoSign}${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    };

    const normalizePppoeUsername = (value) => String(value || '').trim().toLowerCase();

    const formatBitRate = (bytesPerSecond) => {
        const bits = Math.max(Number(bytesPerSecond) || 0, 0) * 8;
        if (bits >= 1_000_000_000) return `${(bits / 1_000_000_000).toFixed(2)} Gbps`;
        if (bits >= 1_000_000) return `${(bits / 1_000_000).toFixed(2)} Mbps`;
        if (bits >= 1_000) return `${(bits / 1_000).toFixed(2)} Kbps`;
        return `${bits.toFixed(0)} bps`;
    };

    const findPppoeActiveSession = (payload = {}, username = '') => {
        const target = normalizePppoeUsername(username);
        if (!target) return null;
        const lists = [
            payload?.activeSessions,
            payload?.active,
            payload?.sessions
        ].filter(Array.isArray);
        for (const list of lists) {
            const match = list.find((session) => normalizePppoeUsername(
                session?.username || session?.name || session?.user
            ) === target);
            if (match) return match;
        }
        return null;
    };

    const buildPppoeLiveState = ({ payload = {}, username = '', profile = '', fallbackStatus = '', previousSample = null, now = Date.now() } = {}) => {
        const session = findPppoeActiveSession(payload, username);
        const rxBytes = Number(session?.rxBytes ?? session?.sessionRxBytes ?? session?.['rx-byte'] ?? 0) || 0;
        const txBytes = Number(session?.txBytes ?? session?.sessionTxBytes ?? session?.['tx-byte'] ?? 0) || 0;
        let downloadRate = '0 bps';
        let uploadRate = '0 bps';
        if (
            previousSample &&
            Number.isFinite(previousSample.rxBytes) &&
            Number.isFinite(previousSample.txBytes) &&
            Number.isFinite(previousSample.time) &&
            now > previousSample.time
        ) {
            const seconds = Math.max((now - previousSample.time) / 1000, 1);
            downloadRate = formatBitRate(Math.max(rxBytes - previousSample.rxBytes, 0) / seconds);
            uploadRate = formatBitRate(Math.max(txBytes - previousSample.txBytes, 0) / seconds);
        }
        const rawFallbackStatus = String(fallbackStatus || '').trim().toLowerCase();
        const isOnline = Boolean(session) || rawFallbackStatus === 'online' || rawFallbackStatus === 'active';
        return {
            online: isOnline,
            statusLabel: isOnline ? 'Online' : (rawFallbackStatus === 'disabled' ? 'Disabled' : 'Offline'),
            uptime: formatText(session?.uptime || session?.['session-uptime'] || session?.sessionUptime),
            assignedIp: formatText(session?.address || session?.['remote-address'] || session?.activeAddress),
            profile: formatText(profile || session?.profile),
            downloadRate,
            uploadRate,
            sample: { rxBytes, txBytes, time: now }
        };
    };

    const renderPppoeLiveState = (root, state = {}) => {
        if (!root) return;
        const set = (name, value) => {
            root.querySelectorAll(`[data-view="${name}"]`).forEach((node) => {
                node.textContent = value;
            });
        };
        const statusNodes = root.querySelectorAll('[data-view="pppoeLiveStatus"]');
        statusNodes.forEach((node) => {
            node.textContent = state.statusLabel || 'Offline';
            node.classList.remove('is-online', 'is-offline', 'is-disabled');
            node.classList.add(state.online ? 'is-online' : (state.statusLabel === 'Disabled' ? 'is-disabled' : 'is-offline'));
        });
        set('pppoeUptime', state.uptime || 'Not set');
        set('pppoeAssignedIp', state.assignedIp || 'Not set');
        set('pppoeDownloadRate', state.downloadRate || '0 bps');
        set('pppoeUploadRate', state.uploadRate || '0 bps');
        syncBrowserPlayerTriggers(root);
    };

    const formatBalance = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return `${pesoSign}0.00`;
        return `${pesoSign}${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    };

    const getOrdinalSuffix = (day) => {
        if (day > 3 && day < 21) return 'th';
        switch (day % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
        }
    };

    const toDateOnly = (value) => {
        const parsed = parseDate(value);
        if (!parsed) return null;
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    };

    const addMonthClamp = (dateObj) => {
        if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
        const year = dateObj.getFullYear();
        const month = dateObj.getMonth();
        const day = dateObj.getDate();
        const next = new Date(year, month + 1, 1);
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        const targetDay = Math.min(day, lastDay);
        return new Date(next.getFullYear(), next.getMonth(), targetDay);
    };

    const getDisplayDueDate = (rawDueDate, { planCategory = 'postpaid', shouldRoll = false } = {}) => {
        const due = toDateOnly(rawDueDate);
        if (!due) return formatDate(rawDueDate);
        if (planCategory === 'prepaid' || !shouldRoll) return formatDate(due);

        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        let candidate = new Date(due.getFullYear(), due.getMonth(), due.getDate());
        while (candidate < start) {
            const next = addMonthClamp(candidate);
            if (!next) break;
            candidate = next;
        }
        return formatDate(candidate);
    };

    const resolvePlanCategory = (customerData, resolver) => {
        if (typeof resolver === 'function') {
            const fromResolver = String(resolver(customerData) || '').trim().toLowerCase();
            if (fromResolver === 'prepaid' || fromResolver === 'postpaid') return fromResolver;
        }
        const explicit = String(customerData?.planCategory || customerData?.planType || '').trim().toLowerCase();
        if (explicit === 'prepaid' || explicit === 'postpaid') return explicit;
        const billing = String(customerData?.planBilling || '').trim().toLowerCase();
        if (billing.includes('prepaid')) return 'prepaid';
        if (billing.includes('postpaid')) return 'postpaid';
        const nameHint = String(customerData?.planName || '').trim().toLowerCase();
        if (nameHint.includes('prepaid')) return 'prepaid';
        return 'postpaid';
    };

    const getBillingCycleDisplay = (customerData, planCategory) => {
        if (planCategory === 'prepaid') return 'Monthly prepaid';
        const billDate = parseDate(customerData?.billDate);
        if (!billDate) return 'Not set';
        const day = billDate.getDate();
        return `Every ${day}${getOrdinalSuffix(day)} of the month`;
    };

    const getDueStatus = (dueDate) => {
        const parsed = parseDate(dueDate);
        if (!parsed) return { state: 'unknown', label: '', days: null };

        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const due = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
        const diffDays = Math.round((due.getTime() - start.getTime()) / 86400000);

        if (diffDays === 0) {
            return { state: 'today', label: 'Due today', days: 0 };
        }
        if (diffDays > 0) {
            return {
                state: 'upcoming',
                label: `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`,
                days: diffDays
            };
        }
        const overdue = Math.abs(diffDays);
        return {
            state: 'overdue',
            label: `Overdue · ${overdue} day${overdue === 1 ? '' : 's'}`,
            days: overdue
        };
    };

    const normalizePaymentDirection = (entry) => {
        const rawDirection = String(entry?.direction || '').trim().toLowerCase();
        if (rawDirection === 'debit' || rawDirection === 'credit') return rawDirection;
        const kind = String(entry?.kind || entry?.type || '').trim().toLowerCase();
        if (kind === 'charge' || kind === 'debit' || kind === 'bill') return 'debit';
        return 'credit';
    };

    const formatPaymentKind = (entry) => {
        const direction = normalizePaymentDirection(entry);
        const raw = String(entry?.kind || entry?.type || '').trim().toLowerCase();
        const normalized = raw && !(raw === 'payment' && direction === 'debit')
            ? raw
            : (direction === 'debit' ? 'charge' : 'payment');
        if (!normalized) return 'Payment';
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    };

    const formatSignedCurrency = (amount, direction) => {
        const abs = Math.abs(Number(amount) || 0);
        const base = `${pesoSign}${abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
        return direction === 'debit' ? `-${base}` : base;
    };

    const formatRecorderLabel = (recordedBy, fallback = 'N/A') => {
        if (!recordedBy) return fallback;
        if (typeof recordedBy === 'string') {
            const text = recordedBy.trim();
            return text || fallback;
        }
        if (typeof recordedBy !== 'object') return fallback;

        const name = String(recordedBy.name || '').trim();
        const username = String(recordedBy.username || '').trim();
        const role = String(recordedBy.role || '').trim();
        const base = name || username || fallback;
        if (!role || base === fallback) return base;
        return `${base} (${role})`;
    };

    const normalizeReferenceForDisplay = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const tagged = raw.match(/^(?:acct|cust)-([^-]+)-(.+)$/i);
        if (!tagged || !tagged[2]) return raw;
        const trailingToken = String(tagged[2]).split('-').filter(Boolean).pop();
        return String(trailingToken || tagged[2]).trim() || raw;
    };

    const resolveMatchedPlan = (customerData, planByName, normalizePlanName) => {
        if (!planByName || typeof planByName.get !== 'function') return null;
        const planName = String(customerData?.planName || '').trim();
        if (!planName) return null;
        const normalizer = typeof normalizePlanName === 'function'
            ? normalizePlanName
            : ((name) => String(name || '').trim().toLowerCase());
        return planByName.get(normalizer(planName)) || null;
    };

    const getStatusClass = (rawStatus) => {
        const normalized = String(rawStatus || '').trim().toLowerCase();
        if (normalized === 'active' || normalized === 'force-active') return 'success';
        if (normalized === 'disabled') return 'warning';
        return 'inactive';
    };

    const normalizeStatusReason = (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return '';
        if (raw === 'no-plan' || raw === 'no plan' || raw === 'no_plan') return 'no-plan';
        if (raw === 'override') return 'override';
        return '';
    };

    const normalizeStatusReasonAmount = (value) => {
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        return Number(amount.toFixed(2));
    };

    const formatStatusReasonAmount = (value) => {
        const amount = normalizeStatusReasonAmount(value);
        if (!amount) return '';
        return ` +${pesoSign}${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    };

    const buildAccountStatusLabel = (statusRaw) => {
        const status = String(statusRaw || '').trim().toLowerCase();
        if (status === 'active' || status === 'force-active') return 'Active';
        if (status === 'disabled') return 'Disabled';
        return 'Inactive';
    };

    const normalizeAccountStatusRaw = (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'force-active' || raw === 'force-inactive') return raw;
        if (raw === 'active' || raw === 'inactive' || raw === 'disabled') return raw;
        return '';
    };

    const resolveAccountStatusRaw = (customerData = {}) => {
        const values = [
            customerData?.subscriberStatus,
            customerData?.customerStatus,
            customerData?.status,
            customerData?.statusRaw
        ];
        for (const value of values) {
            const normalized = normalizeAccountStatusRaw(value);
            if (normalized) return normalized;
        }
        return '';
    };

    const getInitials = (displayName) => {
        const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '--';
        if (parts.length === 1) {
            return (parts[0].slice(0, 2) || '--').toUpperCase();
        }
        return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
    };

    const buildState = ({
        customerData = {},
        paymentRecord = null,
        planByName = null,
        normalizePlanName = null,
        resolvePlanCategory: resolveCategoryFn = null,
        routerInfo = null,
        formatNextBillDate = null,
        defaultRouterLabel = 'Default router'
    } = {}) => {
        const record = paymentRecord && typeof paymentRecord === 'object' ? paymentRecord : null;
        const accountNumber = String(customerData?.accountNumber || customerData?.id || '').trim();
        const fullName = String(customerData?.name || `${customerData?.firstName || ''} ${customerData?.lastName || ''}`.trim()).trim();
        const displayName = fullName || 'No name';
        const initials = getInitials(displayName);

        const statusRaw = resolveAccountStatusRaw(customerData);
        const accountStatusLabel = buildAccountStatusLabel(statusRaw);
        const accountStatusClass = getStatusClass(statusRaw);

        const planCategory = resolvePlanCategory(customerData, resolveCategoryFn);
        const planCategoryLabel = titleCase(planCategory) || 'Postpaid';
        const planName = formatText(customerData?.planName);
        const matchedPlan = resolveMatchedPlan(customerData, planByName, normalizePlanName);
        const planSuffix = '/ month';
        const planPriceValue = matchedPlan?.price ?? customerData?.planAmount ?? customerData?.planPrice ?? null;
        const planPrice = formatCurrency(planPriceValue);
        const planPriceDisplay = planPrice !== 'Not set' && planSuffix ? `${planPrice} ${planSuffix}` : planPrice;
        const planBilling = 'Monthly';

        const billingCycle = getBillingCycleDisplay(customerData, planCategory);
        const billDateDisplay = typeof formatNextBillDate === 'function'
            ? formatText(formatNextBillDate(customerData, planCategory))
            : (planCategory === 'prepaid'
                ? formatDate(customerData?.dueDate)
                : formatDate(customerData?.billDate));
        const dueOffsetRaw = customerData?.dueOffset;
        const dueOffsetDisplay = Number.isFinite(Number(dueOffsetRaw))
            ? `${Number(dueOffsetRaw)} day${Number(dueOffsetRaw) === 1 ? '' : 's'}`
            : formatText(dueOffsetRaw);
        const creditLimitDisplay = formatCurrency(customerData?.creditLimit);
        const dueStatus = getDueStatus(customerData?.dueDate);

        const balanceRaw = record?.balance
            ?? customerData?.currentBalance
            ?? customerData?.balance
            ?? customerData?.outstandingBalance
            ?? customerData?.balanceAmount
            ?? 0;
        const balanceNumber = Number(balanceRaw);
        const balanceDisplay = formatBalance(balanceRaw);

        const hasAdvance = Number.isFinite(balanceNumber) && balanceNumber < 0;
        const showOverdue = dueStatus.state === 'overdue' && !hasAdvance && Number.isFinite(balanceNumber) && balanceNumber > 0;
        const shouldRollDueDate = planCategory !== 'prepaid' && dueStatus.state === 'overdue' && !showOverdue;
        const dueDateDisplay = getDisplayDueDate(customerData?.dueDate, {
            planCategory,
            shouldRoll: shouldRollDueDate
        });
        const balanceTag = hasAdvance ? 'Advance' : (showOverdue ? 'Overdue' : '');
        const balanceHelper = hasAdvance
            ? `Advance balance ${formatCurrency(Math.abs(balanceNumber), `${pesoSign}0.00`)}`
            : (showOverdue && dueStatus.days !== null
                ? `Overdue by ${dueStatus.days} day${dueStatus.days === 1 ? '' : 's'}`
                : '');

        const fullAddress = [
            customerData?.street,
            customerData?.barangay,
            customerData?.municipality,
            customerData?.province
        ].filter(Boolean).join(', ');

        const mapPin = String(customerData?.mapPin || '').trim();
        const mapPinUrl = mapPin
            ? `https://maps.google.com/?q=${encodeURIComponent(mapPin)}`
            : '#';

        const loginUsername = formatText(customerData?.loginUsername || displayName);
        const loginPasswordRaw = String(customerData?.loginPassword || '').trim();
        const loginPasswordLooksHashed = loginPasswordRaw.startsWith('scrypt$');
        const loginPasswordPlain = loginPasswordLooksHashed ? '' : loginPasswordRaw;
        const loginPassword = loginPasswordPlain
            ? loginPasswordPlain
            : (customerData?.loginPasswordSet ? 'Set (reset required to view)' : 'Not set');

        const rawPppoeUsername = String(customerData?.pppoeUsername || '').trim();
        const rawPppoePassword = String(customerData?.pppoePassword || '').trim();
        const rawPppoeProfile = String(customerData?.pppoeProfile || '').trim();
        const hasPppoeAssignment = Boolean(rawPppoeUsername || rawPppoePassword || rawPppoeProfile);
        const routerLabelFallback = hasPppoeAssignment ? defaultRouterLabel : 'Not set';
        const routerLabel = formatText(
            routerInfo?.routerLabel
            || customerData?.routerLabel
            || customerData?.routerName
            || customerData?.routerId
            || routerInfo?.routerId
            || routerLabelFallback,
            routerLabelFallback
        );
        const rawNapInfo = String(customerData?.napInfo || '').trim();
        const rawNapPort = String(customerData?.napPort ?? '').trim();
        const rawOpticalInfo = String(customerData?.opticalInfo || customerData?.opticalPower || '').trim();
        const rawMikrotikStatus = String(customerData?.mikrotikStatus || '').trim().toLowerCase();
        const hasNapAssignment = Boolean(rawNapInfo || rawNapPort || rawOpticalInfo);
        const hasNapManagementInfo = Boolean(hasNapAssignment || rawMikrotikStatus);
        const napPortDisplay = rawNapPort ? `Port ${rawNapPort}` : 'Not set';
        const mikrotikStatus = formatText(titleCase(rawMikrotikStatus));

        const history = Array.isArray(record?.history)
            ? record.history
            : (Array.isArray(customerData?.history) ? customerData.history : []);
        const historyRows = buildHistoryRows(history, { limit: 15 });

        return {
            accountNumber,
            accountNumberLabel: accountNumber ? `Account #${accountNumber}` : 'Account #Not set',
            displayName,
            initials,
            accountStatusRaw: statusRaw,
            accountStatusLabel,
            accountStatusClass,
            planCategory,
            planCategoryLabel,
            planName,
            planBilling,
            planPriceDisplay,
            activationDate: formatDate(customerData?.activationDate),
            billingCycle,
            billDateDisplay,
            dueDateDisplay,
            dueOffsetDisplay,
            dueStatus,
            creditLimitDisplay,
            mobile: formatText(customerData?.mobileRaw || customerData?.mobile),
            email: formatText(customerData?.email),
            fullAddress: formatText(fullAddress),
            area: formatText(customerData?.area),
            mapPin: formatText(mapPin),
            mapPinUrl,
            remarks: formatText(customerData?.remarks),
            loginUsername,
            loginPassword,
            routerLabel,
            pppoeUsername: formatText(rawPppoeUsername),
            pppoePassword: formatText(rawPppoePassword),
            pppoeProfile: formatText(rawPppoeProfile),
            hasPppoeAssignment,
            napInfo: formatText(rawNapInfo),
            napPort: napPortDisplay,
            opticalInfo: formatText(rawOpticalInfo),
            mikrotikStatus,
            hasNapAssignment,
            hasNapManagementInfo,
            balanceNumber: Number.isFinite(balanceNumber) ? balanceNumber : 0,
            balanceDisplay,
            hasAdvance,
            showOverdue,
            balanceTag,
            balanceHelper,
            history,
            historyRows
        };
    };

    const buildHistoryRows = (history = [], { limit = 8 } = {}) => {
        if (!Array.isArray(history) || history.length === 0) return [];
        const getEntryDisplayDate = (entry) => entry?.date || entry?.recordedAt || '';
        const resolveEntryTimestamp = (entry) => {
            const parsed = parseTimestamp(getEntryDisplayDate(entry));
            return parsed ? parsed.getTime() : 0;
        };
        const resolveEntryYearKey = (entry) => {
            const source = getEntryDisplayDate(entry);
            const dateOnlyParts = parseDateOnlyParts(source);
            if (dateOnlyParts) return String(dateOnlyParts.year);
            const parsed = hasExplicitTime(source) ? parseTimestamp(source) : parseDate(source);
            if (!parsed) return 'unknown';
            return MANILA_YEAR_FORMATTER.format(parsed);
        };
        const sorted = [...history].sort((left, right) => {
            const leftTime = resolveEntryTimestamp(left);
            const rightTime = resolveEntryTimestamp(right);
            return rightTime - leftTime;
        });
        return sorted.slice(0, limit).map((entry) => {
            const sortTimestamp = resolveEntryTimestamp(entry);
            const yearKey = resolveEntryYearKey(entry);
            const direction = normalizePaymentDirection(entry);
            const amount = Number(entry?.amount) || 0;
            const entryId = String(entry?.id || '').trim();
            const dateLabel = formatDateTime(getEntryDisplayDate(entry), 'N/A');
            const rawReference = String(entry?.reference || entry?.ref || '').trim();
            const reference = normalizeReferenceForDisplay(rawReference) || '\u2014';
            const rawOrNumber = String(entry?.orNumber || entry?.or_number || '').trim();
            const orNumber = rawOrNumber || '\u2014';
            const recordedByLabel = formatRecorderLabel(
                entry?.recordedBy || {
                    name: entry?.recordedByName,
                    username: entry?.recordedByUsername,
                    role: entry?.recordedByRole
                },
                'N/A'
            );
            const typeLabel = formatPaymentKind(entry);
            const directionLabel = direction === 'debit' ? 'Debit' : 'Credit';
            return {
                entryId,
                dateLabel,
                reference,
                recordedByLabel,
                sortTimestamp,
                yearKey,
                typeLabel,
                direction,
                directionLabel,
                typeClass: direction === 'debit' ? 'debit' : 'credit',
                typeIcon: direction === 'debit' ? 'fa-minus' : 'fa-plus',
                amountClass: direction === 'debit' ? 'negative' : 'positive',
                signedAmount: formatSignedCurrency(amount, direction),
                pillClass: direction === 'debit' ? 'warning' : 'success',
                escaped: {
                    entryId: escapeHtml(entryId),
                    dateLabel: escapeHtml(dateLabel),
                    reference: escapeHtml(reference),
                    orNumber: escapeHtml(orNumber),
                    recordedByLabel: escapeHtml(recordedByLabel),
                    typeLabel: escapeHtml(typeLabel),
                    directionLabel: escapeHtml(directionLabel),
                    signedAmount: escapeHtml(formatSignedCurrency(amount, direction))
                }
            };
        });
    };

    const groupHistoryRowsByYear = (rows = [], options = {}) => {
        if (!Array.isArray(rows) || !rows.length) return [];
        const currentYearKey = String(options.currentYear || MANILA_YEAR_FORMATTER.format(new Date()));
        const expandedSource = options.expandedYears;
        const expandedYears = expandedSource instanceof Set
            ? expandedSource
            : new Set(Array.isArray(expandedSource) ? expandedSource : []);
        const lockCurrentYear = options.lockCurrentYear !== false;

        const buckets = new Map();
        rows.forEach((row) => {
            const key = String(row?.yearKey || 'unknown').trim() || 'unknown';
            const bucket = buckets.get(key) || {
                yearKey: key,
                sortWeight: Number.isFinite(Number(key)) ? Number(key) : -1,
                rows: []
            };
            bucket.rows.push(row);
            buckets.set(key, bucket);
        });

        return Array.from(buckets.values())
            .sort((left, right) => right.sortWeight - left.sortWeight)
            .map((group) => {
                const isCurrentYear = group.yearKey === currentYearKey;
                const isExpanded = (lockCurrentYear && isCurrentYear) || expandedYears.has(group.yearKey);
                return {
                    yearKey: group.yearKey,
                    yearLabel: group.yearKey === 'unknown' ? 'No Date' : group.yearKey,
                    isCurrentYear,
                    isExpanded,
                    isLocked: lockCurrentYear && isCurrentYear,
                    entryCount: group.rows.length,
                    rows: group.rows
                };
            });
    };

    global.AccountViewShared = {
        escapeHtml,
        formatDate,
        formatDateTime,
        formatCurrency,
        formatText,
        normalizeReferenceForDisplay,
        getDueStatus,
        buildState,
        buildHistoryRows,
        groupHistoryRowsByYear,
        findPppoeActiveSession,
        buildPppoeLiveState,
        renderPppoeLiveState,
        buildIpBrowserTarget,
        syncBrowserPlayerTriggers,
        openBrowserPlayer,
        openWifiChangeForAccount,
        openConnectedDevicesForAccount
    };
    setupBrowserPlayerDelegates();
})(window);
