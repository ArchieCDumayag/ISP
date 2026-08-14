document.addEventListener('DOMContentLoaded', () => {
    const locale = 'en-PH';
    const inviteUserBtn = document.getElementById('invite-user-btn');
    const gcashForm = document.getElementById('gcash-form');
    const xenditForm = document.getElementById('xendit-form');
    const semaphoreForm = document.getElementById('semaphore-form');
    const emailForm = document.getElementById('email-form');
    const genieacsForm = document.getElementById('genieacs-form');
    const mikrotikForm = document.getElementById('mikrotik-form');
    const ipBrowserForm = document.getElementById('ip-browser-form');
    const ipBrowserAddProfileBtn = document.getElementById('ip-browser-add-profile');
    const ipBrowserProfileBody = document.getElementById('ip-browser-profile-body');
    const ipBrowserProfileModal = document.getElementById('ipBrowserProfileModal');
    const ipBrowserProfileModalTitle = document.getElementById('ipBrowserProfileModalTitle');
    const ipBrowserProfileModalForm = document.getElementById('ipBrowserProfileModalForm');
    const closeIpBrowserProfileModal = document.getElementById('closeIpBrowserProfileModal');
    const cancelIpBrowserProfileModal = document.getElementById('cancelIpBrowserProfileModal');
    const saveIpBrowserProfile = document.getElementById('saveIpBrowserProfile');
    const ipBrowserProfileLabelInput = document.getElementById('ipBrowserProfileLabel');
    const ipBrowserProfileMatchesInput = document.getElementById('ipBrowserProfileMatches');
    const ipBrowserProfileUsernameInput = document.getElementById('ipBrowserProfileUsername');
    const ipBrowserProfilePasswordInput = document.getElementById('ipBrowserProfilePassword');
    const ipBrowserProfileUsernameSelectorInput = document.getElementById('ipBrowserProfileUsernameSelector');
    const ipBrowserProfilePasswordSelectorInput = document.getElementById('ipBrowserProfilePasswordSelector');
    const ipBrowserProfileSubmitSelectorInput = document.getElementById('ipBrowserProfileSubmitSelector');
    const ipBrowserProfileDelayInput = document.getElementById('ipBrowserProfileDelay');
    const ipBrowserProfileEnabledInput = document.getElementById('ipBrowserProfileEnabled');
    const mikrotikRouterBody = document.getElementById('mikrotik-router-body');
    const mikrotikDefaultSelect = document.getElementById('mikrotik-default-select');
    const mikrotikModal = document.getElementById('mikrotikModal');
    const mikrotikModalTitle = document.getElementById('mikrotikModalTitle');
    const mikrotikModalForm = document.getElementById('mikrotikModalForm');
    const closeMikrotikModal = document.getElementById('closeMikrotikModal');
    const cancelMikrotikModal = document.getElementById('cancelMikrotikModal');
    const testMikrotikRouter = document.getElementById('testMikrotikRouter');
    const saveMikrotikRouter = document.getElementById('saveMikrotikRouter');
    const mikrotikModalTestResult = document.getElementById('mikrotikModalTestResult');
    const mikrotikLabelInput = document.getElementById('mikrotikLabel');
    const mikrotikAddressInput = document.getElementById('mikrotikAddress');
    const mikrotikUsernameInput = document.getElementById('mikrotikUsername');
    const mikrotikPasswordInput = document.getElementById('mikrotikPassword');
    const mikrotikPortInput = document.getElementById('mikrotikPort');
    const pppoeForm = document.getElementById('pppoe-form');
    const pppoeAddBtn = document.getElementById('pppoe-add-btn');
    const pppoeSyncBtn = document.getElementById('pppoe-sync-btn');
    const pppoeTableBody = document.getElementById('pppoe-table-body');
    const accountsPanel = document.getElementById('accounts');
    const gcashPanel = document.getElementById('gcash');
    const xenditPanel = document.getElementById('xendit');
    const semaphorePanel = document.getElementById('semaphore');
    const emailPanel = document.getElementById('email');
    const genieacsPanel = document.getElementById('genieacs');
    const mikrotikPanel = document.getElementById('mikrotik');
    const ipBrowserPanel = document.getElementById('ip-browser');
    const pppoePanel = document.getElementById('pppoe');
    const mikrotikToggle = document.getElementById('mikrotik-enable-toggle');
    const mikrotikDisabledMessage = document.getElementById('mikrotik-disabled-message');
    const mikrotikInfoCard = document.getElementById('mikrotik-info-card');
    const mikrotikIdentityEl = document.getElementById('mikrotik-identity');
    const mikrotikBoardEl = document.getElementById('mikrotik-board');
    const mikrotikUptimeEl = document.getElementById('mikrotik-uptime');
    const gcashNameInput = document.getElementById('gcashAccountName');
    const gcashNumberInput = document.getElementById('gcashAccountNumber');
    const gcashQrFileInput = document.getElementById('gcashQrCodeFile');
    const gcashQrDataInput = document.getElementById('gcashQrCodeImageData');
    const gcashQrPreviewWrap = document.getElementById('gcashQrPreviewWrap');
    const gcashQrPreview = document.getElementById('gcashQrPreview');
    const gcashClearQrBtn = document.getElementById('gcashClearQrBtn');
    const integrationEditModal = document.getElementById('integrationEditModal');
    const integrationModalTitle = document.getElementById('integrationModalTitle');
    const integrationModalBody = document.getElementById('integrationModalBody');
    const closeIntegrationModalBtn = document.getElementById('closeIntegrationModal');
    const integrationEditButtons = Array.from(document.querySelectorAll('[data-integration-edit]'));
    const xenditDisplayApiKey = document.getElementById('xendit-display-api-key');
    const xenditDisplayFee = document.getElementById('xendit-display-fee');
    const xenditDisplayWebhook = document.getElementById('xendit-display-webhook');
    const semaphoreDisplayApiKey = document.getElementById('semaphore-display-api-key');
    const semaphoreDisplaySender = document.getElementById('semaphore-display-sender');
    const emailDisplayHost = document.getElementById('email-display-host');
    const emailDisplayUsername = document.getElementById('email-display-username');
    const emailDisplayFromName = document.getElementById('email-display-from-name');
    const emailDisplayPassword = document.getElementById('email-display-password');
    const genieacsDisplayHost = document.getElementById('genieacs-display-host');
    const genieacsDisplayUiUrl = document.getElementById('genieacs-display-ui-url');
    const genieacsDisplayNbiUrl = document.getElementById('genieacs-display-nbi-url');
    const genieacsDisplayUsername = document.getElementById('genieacs-display-username');
    const genieacsDisplayPassword = document.getElementById('genieacs-display-password');
    const mikrotikDisplayStatus = document.getElementById('mikrotik-display-status');
    const mikrotikDisplayRouters = document.getElementById('mikrotik-display-routers');
    const mikrotikDisplayDefault = document.getElementById('mikrotik-display-default');
    const mikrotikDisplayPrimaryAddress = document.getElementById('mikrotik-display-primary-address');
    const ipBrowserDisplayStatus = document.getElementById('ip-browser-display-status');
    const ipBrowserDisplayUsername = document.getElementById('ip-browser-display-username');
    const ipBrowserDisplayPassword = document.getElementById('ip-browser-display-password');
    const ipBrowserDisplayProfiles = document.getElementById('ip-browser-display-profiles');
    const gcashDisplayName = document.getElementById('gcash-display-name');
    const gcashDisplayNumber = document.getElementById('gcash-display-number');
    const gcashDisplayQr = document.getElementById('gcash-display-qr');
    const xenditIntegrationStatus = document.getElementById('xendit-integration-status');
    const semaphoreIntegrationStatus = document.getElementById('semaphore-integration-status');
    const emailIntegrationStatus = document.getElementById('email-integration-status');
    const genieacsIntegrationStatus = document.getElementById('genieacs-integration-status');
    const mikrotikIntegrationStatus = document.getElementById('mikrotik-integration-status');
    const ipBrowserIntegrationStatus = document.getElementById('ip-browser-integration-status');
    const gcashIntegrationStatus = document.getElementById('gcash-integration-status');
    const systemUpdatePanel = document.getElementById('system-update');
    const systemUpdateStatus = document.getElementById('system-update-status');
    const systemUpdateCheckBtn = document.getElementById('system-update-check');
    const systemUpdateRefreshBtn = document.getElementById('system-update-refresh');
    const systemUpdateRepository = document.getElementById('system-update-repository');
    const systemUpdateBranch = document.getElementById('system-update-branch');
    const systemUpdateLocal = document.getElementById('system-update-local');
    const systemUpdateRemote = document.getElementById('system-update-remote');
    const systemUpdateDifference = document.getElementById('system-update-difference');
    const systemUpdateChecked = document.getElementById('system-update-checked');

    const systemUpdateWarning = document.getElementById('system-update-warning');
    const systemUpdateCommitCount = document.getElementById('system-update-commit-count');
    const systemUpdateCommitsBody = document.getElementById('system-update-commits-body');
    
    // Account management elements
    const accountsTable = document.getElementById('accounts-table-body');
    const integrationLabels = {
        xendit: 'Xendit Payment Gateway',
        semaphore: 'Semaphore SMS',
        email: 'SMTP',
        genieacs: 'GenieACS',
        mikrotik: 'MikroTik',
        ipBrowser: 'IP Browser',
        gcash: 'GCash'
    };
    let activeIntegrationEditor = null;
    let latestIntegrationSettings = {};
    const MIKROTIK_TEST_TIMEOUT_MS = 15000;

    const setupSettingsTabs = () => {
        const tabButtons = Array.from(document.querySelectorAll('[data-settings-tab-target]'));
        const tabPanes = Array.from(document.querySelectorAll('#settingsTabsContent > .settings-panel.tab-pane'));
        if (!tabButtons.length || !tabPanes.length) return;

        const targetExists = (targetId) => tabPanes.some((pane) => pane.id === targetId);
        const normalizeTarget = (value = '') => {
            const raw = String(value || '').replace(/^#/, '').trim();
            if (raw === 'smtp') return 'email';
            return raw;
        };
        const activateTab = (targetId, updateHash = false) => {
            const normalizedTarget = normalizeTarget(targetId);
            const nextTarget = targetExists(normalizedTarget) ? normalizedTarget : 'accounts';
            tabButtons.forEach((button) => {
                const isActive = button.dataset.settingsTabTarget === nextTarget;
                button.classList.toggle('active', isActive);
                button.setAttribute('aria-selected', isActive ? 'true' : 'false');
                button.tabIndex = isActive ? 0 : -1;
            });
            tabPanes.forEach((pane) => {
                const isActive = pane.id === nextTarget;
                pane.classList.toggle('active', isActive);
                pane.classList.toggle('show', isActive);
            });
            if (updateHash && window.history?.replaceState) {
                const nextUrl = `${window.location.pathname}${window.location.search}#${nextTarget}`;
                window.history.replaceState(null, '', nextUrl);
            }
        };

        tabButtons.forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                activateTab(button.dataset.settingsTabTarget, false);
            });
        });

        const initialTarget = normalizeTarget(window.location.hash) || 'accounts';
        activateTab(initialTarget, false);
    };

    setupSettingsTabs();
    
    // Backend-powered accounts
    const formatDateDisplay = (isoOrText) => {
        // Support legacy already-formatted values
        if (!isoOrText) return '';
        if (/\d{4}-\d{2}-\d{2}T/.test(isoOrText)) {
            try { return dateFormatter.format(new Date(isoOrText)); } catch { return isoOrText; }
        }
        return isoOrText;
    };

    const fetchJsonWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeoutId = controller
            ? setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs)
            : null;
        try {
            const response = await fetch(url, {
                ...options,
                ...(controller ? { signal: controller.signal } : {})
            });
            const data = await response.json().catch(() => ({}));
            return { response, data };
        } catch (error) {
            const aborted = controller?.signal?.aborted || error?.name === 'AbortError';
            if (aborted) {
                throw new Error(`MikroTik test timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
            }
            throw error;
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    };

    const formatDateTimeDisplay = (isoOrText, fallback = 'Never') => {
        if (!isoOrText) return fallback;
        if (/\d{4}-\d{2}-\d{2}T/.test(isoOrText)) {
            try { return dateTimeFormatter.format(new Date(isoOrText)); } catch { return isoOrText; }
        }
        return String(isoOrText || '').trim() || fallback;
    };

    const isAccountActive = (account = {}) => {
        if (typeof account.isActive === 'boolean') return account.isActive;
        const fromStatus = String(account.status || '').trim().toLowerCase();
        if (fromStatus === 'disabled' || fromStatus === 'inactive') return false;
        if (fromStatus === 'active' || fromStatus === 'enabled') return true;
        const raw = account.isActive ?? account.active ?? account.disabled;
        if (typeof raw === 'boolean') return raw !== false;
        const normalized = String(raw ?? '').trim().toLowerCase();
        if (!normalized) return true;
        if (normalized === '0' || normalized === 'false' || normalized === 'disabled' || normalized === 'inactive') return false;
        if (normalized === '1' || normalized === 'true' || normalized === 'enabled' || normalized === 'active') return true;
        return true;
    };

    const getAccountStatusInfo = (account = {}) => {
        if (isAccountActive(account)) {
            return { label: 'Active', className: 'tag tag-status-active' };
        }
        return { label: 'Disabled', className: 'tag tag-status-disabled' };
    };

    const getRoleTagClass = (role) => {
        const normalized = String(role || '').toLowerCase();
        if (normalized === 'admin') return 'tag tag-admin';
        if (normalized === 'collector') return 'tag tag-collector';
        if (normalized === 'technician' || normalized === 'tech') return 'tag tag-tech';
        return 'tag';
    };
    const ROLE_ORDER = ['Admin', 'Collector', 'Technician', 'User'];
    const normalizeRoleName = (value) => {
        const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
        if (normalized === 'admin' || normalized === 'administrator') return 'Admin';
        if (normalized === 'collector' || normalized === 'collection' || normalized === 'collections') return 'Collector';
        if (normalized === 'technician' || normalized === 'tech') return 'Technician';
        if (normalized === 'user') return 'User';
        return '';
    };
    const collectRoles = (value) => {
        const values = Array.isArray(value)
            ? value
            : String(value || '')
                .split(/[,/|;]+|\s+\+\s+|\s+and\s+/i)
                .map((item) => item.trim())
                .filter(Boolean);
        const selected = new Set();
        values.forEach((item) => {
            const role = normalizeRoleName(item);
            if (role) selected.add(role);
        });
        return ROLE_ORDER.filter((role) => selected.has(role));
    };
    const normalizeRoles = (value, fallback = []) => {
        const roles = collectRoles(value);
        return roles.length ? roles : collectRoles(fallback);
    };
    const rolesToStoredValue = (roles, fallback = 'User') => {
        const normalized = normalizeRoles(roles, fallback ? [fallback] : []);
        return normalized.join(', ');
    };
    const accountRoles = (account = {}) => normalizeRoles(account.roles || account.role, account.role || 'User');
    const renderRoleTags = (roles = []) => normalizeRoles(roles, ['User'])
        .map((role) => `<span class="${getRoleTagClass(role)}">${role}</span>`)
        .join(' ');

    const isProtectedAdminId = (id) => String(id) === '1' || String(id) === 'backup-admin';

    const compareAccountIds = (aId, bId) => {
        const aText = String(aId ?? '').trim();
        const bText = String(bId ?? '').trim();
        const aNumber = Number(aText);
        const bNumber = Number(bText);
        const aIsNumeric = Number.isFinite(aNumber) && aText !== '';
        const bIsNumeric = Number.isFinite(bNumber) && bText !== '';
        if (aIsNumeric && bIsNumeric && aNumber !== bNumber) {
            return aNumber - bNumber;
        }
        if (aIsNumeric !== bIsNumeric) {
            return aIsNumeric ? -1 : 1;
        }
        return aText.localeCompare(bText, 'en', { numeric: true, sensitivity: 'base' });
    };

    const renderAccountsEmptyState = (message = 'No accounts found.') => {
        if (!accountsTable) return;
        accountsTable.innerHTML = '';
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 7;
        cell.style.textAlign = 'center';
        cell.style.padding = '14px';
        cell.textContent = message;
        row.appendChild(cell);
        accountsTable.appendChild(row);
    };

    const renderAccounts = (accounts) => {
        if (!accountsTable) return;
        accountsTable.innerHTML = '';
        const sorted = [...accounts].sort((a, b) => {
            const aProtected = isProtectedAdminId(a.id);
            const bProtected = isProtectedAdminId(b.id);
            if (aProtected !== bProtected) return aProtected ? -1 : 1;
            return compareAccountIds(a.id, b.id);
        });
        if (!sorted.length) {
            renderAccountsEmptyState();
            return;
        }
        sorted.forEach(account => {
            const id = String(account.id);
            const username = String(account.username || account.name || '').trim() || 'Unknown';
            const isProtectedAdmin = isProtectedAdminId(id);
            const effectiveRoles = isProtectedAdmin ? ['Admin'] : accountRoles(account);
            const effectiveRoleText = rolesToStoredValue(effectiveRoles, 'User');
            const createdText = formatDateDisplay(account.created || account.createdAt);
            const lastLoginText = formatDateTimeDisplay(account.lastLogin || account.last_login, 'Never');
            const accountStatusInfo = getAccountStatusInfo(account);
            const actionButtons = isProtectedAdmin
                ? `<button class="icon-btn" type="button" data-account-action="edit" aria-label="Edit ${username} account"><i class="fa-solid fa-pen"></i></button>
                   <button class="icon-btn" type="button" aria-label="Locked ${username} account" disabled><i class="fa-solid fa-lock"></i></button>`
                : `<button class="icon-btn" type="button" data-account-action="edit" aria-label="Edit ${username} account"><i class="fa-solid fa-pen"></i></button>
                   <button class="icon-btn danger" type="button" data-account-action="delete" aria-label="Delete ${username} account"><i class="fa-solid fa-trash"></i></button>`;
            const row = document.createElement('tr');
            row.dataset.accountId = id;
            row.dataset.accountName = username;
            row.dataset.accountRoles = effectiveRoleText;
            row.dataset.accountStatus = accountStatusInfo.label.toLowerCase();
            const displayId = isProtectedAdmin ? 'ADMIN' : id;
            row.innerHTML = `
                <td>${displayId}</td>
                <td>${username}</td>
                <td><div class="role-tags">${renderRoleTags(effectiveRoles)}</div></td>
                <td>${lastLoginText}</td>
                <td><span class="${accountStatusInfo.className}">${accountStatusInfo.label}</span></td>
                <td>${createdText}</td>
                <td>
                    <div class="table-actions">
                        ${actionButtons}
                    </div>
                </td>
            `;
            accountsTable.appendChild(row);
        });
    };

    const fetchAccounts = async () => {
        try {
            const res = await fetch('/api/accounts', { credentials: 'include' });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Failed to load accounts');
            renderAccounts(data.accounts || []);
        } catch (e) {
            console.error('Failed to fetch accounts', e);
            renderAccountsEmptyState('Failed to load accounts.');
        }
    };

    // Load accounts from server on page load
    // timeFormatter is defined below; we call fetchAccounts after its definition

    const dateFormatter = new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: '2-digit'
    });
    const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit'
    });
    // Now that date formatters exist, perform initial fetch
    fetchAccounts();

    const simulateAsyncButton = (button, loadingText, successText, successCallback) => {
        if (!button) return;
        const original = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${loadingText}`;
        setTimeout(() => {
            button.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${successText}`;
            if (typeof successCallback === 'function') {
                successCallback();
            }
            setTimeout(() => {
                button.disabled = false;
                button.innerHTML = original;
            }, 1800);
        }, 1400);
    };

    const EMPTY_SUMMARY_VALUE = '-';

    const getConfiguredText = (value, fallback = EMPTY_SUMMARY_VALUE) => {
        const text = String(value ?? '').trim();
        return text || fallback;
    };

    const maskSecret = (value, prefixLength = 4, suffixLength = 2) => {
        const text = String(value ?? '').trim();
        if (!text) return EMPTY_SUMMARY_VALUE;
        const minMask = 4;
        if (text.length <= prefixLength + suffixLength) {
            return '*'.repeat(Math.max(minMask, text.length));
        }
        const hiddenLength = Math.max(minMask, text.length - prefixLength - suffixLength);
        return `${text.slice(0, prefixLength)}${'*'.repeat(hiddenLength)}${text.slice(-suffixLength)}`;
    };

    const isSavedSecret = (settings = {}, field) => {
        return Boolean(settings?.[`${field}Set`] || String(settings?.[field] || '').trim());
    };

    const secretSummary = (settings = {}, field, prefixLength = 4, suffixLength = 2) => {
        const raw = String(settings?.[field] || '').trim();
        if (raw) return maskSecret(raw, prefixLength, suffixLength);
        return settings?.[`${field}Set`] ? 'Saved' : EMPTY_SUMMARY_VALUE;
    };

    const savedValueSummary = (settings = {}, field) => {
        const raw = String(settings?.[field] || '').trim();
        if (raw) return raw;
        return settings?.[`${field}Set`] ? 'Saved' : EMPTY_SUMMARY_VALUE;
    };

    const maskPhone = (value) => {
        const text = String(value ?? '').trim();
        if (!text) return EMPTY_SUMMARY_VALUE;
        const digitsOnly = text.replace(/\D/g, '');
        if (!digitsOnly) return text;
        if (digitsOnly.length <= 4) {
            return '*'.repeat(digitsOnly.length);
        }
        const hiddenLength = Math.max(4, digitsOnly.length - 4);
        return `${digitsOnly.slice(0, 2)}${'*'.repeat(hiddenLength)}${digitsOnly.slice(-2)}`;
    };

    const formatPeso = (value) => {
        const raw = String(value ?? '').trim();
        if (!raw) return EMPTY_SUMMARY_VALUE;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return raw;
        return `PHP ${parsed.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const setSummaryValue = (element, value) => {
        if (!element) return;
        element.textContent = getConfiguredText(value);
    };

    const resolveConfigStatus = (fields = []) => {
        const total = Array.isArray(fields) ? fields.length : 0;
        if (!total) return 'not-configured';
        const configuredCount = fields.filter((field) => String(field ?? '').trim().length > 0).length;
        if (configuredCount <= 0) return 'not-configured';
        if (configuredCount >= total) return 'connected';
        return 'partial';
    };

    const sanitizeGenieacsHost = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        return raw
            .replace(/^https?:\/\//i, '')
            .replace(/\/.*$/, '')
            .replace(/:\d+$/, '')
            .trim();
    };

    const normalizePortValue = (value, fallback) => {
        const raw = String(value ?? '').trim();
        if (!raw) return fallback;
        const parsed = Number(raw);
        return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? String(parsed) : '';
    };

    const buildGenieacsUrl = (host, port, protocolValue = 'http') => {
        const normalizedHost = sanitizeGenieacsHost(host);
        const normalizedPort = normalizePortValue(port, '');
        if (!normalizedHost) return '';
        const rawProtocol = String(protocolValue || 'http').trim().toLowerCase();
        const protocol = rawProtocol === 'https' ? 'https' : 'http';
        return `${protocol}://${normalizedHost}${normalizedPort ? `:${normalizedPort}` : ''}`;
    };

    const setIntegrationStatusBadge = (element, statusKey) => {
        if (!element) return;
        const normalized = String(statusKey || '').trim().toLowerCase();
        const status = (normalized === 'connected' || normalized === 'partial' || normalized === 'not-configured')
            ? normalized
            : 'not-configured';
        const statusMap = {
            connected: { icon: '🟢', label: 'Connected', className: 'integration-status-badge integration-status-badge--connected' },
            partial: { icon: '🟡', label: 'Partial Setup', className: 'integration-status-badge integration-status-badge--partial' },
            'not-configured': { icon: '🔴', label: 'Not Configured', className: 'integration-status-badge integration-status-badge--not-configured' }
        };
        const meta = statusMap[status];
        element.className = meta.className;
        element.hidden = true;
        element.setAttribute('aria-hidden', 'true');
        element.textContent = '';
        element.title = meta.label;
        element.dataset.status = status;
    };

    const resolveMikrotikFromSettings = (settings = {}) => {
        let routers = Array.isArray(settings.mikrotikRouters) ? settings.mikrotikRouters : [];
        const legacyRouter = settings.mikrotik && typeof settings.mikrotik === 'object' ? settings.mikrotik : null;
        const legacyHasAnyValue = legacyRouter
            ? [
                legacyRouter.address,
                legacyRouter.host,
                legacyRouter.username,
                legacyRouter.user,
                legacyRouter.password,
                legacyRouter.port,
                legacyRouter.label,
                legacyRouter.name
            ].some((value) => String(value || '').trim())
            : false;
        if (!routers.length && legacyHasAnyValue) {
            routers = [{
                id: settings.mikrotikDefaultId || legacyRouter.id || 'legacy-router',
                label: legacyRouter.label || legacyRouter.name || 'MikroTik Router',
                address: legacyRouter.address || legacyRouter.host || '',
                username: legacyRouter.username || legacyRouter.user || '',
                password: legacyRouter.password || '',
                port: legacyRouter.port || ''
            }];
        }
        const normalizedRouters = routers
            .map(normalizeRouter)
            .filter((router) => Boolean(router.address && router.username && router.password));
        const defaultId = settings.mikrotikDefaultId || normalizedRouters[0]?.id || '';
        const defaultRouter = normalizedRouters.find((router) => router.id === defaultId) || normalizedRouters[0] || null;
        const credentialsAvailable = normalizedRouters.some((router) => {
            const addressValue = String(router.address || '').trim();
            const usernameValue = String(router.username || '').trim();
            const passwordValue = String(router.password || '').trim();
            return Boolean(addressValue && usernameValue && passwordValue);
        });
        const enabledFlag = Boolean(settings.mikrotik?.enabled && credentialsAvailable);
        return {
            routers: normalizedRouters,
            defaultId,
            defaultRouter,
            enabledFlag
        };
    };

    const renderIntegrationSummaries = (settings = {}) => {
        const xenditSettings = settings.xendit || {};
        const semaphoreSettings = settings.semaphore || {};
        const emailSettings = settings.email || {};
        const genieacsSettings = settings.genieacs || {};
        const ipBrowserSettings = settings.ipBrowser || {};
        const gcashSettings = settings.gcash || {};
        const mikrotikState = resolveMikrotikFromSettings(settings);
        const mikrotikLegacy = settings.mikrotik && typeof settings.mikrotik === 'object' ? settings.mikrotik : {};
        const rawRouters = Array.isArray(settings.mikrotikRouters) ? settings.mikrotikRouters : [];

        setSummaryValue(xenditDisplayApiKey, secretSummary(xenditSettings, 'apiKey', 5, 2));
        setSummaryValue(xenditDisplayFee, formatPeso(xenditSettings.transactionFee));
        setSummaryValue(xenditDisplayWebhook, secretSummary(xenditSettings, 'webhookSecret', 3, 2));

        setSummaryValue(semaphoreDisplayApiKey, secretSummary(semaphoreSettings, 'apiKey', 4, 2));
        setSummaryValue(semaphoreDisplaySender, semaphoreSettings.senderName);

        setSummaryValue(emailDisplayHost, emailSettings.host);
        setSummaryValue(emailDisplayUsername, savedValueSummary(emailSettings, 'username'));
        setSummaryValue(emailDisplayFromName, emailSettings.fromName);
        setSummaryValue(emailDisplayPassword, secretSummary(emailSettings, 'password', 0, 0));

        const genieacsHost = sanitizeGenieacsHost(genieacsSettings.host);
        const genieacsProtocol = genieacsSettings.protocol || 'http';
        const genieacsUiUrl = buildGenieacsUrl(genieacsHost, genieacsSettings.uiPort || '3000', genieacsProtocol);
        const genieacsNbiUrl = buildGenieacsUrl(genieacsHost, genieacsSettings.nbiPort || '7557', genieacsProtocol);
        setSummaryValue(genieacsDisplayHost, genieacsHost);
        setSummaryValue(genieacsDisplayUiUrl, genieacsUiUrl);
        setSummaryValue(genieacsDisplayNbiUrl, genieacsNbiUrl);
        setSummaryValue(genieacsDisplayUsername, savedValueSummary(genieacsSettings, 'username'));
        setSummaryValue(genieacsDisplayPassword, secretSummary(genieacsSettings, 'password', 0, 0));

        setSummaryValue(mikrotikDisplayStatus, mikrotikState.enabledFlag ? 'Enabled' : 'Disabled');
        setSummaryValue(mikrotikDisplayRouters, String(mikrotikState.routers.length || 0));
        setSummaryValue(
            mikrotikDisplayDefault,
            mikrotikState.defaultRouter ? (mikrotikState.defaultRouter.label || mikrotikState.defaultRouter.address) : ''
        );
        setSummaryValue(
            mikrotikDisplayPrimaryAddress,
            mikrotikState.defaultRouter?.address || mikrotikState.routers[0]?.address || ''
        );
        setSummaryValue(ipBrowserDisplayStatus, ipBrowserSettings.autoLoginEnabled ? 'Enabled' : 'Disabled');
        setSummaryValue(ipBrowserDisplayUsername, savedValueSummary(ipBrowserSettings, 'username'));
        setSummaryValue(ipBrowserDisplayPassword, secretSummary(ipBrowserSettings, 'password', 0, 0));
        setSummaryValue(
            ipBrowserDisplayProfiles,
            String((Array.isArray(ipBrowserSettings.profiles) ? ipBrowserSettings.profiles : []).length)
        );

        setSummaryValue(gcashDisplayName, gcashSettings.accountName);
        setSummaryValue(gcashDisplayNumber, maskPhone(gcashSettings.accountNumber));
        setSummaryValue(gcashDisplayQr, gcashSettings.qrCodeImageData ? 'Uploaded' : EMPTY_SUMMARY_VALUE);

        const xenditStatus = resolveConfigStatus([
            isSavedSecret(xenditSettings, 'apiKey') ? 'set' : '',
            xenditSettings.transactionFee,
            isSavedSecret(xenditSettings, 'webhookSecret') ? 'set' : ''
        ]);
        const semaphoreStatus = resolveConfigStatus([
            isSavedSecret(semaphoreSettings, 'apiKey') ? 'set' : '',
            semaphoreSettings.senderName
        ]);
        const emailStatus = resolveConfigStatus([
            emailSettings.host,
            isSavedSecret(emailSettings, 'username') ? 'set' : '',
            emailSettings.fromName,
            isSavedSecret(emailSettings, 'password') ? 'set' : ''
        ]);
        let genieacsStatus = 'not-configured';
        const genieacsHasCredentials = Boolean(
            isSavedSecret(genieacsSettings, 'username') &&
            isSavedSecret(genieacsSettings, 'password')
        );
        if (genieacsHost && genieacsHasCredentials && genieacsSettings.enabled) {
            genieacsStatus = 'connected';
        } else if (
            genieacsHost ||
            genieacsSettings.uiPort ||
            genieacsSettings.nbiPort ||
            isSavedSecret(genieacsSettings, 'username') ||
            isSavedSecret(genieacsSettings, 'password')
        ) {
            genieacsStatus = 'partial';
        }
        const gcashStatus = resolveConfigStatus([
            gcashSettings.accountName,
            gcashSettings.accountNumber,
            gcashSettings.qrCodeImageData
        ]);

        const hasAnyMikrotikField = rawRouters.some((router) => {
            if (!router || typeof router !== 'object') return false;
            return [
                router.label,
                router.address,
                router.host,
                router.username,
                router.user,
                router.password,
                router.port
            ].some((value) => String(value ?? '').trim().length > 0);
        }) || [
            mikrotikLegacy.label,
            mikrotikLegacy.name,
            mikrotikLegacy.address,
            mikrotikLegacy.host,
            mikrotikLegacy.username,
            mikrotikLegacy.user,
            mikrotikLegacy.password,
            mikrotikLegacy.port
        ].some((value) => String(value ?? '').trim().length > 0);

        let mikrotikStatus = 'not-configured';
        if (hasAnyMikrotikField && mikrotikState.enabledFlag) {
            mikrotikStatus = 'connected';
        } else if (hasAnyMikrotikField || mikrotikState.routers.length > 0) {
            mikrotikStatus = 'partial';
        }

        let ipBrowserStatus = 'not-configured';
        const ipBrowserHasCredentials = Boolean(
            isSavedSecret(ipBrowserSettings, 'username') &&
            isSavedSecret(ipBrowserSettings, 'password')
        );
        const ipBrowserHasProfiles = (Array.isArray(ipBrowserSettings.profiles) ? ipBrowserSettings.profiles : [])
            .some((profile) => profile?.enabled !== false && isSavedSecret(profile, 'username') && isSavedSecret(profile, 'password'));
        if (ipBrowserSettings.autoLoginEnabled && (ipBrowserHasCredentials || ipBrowserHasProfiles)) {
            ipBrowserStatus = 'connected';
        } else if (
            ipBrowserSettings.autoLoginEnabled ||
            ipBrowserHasCredentials ||
            ipBrowserHasProfiles ||
            ipBrowserSettings.usernameSelector ||
            ipBrowserSettings.passwordSelector ||
            ipBrowserSettings.submitSelector
        ) {
            ipBrowserStatus = 'partial';
        }

        setIntegrationStatusBadge(xenditIntegrationStatus, xenditStatus);
        setIntegrationStatusBadge(semaphoreIntegrationStatus, semaphoreStatus);
        setIntegrationStatusBadge(emailIntegrationStatus, emailStatus);
        setIntegrationStatusBadge(genieacsIntegrationStatus, genieacsStatus);
        setIntegrationStatusBadge(mikrotikIntegrationStatus, mikrotikStatus);
        setIntegrationStatusBadge(ipBrowserIntegrationStatus, ipBrowserStatus);
        setIntegrationStatusBadge(gcashIntegrationStatus, gcashStatus);
    };

    const getIntegrationEditor = (provider) => document.getElementById(`${provider}-editor`);

    const bringOverlayToFront = (modal, zIndex = 2200) => {
        if (!modal) return;
        if (modal.parentElement === document.body) {
            document.body.appendChild(modal);
        }
        modal.style.zIndex = String(zIndex);
    };

    let suspendedIntegrationForMikrotik = false;

    const suspendIntegrationOverlayForMikrotik = () => {
        if (!integrationEditModal?.classList.contains('active')) return;
        integrationEditModal.classList.add('modal-overlay--suspended');
        integrationEditModal.setAttribute('aria-hidden', 'true');
        suspendedIntegrationForMikrotik = true;
    };

    const resumeIntegrationOverlayAfterMikrotik = () => {
        if (!integrationEditModal) return;
        integrationEditModal.classList.remove('modal-overlay--suspended');
        integrationEditModal.removeAttribute('aria-hidden');
        suspendedIntegrationForMikrotik = false;
    };

    const closeIntegrationEditModal = () => {
        if (!integrationEditModal) return;
        if (activeIntegrationEditor?.editor && activeIntegrationEditor?.originParent) {
            const { editor, originParent, originNextSibling } = activeIntegrationEditor;
            editor.classList.remove('is-in-modal');
            editor.hidden = true;
            if (originNextSibling && originNextSibling.parentElement === originParent) {
                originParent.insertBefore(editor, originNextSibling);
            } else {
                originParent.appendChild(editor);
            }
        }
        activeIntegrationEditor = null;
        resumeIntegrationOverlayAfterMikrotik();
        integrationEditModal.classList.remove('active');
        integrationEditModal.style.removeProperty('z-index');
    };

    const openIntegrationEditModal = (provider) => {
        if (!integrationEditModal || !integrationModalBody || !provider) return;
        const editor = getIntegrationEditor(provider);
        if (!editor) return;
        if (activeIntegrationEditor) {
            closeIntegrationEditModal();
        }
        activeIntegrationEditor = {
            provider,
            editor,
            originParent: editor.parentElement,
            originNextSibling: editor.nextElementSibling
        };
        if (integrationModalTitle) {
            const label = integrationLabels[provider] || provider;
            integrationModalTitle.textContent = `Edit ${label}`;
        }
        editor.hidden = false;
        editor.classList.add('is-in-modal');
        integrationModalBody.appendChild(editor);
        resumeIntegrationOverlayAfterMikrotik();
        bringOverlayToFront(integrationEditModal, 2200);
        integrationEditModal.classList.add('active');
        scheduleSensitiveInputClear(provider);
    };

    integrationEditButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const provider = String(button.dataset.integrationEdit || '').trim();
            openIntegrationEditModal(provider);
        });
    });

    if (closeIntegrationModalBtn) {
        closeIntegrationModalBtn.addEventListener('click', closeIntegrationEditModal);
    }

    if (integrationEditModal) {
        integrationEditModal.addEventListener('click', (e) => {
            if (e.target === integrationEditModal) {
                closeIntegrationEditModal();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && ipBrowserProfileModal?.classList.contains('active')) {
            closeIpBrowserProfileModalFn();
            return;
        }
        if (e.key === 'Escape' && mikrotikModal?.classList.contains('active')) {
            closeMikrotikModalFn();
            return;
        }
        if (e.key === 'Escape' && integrationEditModal?.classList.contains('active')) {
            closeIntegrationEditModal();
        }
    });

    const showInlineMessage = (container, message, type = 'success') => {
        if (!container) return;
        const modalTarget =
            activeIntegrationEditor?.editor &&
            activeIntegrationEditor.provider &&
            container.id === activeIntegrationEditor.provider
                ? activeIntegrationEditor.editor
                : null;
        const target = modalTarget || container;
        let flash = target.querySelector('.form-flash.message-anchor');
        if (!flash) {
            flash = document.createElement('div');
            flash.className = 'form-flash message-anchor';
            target.appendChild(flash);
        }
        flash.textContent = message;
        flash.classList.toggle('error', type === 'error');
        clearTimeout(flash._timeoutId);
        flash._timeoutId = setTimeout(() => {
            flash.textContent = '';
        }, 4000);
    };

    const setSystemUpdateBadge = (state, label) => {
        if (!systemUpdateStatus) return;
        const normalized = String(state || '').toLowerCase();
        const className = normalized === 'current' || normalized === 'updated'
            ? 'integration-status-badge integration-status-badge--connected'
            : normalized === 'error'
                ? 'integration-status-badge integration-status-badge--not-configured'
                : 'integration-status-badge integration-status-badge--partial';
        systemUpdateStatus.className = className;
        systemUpdateStatus.hidden = false;
        systemUpdateStatus.removeAttribute('aria-hidden');
        systemUpdateStatus.textContent = label || 'Checking';
        systemUpdateStatus.dataset.status = normalized || 'checking';
    };

    const setSystemUpdateActionState = (payload = {}) => {
        if (!systemUpdateCheckBtn) return;
        const autoUpdate = payload.autoUpdate || {};
        const updateRun = payload.updateRun || {};
        const comparison = payload.comparison || {};
        const isRunning = Boolean(updateRun.running || updateRun.status === 'running');
        const isEnabled = Boolean(autoUpdate.enabled);
        const hasUpdate = Boolean(comparison.updateAvailable);
        const unableToVerify = Boolean(comparison.unableToVerify);
        const hasLocalChanges = Boolean(payload.workingTree?.dirty);
        systemUpdateCheckBtn.disabled = isRunning || !isEnabled || unableToVerify || hasLocalChanges || !hasUpdate;
        if (isRunning) {
            systemUpdateCheckBtn.title = updateRun.currentStep || 'System update is running.';
        } else if (!isEnabled) {
            systemUpdateCheckBtn.title = autoUpdate.message || 'Automatic update is not supported on this install.';
        } else if (unableToVerify) {
            systemUpdateCheckBtn.title = comparison.fetchError || 'Unable to verify GitHub updates.';
        } else if (hasLocalChanges) {
            systemUpdateCheckBtn.title = 'Commit or stash local changes before applying an update.';
        } else if (!hasUpdate) {
            systemUpdateCheckBtn.title = 'No new update available. Refresh status to check GitHub again.';
        } else {
            systemUpdateCheckBtn.title = 'Apply the latest GitHub update now.';
        }
    };

    const setSystemUpdateField = (element, value, fallback = '-') => {
        if (!element) return;
        element.textContent = String(value ?? '').trim() || fallback;
    };

    const formatSystemUpdateCommitLabel = (commit = {}) => {
        const hash = String(commit?.shortHash || '').trim();
        return hash || '-';
    };

    const formatSystemUpdateDifference = (payload = {}) => {
        const comparison = payload.comparison || {};
        if (comparison.unableToVerify) {
            return 'Unable to verify remote';
        }
        const ahead = Math.max(0, Number(comparison.ahead) || 0);
        const behind = Math.max(0, Number(comparison.behind) || 0);
        const parts = [];
        if (behind > 0) parts.push(`${behind} behind remote`);
        if (ahead > 0) parts.push(`${ahead} ahead local`);
        if (!parts.length) parts.push('Up to date');
        return parts.join(', ');
    };

    const renderSystemUpdateEmptyRow = (message = 'No commits found.') => {
        if (!systemUpdateCommitsBody) return;
        systemUpdateCommitsBody.innerHTML = '';
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 4;
        cell.className = 'system-update-empty';
        cell.textContent = message;
        row.appendChild(cell);
        systemUpdateCommitsBody.appendChild(row);
        if (systemUpdateCommitCount) {
            systemUpdateCommitCount.textContent = '0 shown';
        }
    };

    const appendSystemUpdateCell = (row, text, className = '') => {
        const cell = document.createElement('td');
        if (className) cell.className = className;
        cell.textContent = String(text ?? '').trim() || '-';
        row.appendChild(cell);
        return cell;
    };

    const renderSystemUpdateCommits = (commits = []) => {
        if (!systemUpdateCommitsBody) return;
        systemUpdateCommitsBody.innerHTML = '';
        const rows = Array.isArray(commits) ? commits.slice(0, 50) : [];
        if (!rows.length) {
            renderSystemUpdateEmptyRow();
            return;
        }

        rows.forEach((commit) => {
            const row = document.createElement('tr');
            const hashCell = document.createElement('td');
            const hashLabel = formatSystemUpdateCommitLabel(commit);
            if (commit?.url) {
                const link = document.createElement('a');
                link.className = 'system-update-commit-link';
                link.href = commit.url;
                link.target = '_blank';
                link.rel = 'noopener';
                link.textContent = hashLabel;
                hashCell.appendChild(link);
            } else {
                hashCell.textContent = hashLabel;
            }
            row.appendChild(hashCell);

            const subjectCell = document.createElement('td');
            const subject = document.createElement('span');
            subject.className = 'system-update-commit-subject';
            subject.textContent = String(commit?.subject || '').trim() || '(no message)';
            subject.title = subject.textContent;
            subjectCell.appendChild(subject);
            row.appendChild(subjectCell);

            appendSystemUpdateCell(row, commit?.author);
            appendSystemUpdateCell(row, formatDateTimeDisplay(commit?.committedAt, '-'));
            systemUpdateCommitsBody.appendChild(row);
        });

        if (systemUpdateCommitCount) {
            systemUpdateCommitCount.textContent = `${rows.length} shown`;
        }
    };

    const renderSystemUpdateStatus = (payload = {}) => {
        if (!systemUpdatePanel) return;
        const repository = payload.repository || {};
        const branch = payload.branch || {};
        const local = payload.local || {};
        const remote = payload.remote || {};
        const comparison = payload.comparison || {};
        const autoUpdate = payload.autoUpdate || {};
        const updateRun = payload.updateRun || {};
        const isRunning = Boolean(updateRun.running || updateRun.status === 'running');

        if (systemUpdateRepository) {
            const repoName = repository.name || 'ArchieCDumayag/ISP';
            const repoUrl = repository.url || 'https://github.com/ArchieCDumayag/ISP';
            systemUpdateRepository.textContent = repoName;
            systemUpdateRepository.href = repoUrl;
        }

        setSystemUpdateField(systemUpdateBranch, branch.upstream || branch.remoteRef || branch.local);
        setSystemUpdateField(systemUpdateLocal, formatSystemUpdateCommitLabel(local));
        if (systemUpdateLocal) {
            systemUpdateLocal.title = local.subject || local.hash || '';
        }
        setSystemUpdateField(systemUpdateRemote, formatSystemUpdateCommitLabel(remote.commit || remote));
        if (systemUpdateRemote) {
            systemUpdateRemote.title = remote.commit?.subject || remote.hash || '';
        }
        setSystemUpdateField(systemUpdateDifference, formatSystemUpdateDifference(payload));
        setSystemUpdateField(systemUpdateChecked, formatDateTimeDisplay(payload.checkedAt || branch.fetchedAt, '-'));

        const warnings = Array.isArray(payload.warnings) ? payload.warnings.filter(Boolean) : [];
        const changedCount = Math.max(0, Number(payload.workingTree?.changedFileCount) || 0);
        if (changedCount > 0) {
            warnings.unshift(`Working tree has ${changedCount} local file change${changedCount === 1 ? '' : 's'}; commit or stash them before applying an update.`);
        }
        if (autoUpdate.enabled === false) {
            warnings.push(autoUpdate.message || 'Automatic update is not supported on this install.');
        }
        if (isRunning) {
            warnings.unshift(updateRun.currentStep || updateRun.message || 'System update is running.');
        }
        if (systemUpdateWarning) {
            systemUpdateWarning.hidden = !warnings.length;
            systemUpdateWarning.textContent = warnings.join(' ');
        }

        setSystemUpdateActionState(payload);
        if (isRunning) {
            setSystemUpdateBadge('update', 'Updating');
        } else if (updateRun.status === 'restart-pending') {
            setSystemUpdateBadge('updated', 'Restarting');
        } else if (comparison.unableToVerify) {
            setSystemUpdateBadge('error', 'Unable to Verify');
        } else if (comparison.updateAvailable) {
            setSystemUpdateBadge('update', 'Update Available');
        } else {
            setSystemUpdateBadge('current', 'Up To Date');
        }
        renderSystemUpdateCommits(payload.commits || []);
    };

    const fetchSystemUpdateStatus = async () => {
        if (!systemUpdatePanel) return;
        const unlock = window.withButtonLock
            ? window.withButtonLock(systemUpdateRefreshBtn, { label: '<i class="ti ti-refresh"></i> Checking...' })
            : null;
        setSystemUpdateBadge('checking', 'Checking');
        if (systemUpdateCommitsBody && !systemUpdateCommitsBody.children.length) {
            renderSystemUpdateEmptyRow('Loading commits...');
        }

        try {
            const response = await fetch('/api/system-update/status', {
                credentials: 'include',
                cache: 'no-store'
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data?.ok === false) {
                throw new Error(data?.error || 'Failed to load system update status.');
            }
            renderSystemUpdateStatus(data);
        } catch (error) {
            setSystemUpdateBadge('error', 'Unavailable');
            setSystemUpdateField(systemUpdateDifference, 'Unable to check updates');
            setSystemUpdateField(systemUpdateChecked, formatDateTimeDisplay(new Date().toISOString(), '-'));
            renderSystemUpdateEmptyRow(error.message || 'Failed to load commits.');
            if (systemUpdateWarning) {
                systemUpdateWarning.hidden = false;
                systemUpdateWarning.textContent = error.message || 'Failed to load system update status.';
            }
            setSystemUpdateActionState({
                autoUpdate: {
                    enabled: false,
                    message: error.message || 'Automatic update is unavailable.'
                }
            });
        } finally {
            if (unlock) unlock();
        }
    };

    const checkAndApplySystemUpdate = async () => {
        if (!systemUpdatePanel) return;
        const unlock = window.withButtonLock
            ? window.withButtonLock(systemUpdateCheckBtn, { label: '<i class="ti ti-loader-2"></i> Checking...' })
            : null;
        if (window.withButtonLock && !unlock) return;

        setSystemUpdateBadge('checking', 'Checking');
        if (systemUpdateWarning) {
            systemUpdateWarning.hidden = false;
            systemUpdateWarning.textContent = 'Checking GitHub and preparing to apply the update...';
        }

        try {
            const response = await fetch('/api/system-update/check-and-apply', {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store'
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data?.ok === false) {
                throw new Error(data?.error || 'Failed to check for update.');
            }

            if (data.status) {
                renderSystemUpdateStatus(data.status);
            }

            if (data.applied) {
                setSystemUpdateBadge('updated', 'Restarting');
                if (systemUpdateCheckBtn) {
                    systemUpdateCheckBtn.disabled = true;
                    systemUpdateCheckBtn.title = 'Update applied. The app is restarting now.';
                }
                if (systemUpdateWarning) {
                    systemUpdateWarning.hidden = false;
                    systemUpdateWarning.textContent = data.message || 'Update applied. The app is restarting now.';
                }
                showInlineMessage(systemUpdatePanel, data.message || 'Update applied. Restarting the app now.', 'success');
                setTimeout(() => {
                    fetchSystemUpdateStatus();
                }, 12000);
            } else {
                setSystemUpdateBadge('current', 'Up To Date');
                showInlineMessage(systemUpdatePanel, data.message || 'Already up to date.', 'success');
            }
        } catch (error) {
            setSystemUpdateBadge('error', 'Unavailable');
            if (systemUpdateWarning) {
                systemUpdateWarning.hidden = false;
                systemUpdateWarning.textContent = error.message || 'Failed to check for update.';
            }
            showInlineMessage(systemUpdatePanel, error.message || 'Failed to check for update.', 'error');
        } finally {
            if (unlock) unlock();
        }
    };


    const collectFormValues = (form) => {
        if (!form) return {};
        const result = {};
        const elements = Array.from(form.elements);
        elements.forEach(element => {
            if (!element.name) return;
            if (element.type === 'checkbox') {
                result[element.name] = element.checked;
            } else if (element.type === 'radio') {
                if (element.checked) {
                    result[element.name] = element.value;
                }
            } else if (element.type === 'file') {
                if (element.files && element.files.length > 0) {
                    result[element.name] = Array.from(element.files).map(file => file.name);
                }
            } else {
                result[element.name] = element.value;
            }
        });
        return result;
    };

    const readImageAsDataUrl = (file) => new Promise((resolve, reject) => {
        if (!file) {
            resolve('');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('Unable to read QR code image.'));
        reader.readAsDataURL(file);
    });

    const setGcashQrPreview = (dataUrl = '') => {
        const normalized = String(dataUrl || '').trim();
        if (gcashQrDataInput) {
            gcashQrDataInput.value = normalized;
        }
        if (gcashQrPreview) {
            if (normalized) {
                gcashQrPreview.src = normalized;
            } else {
                gcashQrPreview.removeAttribute('src');
            }
        }
        if (gcashQrPreviewWrap) {
            gcashQrPreviewWrap.classList.toggle('has-image', Boolean(normalized));
        }
    };

    if (typeof window.mikrotikEnabled === 'undefined') {
        window.mikrotikEnabled = false;
    }

    let mikrotikToggleProgrammatic = false;

    const generateRouterId = () => `router-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let mikrotikRouters = [];
    let editingMikrotikId = null;
    const generateIpBrowserProfileId = () => `ip-browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let ipBrowserProfiles = [];
    let editingIpBrowserProfileId = null;

    const normalizeIpBrowserMatchList = (value) => {
        const source = Array.isArray(value) ? value : String(value || '').split(/[\r\n,;]+/);
        return Array.from(new Set(
            source
                .map((entry) => String(entry || '').trim())
                .filter(Boolean)
        ));
    };

    const normalizeIpBrowserProfile = (profile = {}) => {
        const delayMs = Number(profile.delayMs);
        const username = String(profile.username || '').trim();
        const password = String(profile.password || '');
        return {
            id: String(profile.id || '').trim() || generateIpBrowserProfileId(),
            label: String(profile.label || profile.name || '').trim() || 'Router profile',
            enabled: profile.enabled !== false,
            matches: normalizeIpBrowserMatchList(profile.matches || profile.matchTargets || profile.targets),
            username,
            usernameSet: Boolean(profile.usernameSet || username),
            password,
            passwordSet: Boolean(profile.passwordSet || password),
            usernameSelector: String(profile.usernameSelector || '').trim(),
            passwordSelector: String(profile.passwordSelector || '').trim(),
            submitSelector: String(profile.submitSelector || '').trim(),
            delayMs: Number.isFinite(delayMs) && delayMs >= 0 && delayMs <= 5000 ? delayMs : 600
        };
    };

    const setIpBrowserProfiles = (profiles = []) => {
        ipBrowserProfiles = (Array.isArray(profiles) ? profiles : []).map(normalizeIpBrowserProfile);
    };

    const createIpBrowserProfileRow = (profile) => {
        const row = document.createElement('tr');
        row.dataset.profileId = profile.id;

        const labelCell = document.createElement('td');
        labelCell.textContent = profile.label || 'Router profile';

        const matchesCell = document.createElement('td');
        const matchList = document.createElement('span');
        matchList.className = 'ip-browser-profile-match-list';
        matchList.textContent = profile.matches.join(', ') || '-';
        matchList.title = profile.matches.join('\n');
        matchesCell.appendChild(matchList);

        const usernameCell = document.createElement('td');
        usernameCell.textContent = profile.username || (profile.usernameSet ? 'Saved' : '-');

        const statusCell = document.createElement('td');
        const status = document.createElement('span');
        status.className = `ip-browser-profile-status${profile.enabled ? '' : ' is-disabled'}`;
        status.textContent = profile.enabled ? 'Enabled' : 'Disabled';
        statusCell.appendChild(status);

        const delayCell = document.createElement('td');
        delayCell.textContent = `${profile.delayMs} ms`;

        const actionsCell = document.createElement('td');
        const actions = document.createElement('div');
        actions.className = 'table-actions';
        const editButton = document.createElement('button');
        editButton.className = 'icon-btn';
        editButton.type = 'button';
        editButton.dataset.ipBrowserProfileAction = 'edit';
        editButton.setAttribute('aria-label', `Edit ${profile.label || 'router profile'}`);
        editButton.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>';
        const removeButton = document.createElement('button');
        removeButton.className = 'icon-btn danger';
        removeButton.type = 'button';
        removeButton.dataset.ipBrowserProfileAction = 'remove';
        removeButton.setAttribute('aria-label', `Remove ${profile.label || 'router profile'}`);
        removeButton.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
        actions.append(editButton, removeButton);
        actionsCell.appendChild(actions);

        row.append(labelCell, matchesCell, usernameCell, statusCell, delayCell, actionsCell);
        return row;
    };

    const renderIpBrowserProfiles = () => {
        if (!ipBrowserProfileBody) return;
        ipBrowserProfileBody.innerHTML = '';
        if (!ipBrowserProfiles.length) {
            const row = document.createElement('tr');
            row.className = 'ip-browser-profile-empty-row';
            const cell = document.createElement('td');
            cell.colSpan = 6;
            cell.textContent = 'No router profiles. Default credentials will be used.';
            row.appendChild(cell);
            ipBrowserProfileBody.appendChild(row);
            return;
        }
        ipBrowserProfiles.forEach((profile) => {
            ipBrowserProfileBody.appendChild(createIpBrowserProfileRow(profile));
        });
    };

    const openIpBrowserProfileModal = (profile = null) => {
        if (!ipBrowserProfileModal) return;
        ipBrowserProfileModalForm?.reset();
        editingIpBrowserProfileId = profile?.id || null;
        if (ipBrowserProfileModalTitle) {
            ipBrowserProfileModalTitle.textContent = profile ? 'Edit Router Profile' : 'Add Router Profile';
        }
        if (ipBrowserProfileLabelInput) ipBrowserProfileLabelInput.value = profile?.label || '';
        if (ipBrowserProfileMatchesInput) ipBrowserProfileMatchesInput.value = (profile?.matches || []).join('\n');
        if (ipBrowserProfileUsernameInput) {
            ipBrowserProfileUsernameInput.value = '';
            ipBrowserProfileUsernameInput.placeholder = profile?.usernameSet ? 'Saved - leave blank to keep' : '';
        }
        if (ipBrowserProfilePasswordInput) {
            ipBrowserProfilePasswordInput.value = '';
            ipBrowserProfilePasswordInput.placeholder = profile?.passwordSet ? 'Saved - leave blank to keep' : '';
        }
        if (ipBrowserProfileUsernameSelectorInput) ipBrowserProfileUsernameSelectorInput.value = profile?.usernameSelector || '';
        if (ipBrowserProfilePasswordSelectorInput) ipBrowserProfilePasswordSelectorInput.value = profile?.passwordSelector || '';
        if (ipBrowserProfileSubmitSelectorInput) ipBrowserProfileSubmitSelectorInput.value = profile?.submitSelector || '';
        if (ipBrowserProfileDelayInput) ipBrowserProfileDelayInput.value = profile?.delayMs ?? 600;
        if (ipBrowserProfileEnabledInput) ipBrowserProfileEnabledInput.checked = profile?.enabled !== false;
        bringOverlayToFront(ipBrowserProfileModal, 2700);
        ipBrowserProfileModal.classList.add('active');
        ipBrowserProfileLabelInput?.focus({ preventScroll: true });
    };

    const closeIpBrowserProfileModalFn = () => {
        if (!ipBrowserProfileModal) return;
        ipBrowserProfileModal.classList.remove('active');
        ipBrowserProfileModal.style.removeProperty('z-index');
        ipBrowserProfileModalForm?.reset();
        editingIpBrowserProfileId = null;
    };

    const normalizeRouter = (router = {}) => {
        const id = String(router.id || '').trim() || generateRouterId();
        const portRaw = router.port;
        const portNum = portRaw === '' || portRaw === null || typeof portRaw === 'undefined'
            ? undefined
            : Number(portRaw);
        return {
            id,
            label: String(router.label || '').trim(),
            address: String(router.address || '').trim(),
            username: String(router.username || '').trim(),
            password: String(router.password || ''),
            port: Number.isFinite(portNum) && portNum > 0 ? portNum : undefined
        };
    };

    const setMikrotikRouters = (routers = []) => {
        mikrotikRouters = routers.map(normalizeRouter);
    };

    const setMikrotikModalTestResult = (message = '', type = '') => {
        if (!mikrotikModalTestResult) return;
        mikrotikModalTestResult.textContent = String(message || '').trim();
        mikrotikModalTestResult.classList.remove('is-success', 'is-error');
        if (type === 'success') {
            mikrotikModalTestResult.classList.add('is-success');
        } else if (type === 'error') {
            mikrotikModalTestResult.classList.add('is-error');
        }
    };

    const collectMikrotikModalCredentials = () => {
        const address = mikrotikAddressInput?.value?.trim() || '';
        const username = mikrotikUsernameInput?.value?.trim() || '';
        const password = mikrotikPasswordInput?.value || '';
        const portRaw = mikrotikPortInput?.value?.trim() || '';
        if (!address || !username || !password) {
            throw new Error('Address, username, and password are required to test.');
        }
        let port;
        if (portRaw) {
            const portNum = Number(portRaw);
            if (!Number.isFinite(portNum) || portNum <= 0) {
                throw new Error('Port must be a positive number.');
            }
            port = portNum;
        }
        return {
            address,
            username,
            password,
            port
        };
    };

    const collectRoutersFromUI = () => mikrotikRouters.map((router) => ({ ...router }));

    const refreshDefaultRouterSelect = (routers = [], preferredId = '') => {
        if (!mikrotikDefaultSelect) return;
        mikrotikDefaultSelect.innerHTML = '';
        if (!routers.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No routers';
            mikrotikDefaultSelect.appendChild(opt);
            mikrotikDefaultSelect.disabled = true;
            return;
        }
        routers.forEach((router) => {
            const opt = document.createElement('option');
            opt.value = router.id;
            opt.textContent = router.label || router.address || 'MikroTik Router';
            mikrotikDefaultSelect.appendChild(opt);
        });
        const fallbackId = preferredId && routers.some((r) => r.id === preferredId)
            ? preferredId
            : routers[0].id;
        mikrotikDefaultSelect.disabled = routers.length <= 1;
        mikrotikDefaultSelect.value = fallbackId;
    };

    const createRouterRow = (router) => {
        const row = document.createElement('tr');
        row.dataset.routerId = router.id;
        const labelCell = document.createElement('td');
        labelCell.textContent = router.label || '-';
        const addressCell = document.createElement('td');
        addressCell.textContent = router.address || '-';
        const usernameCell = document.createElement('td');
        usernameCell.textContent = router.username || '-';
        const portCell = document.createElement('td');
        portCell.textContent = router.port ? String(router.port) : '-';
        const passwordCell = document.createElement('td');
        passwordCell.textContent = router.password ? '******' : '-';
        const actionsCell = document.createElement('td');
        const labelForAria = router.label || router.address || 'router';
        actionsCell.innerHTML = `
            <div class="table-actions">
                <button class="icon-btn" type="button" data-router-action="edit" aria-label="Edit ${labelForAria}"><i class="fa-solid fa-pen"></i></button>
                <button class="icon-btn danger" type="button" data-router-action="remove" aria-label="Remove ${labelForAria}"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        row.appendChild(labelCell);
        row.appendChild(addressCell);
        row.appendChild(usernameCell);
        row.appendChild(portCell);
        row.appendChild(passwordCell);
        row.appendChild(actionsCell);
        return row;
    };

    const renderRouterTable = (routers = [], defaultId = '') => {
        if (!mikrotikRouterBody) return;
        mikrotikRouterBody.innerHTML = '';
        if (!routers.length) {
            const row = document.createElement('tr');
            row.className = 'mikrotik-empty-row';
            const cell = document.createElement('td');
            cell.colSpan = 6;
            cell.textContent = 'Add a router to start syncing PPPoE.';
            row.appendChild(cell);
            mikrotikRouterBody.appendChild(row);
            refreshDefaultRouterSelect([], '');
            return;
        }
        routers.forEach((router) => {
            mikrotikRouterBody.appendChild(createRouterRow(router));
        });
        refreshDefaultRouterSelect(routers, defaultId);
    };

    const hasMikrotikCredentials = () => {
        if (!mikrotikForm) return false;
        return mikrotikRouters.some((router) => router.address && router.username && router.password);
    };

    const updatePppoeSidebarVisibility = (visible, attempt = 0) => {
        const shouldShow = Boolean(visible);
        const item = document.querySelector('[data-feature="mikrotikPppoe"]');
        const link = item?.querySelector('a[href="pppoe.html"]') || document.querySelector('.sidebar-menu a[href="pppoe.html"]');
        if (link || item) {
            const menu = (item || link)?.closest('.sidebar-menu');
            if (item) {
                item.hidden = !shouldShow;
            }
            if (menu) {
                menu.hidden = !shouldShow;
                menu.style.display = shouldShow ? '' : 'none';
            }
            return;
        }
        if (attempt < 20) {
            window.requestAnimationFrame(() => updatePppoeSidebarVisibility(visible, attempt + 1));
        }
    };

    const applyMikrotikEnabledState = (enabled, options = {}) => {
        const boolEnabled = Boolean(enabled);
        if (mikrotikToggle && options.syncToggle !== false) {
            mikrotikToggleProgrammatic = true;
            mikrotikToggle.checked = boolEnabled;
            mikrotikToggleProgrammatic = false;
        }
        if (mikrotikDisabledMessage) {
            mikrotikDisabledMessage.style.display = boolEnabled ? 'none' : '';
        }
        if (mikrotikPanel) {
            mikrotikPanel.classList.toggle('is-disabled', !boolEnabled);
        }
        window.mikrotikEnabled = boolEnabled;
        updatePppoeSidebarVisibility(boolEnabled);
    };

    const renderMikrotikInfo = () => {
        if (!mikrotikInfoCard) return;
        mikrotikInfoCard.style.display = 'none';
    };

    const loadMikrotikInfo = async () => {
        if (!mikrotikInfoCard) return;
        // MikroTik identity card is hidden; skip fetching router info
        renderMikrotikInfo();
    };

    const populateIntegrationForms = (settings = {}) => {
        latestIntegrationSettings = settings || {};
        const xenditSettings = latestIntegrationSettings.xendit || {};
        const semaphoreSettings = latestIntegrationSettings.semaphore || {};
        const emailSettings = latestIntegrationSettings.email || {};
        const genieacsSettings = latestIntegrationSettings.genieacs || {};
        const ipBrowserSettings = latestIntegrationSettings.ipBrowser || {};
        const gcashSettings = latestIntegrationSettings.gcash || {};

        if (gcashForm) {
            if (gcashNameInput) gcashNameInput.value = gcashSettings.accountName || '';
            if (gcashNumberInput) gcashNumberInput.value = gcashSettings.accountNumber || '';
            setGcashQrPreview(gcashSettings.qrCodeImageData || '');
            if (gcashQrFileInput) gcashQrFileInput.value = '';
        }

        if (xenditForm) {
            const apiKeyInput = xenditForm.querySelector('input[name="apiKey"]');
            const feeInput = xenditForm.querySelector('input[name="transactionFee"]');
            const webhookInput = xenditForm.querySelector('input[name="webhookSecret"]');
            if (apiKeyInput) {
                apiKeyInput.value = '';
                apiKeyInput.placeholder = xenditSettings.apiKeySet ? 'Saved - leave blank to keep' : '';
            }
            if (feeInput) feeInput.value = xenditSettings.transactionFee || '';
            if (webhookInput) {
                webhookInput.value = '';
                webhookInput.placeholder = xenditSettings.webhookSecretSet ? 'Saved - leave blank to keep' : '';
            }
        }

        if (semaphoreForm) {
            const apiKeyInput = semaphoreForm.querySelector('input[name="apiKey"]');
            const senderInput = semaphoreForm.querySelector('input[name="senderName"]');
            if (apiKeyInput) {
                apiKeyInput.value = '';
                apiKeyInput.placeholder = semaphoreSettings.apiKeySet ? 'Saved - leave blank to keep' : '';
            }
            if (senderInput) senderInput.value = semaphoreSettings.senderName || '';
        }

        if (emailForm) {
            const hostInput = emailForm.querySelector('input[name="host"]');
            const usernameInput = emailForm.querySelector('input[name="username"]');
            const passwordInput = emailForm.querySelector('input[name="password"]');
            const fromNameInput = emailForm.querySelector('input[name="fromName"]');
            if (hostInput) hostInput.value = emailSettings.host || '';
            if (usernameInput) {
                usernameInput.value = '';
                usernameInput.placeholder = emailSettings.usernameSet ? 'Saved - leave blank to keep' : '';
            }
            if (passwordInput) {
                passwordInput.value = '';
                passwordInput.placeholder = emailSettings.passwordSet ? 'Saved - leave blank to keep' : '';
            }
            if (fromNameInput) fromNameInput.value = emailSettings.fromName || '';
        }

        if (genieacsForm) {
            const hostInput = genieacsForm.querySelector('input[name="host"]');
            const protocolInput = genieacsForm.querySelector('select[name="protocol"]');
            const uiPortInput = genieacsForm.querySelector('input[name="uiPort"]');
            const nbiPortInput = genieacsForm.querySelector('input[name="nbiPort"]');
            const usernameInput = genieacsForm.querySelector('input[name="username"]');
            const passwordInput = genieacsForm.querySelector('input[name="password"]');
            const enabledInput = genieacsForm.querySelector('input[name="enabled"]');
            if (hostInput) hostInput.value = sanitizeGenieacsHost(genieacsSettings.host || '');
            if (protocolInput) protocolInput.value = String(genieacsSettings.protocol || 'http').toLowerCase() === 'https' ? 'https' : 'http';
            if (uiPortInput) uiPortInput.value = genieacsSettings.uiPort || '3000';
            if (nbiPortInput) nbiPortInput.value = genieacsSettings.nbiPort || '7557';
            if (usernameInput) {
                usernameInput.value = '';
                usernameInput.placeholder = genieacsSettings.usernameSet ? 'Saved - leave blank to keep' : '';
            }
            if (passwordInput) {
                passwordInput.value = '';
                passwordInput.placeholder = genieacsSettings.passwordSet ? 'Saved - leave blank to keep' : '';
            }
            if (enabledInput) enabledInput.checked = Boolean(genieacsSettings.enabled);
        }

        if (mikrotikForm) {
            const mikrotikState = resolveMikrotikFromSettings(latestIntegrationSettings);
            setMikrotikRouters(mikrotikState.routers);
            renderRouterTable(mikrotikRouters, mikrotikState.defaultId);
            applyMikrotikEnabledState(mikrotikState.enabledFlag);
        }

        if (ipBrowserForm) {
            setIpBrowserProfiles(ipBrowserSettings.profiles || []);
            renderIpBrowserProfiles();
            const enabledInput = ipBrowserForm.querySelector('input[name="autoLoginEnabled"]');
            const usernameInput = ipBrowserForm.querySelector('input[name="username"]');
            const passwordInput = ipBrowserForm.querySelector('input[name="password"]');
            const usernameSelectorInput = ipBrowserForm.querySelector('input[name="usernameSelector"]');
            const passwordSelectorInput = ipBrowserForm.querySelector('input[name="passwordSelector"]');
            const submitSelectorInput = ipBrowserForm.querySelector('input[name="submitSelector"]');
            const delayInput = ipBrowserForm.querySelector('input[name="delayMs"]');
            if (enabledInput) enabledInput.checked = Boolean(ipBrowserSettings.autoLoginEnabled);
            if (usernameInput) {
                usernameInput.value = '';
                usernameInput.placeholder = ipBrowserSettings.usernameSet ? 'Saved - leave blank to keep' : '';
            }
            if (passwordInput) {
                passwordInput.value = '';
                passwordInput.placeholder = ipBrowserSettings.passwordSet ? 'Saved - leave blank to keep' : '';
            }
            if (usernameSelectorInput) usernameSelectorInput.value = ipBrowserSettings.usernameSelector || '';
            if (passwordSelectorInput) passwordSelectorInput.value = ipBrowserSettings.passwordSelector || '';
            if (submitSelectorInput) submitSelectorInput.value = ipBrowserSettings.submitSelector || '';
            if (delayInput) delayInput.value = ipBrowserSettings.delayMs ?? 600;
        }

        if (latestIntegrationSettings.pppoe) {
            pppoeState.accounts = Array.isArray(latestIntegrationSettings.pppoe.accounts)
                ? latestIntegrationSettings.pppoe.accounts.slice()
                : [];
            renderPppoeTable();
        }

        renderIntegrationSummaries(latestIntegrationSettings);
        loadMikrotikInfo();
    };

    const clearSensitiveIntegrationInputs = (provider) => {
        const editor = getIntegrationEditor(provider);
        if (!editor) return;
        const selectorsByProvider = {
            xendit: ['input[name="apiKey"]', 'input[name="webhookSecret"]'],
            semaphore: ['input[name="apiKey"]'],
            email: ['input[name="username"]', 'input[name="password"]'],
            genieacs: ['input[name="username"]', 'input[name="password"]'],
            ipBrowser: ['input[name="username"]', 'input[name="password"]']
        };
        (selectorsByProvider[provider] || []).forEach((selector) => {
            const input = editor.querySelector(selector);
            if (!input) return;
            input.value = '';
            input.defaultValue = '';
            input.setAttribute('autocomplete', selector.includes('password') ? 'new-password' : 'off');
            input.setAttribute('data-lpignore', 'true');
            input.setAttribute('data-1p-ignore', 'true');
        });
    };

    const scheduleSensitiveInputClear = (provider) => {
        clearSensitiveIntegrationInputs(provider);
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => clearSensitiveIntegrationInputs(provider));
        }
        [50, 250, 800].forEach((delay) => {
            setTimeout(() => clearSensitiveIntegrationInputs(provider), delay);
        });
    };

    const fetchIntegrationSettings = async () => {
        try {
            const res = await fetch('/api/integrations', { credentials: 'include', cache: 'no-store' });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Failed to load integration settings');
            populateIntegrationForms(data.settings || {});
        } catch (e) {
            console.warn('Failed to load integration settings', e);
            populateIntegrationForms({});
        }
    };

    const openMikrotikModal = (router = null) => {
        if (!mikrotikModal) return;
        if (mikrotikModalForm) mikrotikModalForm.reset();
        setMikrotikModalTestResult('');
        if (router) {
            editingMikrotikId = router.id;
            if (mikrotikModalTitle) mikrotikModalTitle.textContent = 'Edit MikroTik Router';
            if (mikrotikLabelInput) mikrotikLabelInput.value = router.label || '';
            if (mikrotikAddressInput) mikrotikAddressInput.value = router.address || '';
            if (mikrotikUsernameInput) mikrotikUsernameInput.value = router.username || '';
            if (mikrotikPasswordInput) mikrotikPasswordInput.value = router.password || '';
            if (mikrotikPortInput) mikrotikPortInput.value = router.port ? String(router.port) : '';
        } else {
            editingMikrotikId = null;
            if (mikrotikModalTitle) mikrotikModalTitle.textContent = 'Add MikroTik Router';
        }
        if (activeIntegrationEditor?.provider === 'mikrotik') {
            suspendIntegrationOverlayForMikrotik();
        }
        bringOverlayToFront(mikrotikModal, integrationEditModal?.classList.contains('active') ? 2600 : 2200);
        mikrotikModal.classList.add('active');
        (mikrotikAddressInput || mikrotikLabelInput)?.focus({ preventScroll: true });
    };

    const closeMikrotikModalFn = () => {
        if (!mikrotikModal) return;
        mikrotikModal.classList.remove('active');
        mikrotikModal.style.removeProperty('z-index');
        if (mikrotikModalForm) mikrotikModalForm.reset();
        setMikrotikModalTestResult('');
        editingMikrotikId = null;
        if (suspendedIntegrationForMikrotik) {
            resumeIntegrationOverlayAfterMikrotik();
        }
    };

    document.addEventListener('click', (event) => {
        const addRouterBtn = event.target.closest('#mikrotik-add-router');
        if (!addRouterBtn) return;
        event.preventDefault();
        openMikrotikModal();
    }, true);

    [mikrotikAddressInput, mikrotikUsernameInput, mikrotikPasswordInput, mikrotikPortInput].forEach((input) => {
        if (!input) return;
        input.addEventListener('input', () => setMikrotikModalTestResult(''));
    });

    if (testMikrotikRouter) {
        testMikrotikRouter.addEventListener('click', async () => {
            const unlock = window.withButtonLock
                ? window.withButtonLock(testMikrotikRouter, { label: '<i class="fa-solid fa-circle-notch fa-spin"></i> Testing...' })
                : null;
            if (window.withButtonLock && !unlock) return;
            try {
                const payload = collectMikrotikModalCredentials();
                if (editingMikrotikId) {
                    payload.routerId = editingMikrotikId;
                }
                setMikrotikModalTestResult('Testing MikroTik connection...');
                const { response, data } = await fetchJsonWithTimeout(
                    '/api/mikrotik/test',
                    {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    },
                    MIKROTIK_TEST_TIMEOUT_MS
                );
                if (!response.ok || !data?.ok) {
                    throw new Error(data?.error || 'Failed to reach MikroTik.');
                }
                setMikrotikModalTestResult('MikroTik test successful.', 'success');
            } catch (err) {
                setMikrotikModalTestResult(err?.message || 'Failed to reach MikroTik.', 'error');
            } finally {
                if (unlock) unlock();
            }
        });
    }

    if (saveMikrotikRouter) {
        saveMikrotikRouter.addEventListener('click', async () => {
            const unlock = window.withButtonLock
                ? window.withButtonLock(saveMikrotikRouter, { label: '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...' })
                : null;
            if (window.withButtonLock && !unlock) return;
            try {
                const label = mikrotikLabelInput?.value?.trim() || '';
                const address = mikrotikAddressInput?.value?.trim() || '';
                const username = mikrotikUsernameInput?.value?.trim() || '';
                const password = mikrotikPasswordInput?.value || '';
                const portRaw = mikrotikPortInput?.value?.trim() || '';
                if (!address || !username || !password) {
                    showInlineMessage(mikrotikPanel, 'Address, username, and password are required.', 'error');
                    return;
                }
                let port;
                if (portRaw) {
                    const portNum = Number(portRaw);
                    if (!Number.isFinite(portNum) || portNum <= 0) {
                        showInlineMessage(mikrotikPanel, 'Port must be a positive number.', 'error');
                        return;
                    }
                    port = portNum;
                }
                const router = normalizeRouter({
                    id: editingMikrotikId || generateRouterId(),
                    label,
                    address,
                    username,
                    password,
                    port
                });
                const currentDefaultId = mikrotikDefaultSelect?.value || '';
                if (editingMikrotikId) {
                    mikrotikRouters = mikrotikRouters.map((item) => (item.id === editingMikrotikId ? router : item));
                } else {
                    mikrotikRouters = [...mikrotikRouters, router];
                }
                const preferredId = currentDefaultId || router.id;
                renderRouterTable(mikrotikRouters, preferredId);
                const saved = await persistMikrotikFromState(
                    editingMikrotikId ? 'MikroTik router updated.' : 'MikroTik router added.'
                );
                if (saved) {
                    closeMikrotikModalFn();
                }
            } finally {
                if (unlock) unlock();
            }
        });
    }

    if (closeMikrotikModal) {
        closeMikrotikModal.addEventListener('click', closeMikrotikModalFn);
    }

    if (cancelMikrotikModal) {
        cancelMikrotikModal.addEventListener('click', closeMikrotikModalFn);
    }

    if (mikrotikModal) {
        mikrotikModal.addEventListener('click', (e) => {
            if (e.target === mikrotikModal) {
                closeMikrotikModalFn();
            }
        });
    }

    if (mikrotikRouterBody) {
        mikrotikRouterBody.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-router-action]');
            if (!btn) return;
            const row = btn.closest('tr');
            const routerId = row?.dataset.routerId || '';
            if (!routerId) return;
            const router = mikrotikRouters.find((item) => item.id === routerId);
            if (!router) return;
            if (btn.dataset.routerAction === 'edit') {
                openMikrotikModal(router);
                return;
            }
            if (btn.dataset.routerAction === 'remove') {
                const previousRouters = mikrotikRouters.map((item) => ({ ...item }));
                mikrotikRouters = mikrotikRouters.filter((item) => item.id !== routerId);
                const currentDefaultId = mikrotikDefaultSelect?.value || '';
                renderRouterTable(mikrotikRouters, currentDefaultId);
                const saved = await persistMikrotikFromState('MikroTik router removed.');
                if (!saved) {
                    mikrotikRouters = previousRouters;
                    renderRouterTable(mikrotikRouters, currentDefaultId);
                }
            }
        });
    }

    if (mikrotikDefaultSelect) {
        mikrotikDefaultSelect.addEventListener('change', () => {
            if (!mikrotikRouters.length) return;
            persistMikrotikFromState('Default router updated.');
        });
    }

    if (ipBrowserAddProfileBtn) {
        ipBrowserAddProfileBtn.addEventListener('click', () => {
            if (ipBrowserProfiles.length >= 100) {
                showInlineMessage(ipBrowserPanel, 'IP Browser supports up to 100 router profiles.', 'error');
                return;
            }
            openIpBrowserProfileModal();
        });
    }

    [closeIpBrowserProfileModal, cancelIpBrowserProfileModal].forEach((button) => {
        button?.addEventListener('click', closeIpBrowserProfileModalFn);
    });

    ipBrowserProfileModal?.addEventListener('click', (event) => {
        if (event.target === ipBrowserProfileModal) closeIpBrowserProfileModalFn();
    });

    if (saveIpBrowserProfile) {
        saveIpBrowserProfile.addEventListener('click', () => {
            const current = editingIpBrowserProfileId
                ? ipBrowserProfiles.find((profile) => profile.id === editingIpBrowserProfileId)
                : null;
            const label = String(ipBrowserProfileLabelInput?.value || '').trim();
            const matches = normalizeIpBrowserMatchList(ipBrowserProfileMatchesInput?.value || '');
            const username = String(ipBrowserProfileUsernameInput?.value || '').trim();
            const password = String(ipBrowserProfilePasswordInput?.value || '');
            const delayRaw = String(ipBrowserProfileDelayInput?.value ?? '').trim();
            const delayMs = delayRaw ? Number(delayRaw) : 600;
            if (!label) {
                showInlineMessage(ipBrowserPanel, 'Router profile name is required.', 'error');
                ipBrowserProfileLabelInput?.focus();
                return;
            }
            if (!matches.length) {
                showInlineMessage(ipBrowserPanel, 'Add at least one gateway, assigned IP, CIDR, or wildcard match.', 'error');
                ipBrowserProfileMatchesInput?.focus();
                return;
            }
            if (matches.some((rule) => rule.length > 200)) {
                showInlineMessage(ipBrowserPanel, 'Each gateway or IP match must be 200 characters or fewer.', 'error');
                return;
            }
            const invalidCidr = matches.find((rule) => {
                if (!rule.includes('/') || /^https?:\/\//i.test(rule)) return false;
                const match = rule.match(/^((?:\d{1,3}\.){3}\d{1,3})\/(\d{1,2})$/);
                if (!match) return true;
                const octets = match[1].split('.').map(Number);
                return octets.some((part) => part < 0 || part > 255) || Number(match[2]) > 32;
            });
            if (invalidCidr) {
                showInlineMessage(ipBrowserPanel, `Invalid CIDR match: ${invalidCidr}`, 'error');
                return;
            }
            if (!username && !current?.usernameSet) {
                showInlineMessage(ipBrowserPanel, 'Router profile username is required.', 'error');
                ipBrowserProfileUsernameInput?.focus();
                return;
            }
            if (!password && !current?.passwordSet) {
                showInlineMessage(ipBrowserPanel, 'Router profile password is required.', 'error');
                ipBrowserProfilePasswordInput?.focus();
                return;
            }
            if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 5000) {
                showInlineMessage(ipBrowserPanel, 'Router profile delay must be between 0 and 5000 ms.', 'error');
                return;
            }
            const selectorChecks = [
                validateCssSelector(ipBrowserProfileUsernameSelectorInput?.value, 'Profile username selector'),
                validateCssSelector(ipBrowserProfilePasswordSelectorInput?.value, 'Profile password selector'),
                validateCssSelector(ipBrowserProfileSubmitSelectorInput?.value, 'Profile submit selector')
            ];
            const invalidSelector = selectorChecks.find((result) => !result.valid);
            if (invalidSelector) {
                showInlineMessage(ipBrowserPanel, invalidSelector.message, 'error');
                return;
            }

            const otherRules = new Map();
            ipBrowserProfiles.forEach((profile) => {
                if (profile.id === editingIpBrowserProfileId) return;
                profile.matches.forEach((rule) => otherRules.set(rule.toLowerCase(), profile.label));
            });
            const duplicateRule = matches.find((rule) => otherRules.has(rule.toLowerCase()));
            if (duplicateRule) {
                showInlineMessage(
                    ipBrowserPanel,
                    `${duplicateRule} is already assigned to ${otherRules.get(duplicateRule.toLowerCase())}.`,
                    'error'
                );
                return;
            }

            const nextProfile = normalizeIpBrowserProfile({
                ...(current || {}),
                id: current?.id || generateIpBrowserProfileId(),
                label,
                matches,
                username: username || current?.username || '',
                usernameSet: Boolean(username || current?.usernameSet),
                password: password || current?.password || '',
                passwordSet: Boolean(password || current?.passwordSet),
                usernameSelector: ipBrowserProfileUsernameSelectorInput?.value,
                passwordSelector: ipBrowserProfilePasswordSelectorInput?.value,
                submitSelector: ipBrowserProfileSubmitSelectorInput?.value,
                delayMs,
                enabled: Boolean(ipBrowserProfileEnabledInput?.checked)
            });
            if (current) {
                ipBrowserProfiles = ipBrowserProfiles.map((profile) => (
                    profile.id === current.id ? nextProfile : profile
                ));
            } else {
                ipBrowserProfiles = [...ipBrowserProfiles, nextProfile];
            }
            renderIpBrowserProfiles();
            closeIpBrowserProfileModalFn();
        });
    }

    ipBrowserProfileBody?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-ip-browser-profile-action]');
        if (!button) return;
        const profileId = button.closest('tr')?.dataset.profileId || '';
        const profile = ipBrowserProfiles.find((entry) => entry.id === profileId);
        if (!profile) return;
        if (button.dataset.ipBrowserProfileAction === 'edit') {
            openIpBrowserProfileModal(profile);
            return;
        }
        if (button.dataset.ipBrowserProfileAction === 'remove') {
            ipBrowserProfiles = ipBrowserProfiles.filter((entry) => entry.id !== profileId);
            renderIpBrowserProfiles();
        }
    });

    // Account table actions
    const handleAccountAction = async (button, action, accountName, accountId) => {
        const isAdminAccount = isProtectedAdminId(accountId);
        
        if (action === 'delete' && isAdminAccount) {
            showInlineMessage(accountsPanel, 'Default admin account cannot be deleted.', 'error');
            return;
        }
        
        const messages = {
            edit: isAdminAccount ? 'Editing admin credentials...' : `Editing ${accountName} account...`,
            delete: `Are you sure you want to delete ${accountName}?`,
            lock: isAdminAccount ? 'Admin account locked (emergency access only).' : `${accountName} account has been disabled.`,
            unlock: `${accountName} account has been reactivated.`
        };
        
        if (action === 'delete') {
            const confirmed = window.appConfirm
                ? await window.appConfirm(messages[action], { title: 'Delete Account' })
                : window.confirm(messages[action]);
            if (confirmed) {
                                // Call backend to delete
                                const row = button.closest('tr');
                                if (!row) return; // safety: no row context
                                const id = row.dataset.accountId || '';
                                if (!id) return;
                                fetch(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' })
                                    .then(async (res) => {
                                        const data = await res.json().catch(() => ({}));
                                        if (!res.ok) throw new Error(data?.error || 'Delete failed');
                                        await fetchAccounts();
                                        showInlineMessage(accountsPanel, `${accountName} account deleted successfully.`, 'success');
                                    })
                                    .catch(err => showInlineMessage(accountsPanel, err.message || 'Delete failed', 'error'));
            }
        } else if (action === 'edit') {
            const row = button.closest('tr');
            if (!row) return; // safety: no row
            const idCell = row.querySelector('td:nth-child(1)');
            const userCell = row.querySelector('td:nth-child(2)');
            const roleSpan = row.querySelector('td:nth-child(3) span');
            if (!idCell || !userCell || !roleSpan) return; // malformed row
            const id = row.dataset.accountId || idCell.textContent;
            const username = row.dataset.accountName || userCell.textContent;
            const roleText = row.dataset.accountRoles || roleSpan.textContent;
            
            openModal('edit', {
                id,
                username,
                role: roleText,
                row
            });
        } else {
            showInlineMessage(accountsPanel, messages[action], 'success');
        }
    };
    
    // Use event delegation for better handling of dynamic content
    const setupEventDelegation = () => {
        if (accountsTable) {
            accountsTable.addEventListener('click', (e) => {
                const button = e.target.closest('.icon-btn');
                if (!button) return;
                
                e.preventDefault();
                
                const row = button.closest('tr');
                if (!row) return; // safety: not inside a row
                const idCell = row.querySelector('td:nth-child(1)');
                const nameCell = row.querySelector('td:nth-child(2)');
                if (!idCell || !nameCell) return;
                const accountId = row.dataset.accountId || idCell.textContent;
                const accountName = row.dataset.accountName || nameCell.textContent;
                
                const action = button.dataset.accountAction;
                const ariaLabel = String(button.getAttribute('aria-label') || '');

                if (action === 'edit' || ariaLabel.includes('Edit')) {
                    handleAccountAction(button, 'edit', accountName, accountId);
                } else if (action === 'delete' || ariaLabel.includes('Delete')) {
                    handleAccountAction(button, 'delete', accountName, accountId);
                } else if (ariaLabel.includes('Lock')) {
                    handleAccountAction(button, 'lock', accountName, accountId);
                }
            });
        }
    };
    
    // Legacy function for compatibility (now just calls event delegation)
    const attachAccountListeners = () => {
        console.log('Account listeners attached via event delegation');
    };
    
    // Initialize event delegation
    setupEventDelegation();

    // Modal elements
    const modal = document.getElementById('userModal');
    const modalTitle = document.getElementById('modalTitle');
    const closeModal = document.getElementById('closeModal');
    const cancelModal = document.getElementById('cancelModal');
    const saveUser = document.getElementById('saveUser');
    const userForm = document.getElementById('userForm');
    const modalUsername = document.getElementById('modalUsername');
    const modalPassword = document.getElementById('modalPassword');
    const modalPasswordToggle = document.getElementById('modalPasswordToggle');
    const modalPasswordHint = document.getElementById('modalPasswordHint');
    const modalRole = document.getElementById('modalRole');
    const modalRoleChecks = Array.from(document.querySelectorAll('[data-modal-role]'));
    
    let currentEditingRow = null;
    const setModalPasswordVisible = (visible) => {
        if (!modalPassword) return;
        const show = Boolean(visible);
        modalPassword.type = show ? 'text' : 'password';
        if (modalPasswordToggle) {
            modalPasswordToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
            modalPasswordToggle.setAttribute('title', show ? 'Hide password' : 'Show password');
            modalPasswordToggle.innerHTML = show
                ? '<i class="fa-solid fa-eye-slash"></i>'
                : '<i class="fa-solid fa-eye"></i>';
        }
    };
    const setModalPasswordHint = (mode = 'add') => {
        if (!modalPasswordHint) return;
        modalPasswordHint.textContent = mode === 'edit'
            ? 'Existing passwords are stored securely and cannot be shown. Leave blank to keep the current password.'
            : 'Set a password for this user.';
    };
    const syncModalRoleValue = () => {
        const roles = modalRoleChecks
            .filter((checkbox) => checkbox.checked)
            .map((checkbox) => checkbox.value);
        if (modalRole) modalRole.value = rolesToStoredValue(roles, '');
        return roles;
    };
    const setModalRoles = (roles = []) => {
        const selected = new Set(normalizeRoles(roles, []));
        modalRoleChecks.forEach((checkbox) => {
            checkbox.checked = selected.has(normalizeRoleName(checkbox.value));
        });
        syncModalRoleValue();
    };
    const setModalRolesDisabled = (disabled = false) => {
        modalRoleChecks.forEach((checkbox) => {
            checkbox.disabled = Boolean(disabled);
        });
    };
    
    // Modal functions
    const openModal = (mode = 'add', userData = null) => {
        if (mode === 'add') {
            modalTitle.textContent = 'Add New User';
            modalUsername.value = '';
            modalPassword.value = '';
            setModalPasswordVisible(false);
            modalPassword.required = true;
            setModalPasswordHint('add');
            setModalRoles([]);
            setModalRolesDisabled(false);
            currentEditingRow = null;
        } else if (mode === 'edit') {
            modalTitle.textContent = 'Edit User';
            modalUsername.value = userData.username;
            modalPassword.value = '';
            setModalPasswordVisible(false);
            modalPassword.required = false;
            setModalPasswordHint('edit');
            setModalRoles(userData.role);
            // If editing protected admin accounts, lock role to Admin
            if (userData && isProtectedAdminId(userData.id)) {
                setModalRoles(['Admin']);
                setModalRolesDisabled(true);
            } else {
                setModalRolesDisabled(false);
            }
            currentEditingRow = userData.row;
        }
        modal.classList.add('active');
    };
    
    const closeModalFn = () => {
        modal.classList.remove('active');
        userForm.reset();
        // Restore password field masking by default after closing
        setModalPasswordVisible(false);
        modalPassword.required = true;
        setModalPasswordHint('add');
        setModalRoles([]);
        setModalRolesDisabled(false);
        currentEditingRow = null;
    };
    
    // Add user functionality
    if (inviteUserBtn) {
        inviteUserBtn.addEventListener('click', () => {
            openModal('add');
        });
    }
    
    // Modal event listeners
    if (closeModal) {
        closeModal.addEventListener('click', closeModalFn);
    }

    if (cancelModal) {
        cancelModal.addEventListener('click', closeModalFn);
    }

    if (modalPasswordToggle) {
        modalPasswordToggle.addEventListener('click', () => {
            setModalPasswordVisible(modalPassword?.type === 'password');
        });
    }

    modalRoleChecks.forEach((checkbox) => {
        checkbox.addEventListener('change', syncModalRoleValue);
    });
    
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModalFn();
            }
        });
    }
    
    // Save user functionality
    if (saveUser) {
        saveUser.addEventListener('click', () => {
            const unlock = window.withButtonLock
                ? window.withButtonLock(saveUser, { label: '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...' })
                : null;
            if (window.withButtonLock && !unlock) return;
            const username = modalUsername.value.trim();
            const password = modalPassword.value;
            let roles = syncModalRoleValue();
            let role = rolesToStoredValue(roles, '');
            
            const isEdit = Boolean(currentEditingRow);
            const passwordTrimmed = typeof password === 'string' ? password.trim() : '';

            if (!username || !role) {
                alert('Please fill in all required fields');
                if (unlock) unlock();
                return;
            }

            if (!isEdit && !passwordTrimmed) {
                alert('Password is required');
                if (unlock) unlock();
                return;
            }

            if (passwordTrimmed && passwordTrimmed !== password) {
                alert('Password cannot start or end with spaces');
                if (unlock) unlock();
                return;
            }
            
            if (passwordTrimmed && passwordTrimmed.length < 6) {
                alert('Password must be at least 6 characters');
                if (unlock) unlock();
                return;
            }

            const finalize = () => {
                if (unlock) unlock();
            };
            
            if (currentEditingRow) {
                // Edit existing user
                // If editing admin row (ID 1), enforce Admin role regardless of UI
                const rowRef = currentEditingRow; // capture before modal closes
                const idCellRef = rowRef.querySelector('td:nth-child(1)');
                const editingId = String(rowRef.dataset.accountId || idCellRef?.textContent || '').trim();
                if (!editingId) { closeModalFn(); finalize(); return; }
                if (isProtectedAdminId(editingId)) {
                    roles = ['Admin'];
                    role = 'Admin';
                }
                // Push to backend
                fetch(`/api/accounts/${encodeURIComponent(editingId)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        username,
                        role,
                        roles,
                        ...(passwordTrimmed ? { password: passwordTrimmed } : {})
                    })
                }).then(async (res) => {
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data?.error || 'Update failed');
                    await fetchAccounts();
                    showInlineMessage(accountsPanel, `User "${username}" updated successfully`, 'success');
                }).catch(err => showInlineMessage(accountsPanel, err.message || 'Update failed', 'error'))
                  .finally(finalize);
            } else {
                // Add new user
                fetch('/api/accounts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ username, password: passwordTrimmed, role, roles })
                }).then(async (res) => {
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data?.error || 'Create failed');
                    await fetchAccounts();
                    showInlineMessage(accountsPanel, `User "${username}" added successfully`, 'success');
                }).catch(err => showInlineMessage(accountsPanel, err.message || 'Create failed', 'error'))
                  .finally(finalize);
            }
            
            closeModalFn();
        });
    }
    
    const persistIntegrationSettings = async (provider, payload) => {
        const res = await fetch(`/api/integrations/${encodeURIComponent(provider)}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Save failed');
        populateIntegrationForms(data.settings || {});
        if (provider === 'genieacs' && typeof window.syncGenieacsSidebar === 'function') {
            window.syncGenieacsSidebar();
        }
        if (provider === 'mikrotik' && typeof window.syncMikrotikSidebar === 'function') {
            window.syncMikrotikSidebar();
        }
        return true;
    };

    // Validation functions
    const validateGcashSettings = (formData) => {
        const accountName = String(formData.accountName || '').trim();
        const accountNumber = String(formData.accountNumber || '').trim();
        const qrCodeImageData = String(formData.qrCodeImageData || '').trim();
        const numberPattern = /^(\+?63|0)?\d{10}$/;
        if (!accountName && !accountNumber && !qrCodeImageData) {
            return { valid: true };
        }
        if (!accountName) {
            return { valid: false, message: 'GCash account name is required.' };
        }
        if (!accountNumber) {
            return { valid: false, message: 'GCash account number is required.' };
        }
        const numericOnly = accountNumber.replace(/\D/g, '');
        if (!numberPattern.test(accountNumber) && numericOnly.length !== 11) {
            return { valid: false, message: 'Please enter a valid GCash mobile number.' };
        }
        return { valid: true };
    };

    const buildGcashPayload = () => {
        const accountName = String(gcashNameInput?.value || '').trim();
        const accountNumber = String(gcashNumberInput?.value || '').trim();
        const qrCodeImageData = String(gcashQrDataInput?.value || '').trim();
        return {
            accountName,
            accountNumber,
            qrCodeImageData
        };
    };

    const validateXenditSettings = (formData) => {
        const current = latestIntegrationSettings.xendit || {};
        const apiKey = String(formData.apiKey || '').trim();
        const webhookSecret = String(formData.webhookSecret || '').trim();
        if ((!apiKey && !current.apiKeySet) || (apiKey && apiKey.length < 10)) {
            return { valid: false, message: 'Please enter a valid Xendit API Key' };
        }
        if (!formData.transactionFee || isNaN(parseFloat(formData.transactionFee))) {
            return { valid: false, message: 'Please enter a valid transaction fee amount' };
        }
        if ((!webhookSecret && !current.webhookSecretSet) || (webhookSecret && webhookSecret.length < 8)) {
            return { valid: false, message: 'Webhook secret is required and must be at least 8 characters' };
        }
        return { valid: true };
    };
    
    const validateSemaphoreSettings = (formData) => {
        const current = latestIntegrationSettings.semaphore || {};
        const apiKey = String(formData.apiKey || '').trim();
        if ((!apiKey && !current.apiKeySet) || (apiKey && apiKey.length < 10)) {
            return { valid: false, message: 'Please enter a valid Semaphore API Key' };
        }
        if (!formData.senderName || formData.senderName.length < 2) {
            return { valid: false, message: 'Please enter a valid sender name' };
        }
        return { valid: true };
    };

    const validateEmailSettings = (formData) => {
        const current = latestIntegrationSettings.email || {};
        const host = String(formData.host || '').trim();
        const username = String(formData.username || '').trim();
        const fromName = String(formData.fromName || '').trim();
        const password = String(formData.password || '').trim();
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!host) return { valid: false, message: 'SMTP host is required.' };
        if (!current.usernameSet && (!username || !emailPattern.test(username))) {
            return { valid: false, message: 'Please enter a valid Email Address.' };
        }
        if (username && !emailPattern.test(username)) {
            return { valid: false, message: 'Please enter a valid Email Address.' };
        }
        if (!fromName) return { valid: false, message: 'Hostname is required.' };
        if (!current.passwordSet && !password) return { valid: false, message: 'SMTP password is required.' };

        return { valid: true };
    };

    const buildEmailPayload = (formData) => {
        const host = String(formData.host || '').trim();
        const username = String(formData.username || '').trim();
        const fromName = String(formData.fromName || '').trim();
        const password = String(formData.password || '').trim();
        return {
            host,
            username,
            password,
            fromName,
            fromEmail: username,
            port: 587,
            secure: false
        };
    };

    const validateGenieacsSettings = (formData) => {
        const current = latestIntegrationSettings.genieacs || {};
        const host = sanitizeGenieacsHost(formData.host);
        const uiPort = normalizePortValue(formData.uiPort, '3000');
        const nbiPort = normalizePortValue(formData.nbiPort, '7557');
        const protocol = String(formData.protocol || 'http').trim().toLowerCase();
        const username = String(formData.username || '').trim();
        const password = String(formData.password || '').trim();
        const enabled = Boolean(formData.enabled);
        if (!host && !username && !password && !enabled) return { valid: true };
        if (!host) return { valid: false, message: 'GenieACS IP address or host is required.' };
        if (!uiPort) return { valid: false, message: 'UI port must be between 1 and 65535.' };
        if (!nbiPort) return { valid: false, message: 'NBI port must be between 1 and 65535.' };
        if (enabled && !username && !current.usernameSet) return { valid: false, message: 'GenieACS username is required.' };
        if (enabled && !password && !current.passwordSet) return { valid: false, message: 'GenieACS password is required.' };
        return { valid: true };
    };

    const buildGenieacsPayload = (formData) => {
        const current = latestIntegrationSettings.genieacs || {};
        const host = sanitizeGenieacsHost(formData.host);
        const protocol = String(formData.protocol || 'http').trim().toLowerCase();
        const username = String(formData.username || '').trim();
        const password = String(formData.password || '').trim();
        const hasCredentials = Boolean((username || current.usernameSet) && (password || current.passwordSet));
        return {
            enabled: Boolean(formData.enabled && host && hasCredentials),
            protocol: protocol === 'https' ? 'https' : 'http',
            host,
            username,
            password,
            uiPort: normalizePortValue(formData.uiPort, '3000') || '3000',
            nbiPort: normalizePortValue(formData.nbiPort, '7557') || '7557'
        };
    };

    const validateCssSelector = (selector, label) => {
        const text = String(selector || '').trim();
        if (!text) return { valid: true };
        if (text.length > 180) {
            return { valid: false, message: `${label} is too long.` };
        }
        try {
            document.createDocumentFragment().querySelector(text);
            return { valid: true };
        } catch {
            return { valid: false, message: `${label} must be a valid CSS selector.` };
        }
    };

    const validateIpBrowserSettings = (formData) => {
        const current = latestIntegrationSettings.ipBrowser || {};
        const enabled = Boolean(formData.autoLoginEnabled);
        const username = String(formData.username || '').trim();
        const password = String(formData.password || '');
        const delayRaw = String(formData.delayMs ?? '').trim();
        const defaultCredentialsReady = Boolean(
            (username || current.usernameSet) &&
            (password || current.passwordSet)
        );
        const enabledProfileReady = ipBrowserProfiles.some((profile) => (
            profile.enabled &&
            profile.matches.length &&
            profile.usernameSet &&
            profile.passwordSet
        ));
        if (enabled && !defaultCredentialsReady && !enabledProfileReady) {
            return {
                valid: false,
                message: 'Add default credentials or at least one enabled router profile with credentials.'
            };
        }
        if (delayRaw) {
            const delayMs = Number(delayRaw);
            if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 5000) {
                return { valid: false, message: 'Submit delay must be between 0 and 5000 ms.' };
            }
        }
        const selectorChecks = [
            validateCssSelector(formData.usernameSelector, 'Username selector'),
            validateCssSelector(formData.passwordSelector, 'Password selector'),
            validateCssSelector(formData.submitSelector, 'Submit selector'),
            ...ipBrowserProfiles.flatMap((profile) => ([
                validateCssSelector(profile.usernameSelector, `${profile.label} username selector`),
                validateCssSelector(profile.passwordSelector, `${profile.label} password selector`),
                validateCssSelector(profile.submitSelector, `${profile.label} submit selector`)
            ]))
        ];
        return selectorChecks.find((result) => !result.valid) || { valid: true };
    };

    const buildIpBrowserPayload = (formData) => {
        const delayRaw = String(formData.delayMs ?? '').trim();
        const delayMs = delayRaw ? Number(delayRaw) : 600;
        return {
            autoLoginEnabled: Boolean(formData.autoLoginEnabled),
            username: String(formData.username || '').trim(),
            password: String(formData.password || ''),
            usernameSelector: String(formData.usernameSelector || '').trim(),
            passwordSelector: String(formData.passwordSelector || '').trim(),
            submitSelector: String(formData.submitSelector || '').trim(),
            delayMs: Number.isFinite(delayMs) ? delayMs : 600,
            profiles: ipBrowserProfiles.map((profile) => ({
                id: profile.id,
                label: profile.label,
                enabled: profile.enabled,
                matches: profile.matches.slice(),
                username: profile.username,
                password: profile.password,
                usernameSelector: profile.usernameSelector,
                passwordSelector: profile.passwordSelector,
                submitSelector: profile.submitSelector,
                delayMs: profile.delayMs
            }))
        };
    };

    const validateMikrotikSettings = (routers = [], enabled = false) => {
        if (!routers.length) {
            if (!enabled) return { valid: true };
            return { valid: false, message: 'Add at least one MikroTik router.' };
        }
        const invalid = routers.find((router) => {
            return !router.address || !router.username || !router.password;
        });
        if (invalid) {
            return { valid: false, message: 'Each router needs address, username, and password.' };
        }
        return { valid: true };
    };

    const buildMikrotikPayloadFromState = () => {
        const requestedEnabled = Boolean(mikrotikToggle?.checked);
        const credentialsAvailable = mikrotikRouters.some((router) => {
            return Boolean(router.address && router.username && router.password);
        });
        const enabled = requestedEnabled && credentialsAvailable;
        const defaultId = mikrotikDefaultSelect?.value || mikrotikRouters[0]?.id || '';
        return {
            routers: mikrotikRouters.map((router) => ({ ...router, enabled })),
            defaultId,
            enabled
        };
    };

    const persistMikrotikFromState = async (successMessage) => {
        if (!mikrotikPanel) return false;
        const payload = buildMikrotikPayloadFromState();
        const validation = validateMikrotikSettings(payload.routers, payload.enabled);
        if (!validation.valid) {
            showInlineMessage(mikrotikPanel, validation.message, 'error');
            return false;
        }
        try {
            await persistIntegrationSettings('mikrotik', payload);
            if (successMessage) {
                showInlineMessage(mikrotikPanel, successMessage, 'success');
            }
            return true;
        } catch (err) {
            showInlineMessage(mikrotikPanel, err.message || 'Save failed', 'error');
            return false;
        }
    };

    const pppoeState = {
        accounts: []
    };

    const validatePppoe = (data) => {
        if (!data.username) return { valid: false, message: 'Username is required' };
        if (!data.password) return { valid: false, message: 'Password is required' };
        return { valid: true };
    };

    const MONTH_INDEX = {
        jan: 0,
        feb: 1,
        mar: 2,
        apr: 3,
        may: 4,
        jun: 5,
        jul: 6,
        aug: 7,
        sep: 8,
        oct: 9,
        nov: 10,
        dec: 11
    };

    const toFourDigitYear = (value) => {
        const year = Number(value);
        if (!Number.isFinite(year)) return NaN;
        if (year >= 100) return year;
        return 2000 + year;
    };

    const parseOfflineDate = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const normalized = raw.replace(/\s+/g, ' ');

        const applyTime = (hourText, minuteText, secondText, ampmText) => {
            let hour = Number(hourText || 0);
            const minute = Number(minuteText || 0);
            const second = Number(secondText || 0);
            if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) return null;
            if (minute < 0 || minute > 59 || second < 0 || second > 59) return null;
            const ampm = String(ampmText || '').trim().toUpperCase();
            if (ampm) {
                if (hour < 1 || hour > 12) return null;
                if (ampm === 'PM' && hour !== 12) hour += 12;
                if (ampm === 'AM' && hour === 12) hour = 0;
            } else if (hour < 0 || hour > 23) {
                return null;
            }
            return { hour, minute, second };
        };

        const monthNameMatch = normalized.match(/^([A-Za-z]{3,9})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
        if (monthNameMatch) {
            const monthKey = monthNameMatch[1].slice(0, 3).toLowerCase();
            const month = MONTH_INDEX[monthKey];
            const day = Number(monthNameMatch[2]);
            const year = toFourDigitYear(monthNameMatch[3]);
            const time = applyTime(monthNameMatch[4], monthNameMatch[5], monthNameMatch[6], monthNameMatch[7]);
            if (Number.isFinite(month) && Number.isFinite(day) && Number.isFinite(year)) {
                const date = new Date(year, month, day, time?.hour || 0, time?.minute || 0, time?.second || 0);
                if (
                    date.getFullYear() === year &&
                    date.getMonth() === month &&
                    date.getDate() === day
                ) {
                    return date;
                }
            }
        }

        const numericSlashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
        if (numericSlashMatch) {
            const month = Number(numericSlashMatch[1]) - 1;
            const day = Number(numericSlashMatch[2]);
            const year = toFourDigitYear(numericSlashMatch[3]);
            const time = applyTime(numericSlashMatch[4], numericSlashMatch[5], numericSlashMatch[6], numericSlashMatch[7]);
            if (month >= 0 && month <= 11 && Number.isFinite(day) && Number.isFinite(year)) {
                const date = new Date(year, month, day, time?.hour || 0, time?.minute || 0, time?.second || 0);
                if (
                    date.getFullYear() === year &&
                    date.getMonth() === month &&
                    date.getDate() === day
                ) {
                    return date;
                }
            }
        }

        const isoLikeMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        if (isoLikeMatch) {
            const year = Number(isoLikeMatch[1]);
            const month = Number(isoLikeMatch[2]) - 1;
            const day = Number(isoLikeMatch[3]);
            const time = applyTime(isoLikeMatch[4], isoLikeMatch[5], isoLikeMatch[6], '');
            if (month >= 0 && month <= 11 && Number.isFinite(day) && Number.isFinite(year)) {
                const date = new Date(year, month, day, time?.hour || 0, time?.minute || 0, time?.second || 0);
                if (
                    date.getFullYear() === year &&
                    date.getMonth() === month &&
                    date.getDate() === day
                ) {
                    return date;
                }
            }
        }

        const fallback = new Date(normalized);
        return Number.isNaN(fallback.getTime()) ? null : fallback;
    };

    const formatOfflineDate = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const parsed = parseOfflineDate(raw);
        if (!parsed) return raw;
        const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(parsed);
        const timeLabel = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        }).format(parsed);
        return `${monthLabel} ${parsed.getDate()}, ${parsed.getFullYear()} ${timeLabel}`;
    };

    const getPppoeStatusInfo = (status, inactiveSince) => {
        const normalized = String(status || '').toLowerCase();
        const formattedOffline = formatOfflineDate(inactiveSince);
        const meta = formattedOffline || '';
        if (normalized === 'online') {
            return { label: 'Online', pillClass: 'status-pill status-pill--good', meta: '' };
        }
        if (normalized === 'offline') {
            return { label: 'Offline', pillClass: 'status-pill status-pill--neutral', meta };
        }
        if (normalized === 'disabled' || normalized === 'inactive') {
            return { label: 'Disabled', pillClass: 'status-pill status-pill--alert', meta };
        }
        if (normalized === 'active') {
            // Backward compatibility: treat legacy "active" as online
            return { label: 'Online', pillClass: 'status-pill status-pill--good', meta: '' };
        }
        return { label: 'Unknown', pillClass: 'status-pill', meta: '' };
    };

    const renderPppoeTable = () => {
        if (!pppoeTableBody) return;
        const rows = pppoeState.accounts;
        if (!rows.length) {
            pppoeTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:14px;">No PPPoE entries yet.</td></tr>`;
            return;
        }
        pppoeTableBody.innerHTML = rows
            .map((row, idx) => {
                const statusInfo = getPppoeStatusInfo(row.status, row.inactiveSince);
                return `
                    <tr data-index="${idx}">
                        <td>${row.username || ''}</td>
                        <td>${row.profile || ''}</td>
                        <td>${row.pairedCustomer || ''}</td>
                        <td>${row.pairedPppoe || ''}</td>
                        <td>
                            <div class="status-stack">
                                <span class="${statusInfo.pillClass}">${statusInfo.label}</span>
                                ${statusInfo.meta ? `<div class="status-stack__meta">${statusInfo.meta}</div>` : ''}
                            </div>
                        </td>
                        <td>
                            <div class="table-actions">
                                <button class="icon-btn danger" type="button" data-pppoe-action="delete" aria-label="Delete ${row.username || 'entry'}"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </td>
                    </tr>
                `;
            })
            .join('');
    };

    const persistPppoe = () => persistIntegrationSettings('pppoe', { accounts: pppoeState.accounts });
    
    // Load integration settings on page load
    fetchIntegrationSettings();
    fetchSystemUpdateStatus();

    if (systemUpdateRefreshBtn) {
        systemUpdateRefreshBtn.addEventListener('click', fetchSystemUpdateStatus);
    }

    if (systemUpdateCheckBtn) {
        systemUpdateCheckBtn.addEventListener('click', checkAndApplySystemUpdate);
    }


    if (gcashQrFileInput) {
        gcashQrFileInput.addEventListener('change', async () => {
            const file = gcashQrFileInput.files && gcashQrFileInput.files[0];
            if (!file) return;
            if (file.size > 4 * 1024 * 1024) {
                showInlineMessage(gcashPanel, 'QR code image is too large. Max size is 4 MB.', 'error');
                gcashQrFileInput.value = '';
                return;
            }
            try {
                const imageData = await readImageAsDataUrl(file);
                setGcashQrPreview(imageData);
            } catch (error) {
                showInlineMessage(gcashPanel, error.message || 'Unable to load QR code image.', 'error');
                gcashQrFileInput.value = '';
            }
        });
    }

    if (gcashClearQrBtn) {
        gcashClearQrBtn.addEventListener('click', () => {
            if (gcashQrFileInput) gcashQrFileInput.value = '';
            setGcashQrPreview('');
        });
    }

    const resolvePppoeRouterId = (entry = null) => {
        const explicit = String(entry?.routerId || '').trim();
        if (explicit) return explicit;
        return mikrotikDefaultSelect?.value || collectRoutersFromUI()[0]?.id || '';
    };

    const savePppoeToMikrotik = async (entry) => {
        const routerId = resolvePppoeRouterId(entry);
        const res = await fetch('/api/mikrotik/pppoe', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...entry, routerId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to save to MikroTik');
        return data.entry || entry;
    };

    const deletePppoeFromMikrotik = async (entry) => {
        const username = String(entry?.username || '').trim();
        if (!username) {
            throw new Error('Username is required');
        }
        const routerId = resolvePppoeRouterId(entry);
        const res = await fetch('/api/mikrotik/pppoe', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                delete: true,
                routerId
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to delete from MikroTik');
        return data;
    };

    const syncPppoeFromMikrotik = async () => {
        if (!pppoeSyncBtn) return;
        const originalLabel = pppoeSyncBtn.innerHTML;
        pppoeSyncBtn.disabled = true;
        pppoeSyncBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Syncing...`;
        try {
            const routerId = mikrotikDefaultSelect?.value || collectRoutersFromUI()[0]?.id || '';
            const res = await fetch('/api/mikrotik/pppoe/sync', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ routerId })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Sync failed');
            pppoeState.accounts = (Array.isArray(data.accounts) ? data.accounts : []).map((entry) => {
                if (entry?.routerId) return entry;
                return { ...entry, routerId };
            });
            renderPppoeTable();
            showInlineMessage(pppoePanel, `Synced ${pppoeState.accounts.length} PPPoE entries from MikroTik.`, 'success');
        } catch (err) {
            showInlineMessage(pppoePanel, err.message || 'Sync failed', 'error');
        } finally {
            pppoeSyncBtn.disabled = false;
            pppoeSyncBtn.innerHTML = originalLabel;
        }
    };
    
    // Enhanced form validation
    if (gcashForm) {
        const gcashSaveBtn = gcashForm.querySelector('.save-btn');
        if (gcashSaveBtn) {
            gcashSaveBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                const unlock = window.withButtonLock
                    ? window.withButtonLock(gcashSaveBtn, { label: '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...' })
                    : null;
                if (window.withButtonLock && !unlock) return;

                try {
                    const file = gcashQrFileInput?.files?.[0] || null;
                    if (file) {
                        if (file.size > 4 * 1024 * 1024) {
                            showInlineMessage(gcashPanel, 'QR code image is too large. Max size is 4 MB.', 'error');
                            return;
                        }
                        const imageData = await readImageAsDataUrl(file);
                        setGcashQrPreview(imageData);
                    }

                    const payload = buildGcashPayload();
                    const validation = validateGcashSettings(payload);
                    if (!validation.valid) {
                        showInlineMessage(gcashPanel, validation.message, 'error');
                        return;
                    }

                    await persistIntegrationSettings('gcash', payload);
                    closeIntegrationEditModal();
                    showInlineMessage(gcashPanel, 'GCash account settings saved successfully.', 'success');
                } catch (err) {
                    showInlineMessage(gcashPanel, err.message || 'Save failed', 'error');
                } finally {
                    if (unlock) unlock();
                }
            });
        }
    }

    if (xenditForm) {
        const xenditSaveBtn = xenditForm.querySelector('.save-btn');
        if (xenditSaveBtn) {
            xenditSaveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const unlock = window.withButtonLock
                    ? window.withButtonLock(xenditSaveBtn, { label: '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...' })
                    : null;
                if (window.withButtonLock && !unlock) return;
                const formData = collectFormValues(xenditForm);
                const validation = validateXenditSettings(formData);
                const payload = {
                    ...formData,
                    successRedirectUrl: '',
                    failureRedirectUrl: ''
                };
                
                if (validation.valid) {
                    persistIntegrationSettings('xendit', payload)
                        .then(() => {
                            closeIntegrationEditModal();
                            showInlineMessage(xenditPanel, 'Xendit payment gateway configured successfully.', 'success');
                        })
                        .catch((err) => showInlineMessage(xenditPanel, err.message || 'Save failed', 'error'))
                        .finally(() => {
                            if (unlock) unlock();
                        });
                } else {
                    showInlineMessage(xenditPanel, validation.message, 'error');
                    if (unlock) unlock();
                }
            });
        }
    }
    
    if (semaphoreForm) {
        const semaphoreSaveBtn = semaphoreForm.querySelector('.save-btn');
        if (semaphoreSaveBtn) {
            semaphoreSaveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const unlock = window.withButtonLock
                    ? window.withButtonLock(semaphoreSaveBtn, { label: '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...' })
                    : null;
                if (window.withButtonLock && !unlock) return;
                const formData = collectFormValues(semaphoreForm);
                const validation = validateSemaphoreSettings(formData);

                if (validation.valid) {
                    persistIntegrationSettings('semaphore', formData)
                        .then(() => {
                            closeIntegrationEditModal();
                            showInlineMessage(semaphorePanel, 'Semaphore SMS service configured successfully.', 'success');
                        })
                        .catch((err) => showInlineMessage(semaphorePanel, err.message || 'Save failed', 'error'))
                        .finally(() => {
                            if (unlock) unlock();
                        });
                } else {
                    showInlineMessage(semaphorePanel, validation.message, 'error');
                    if (unlock) unlock();
                }
            });
        }
    }

    if (emailForm) {
        const emailSaveBtn = emailForm.querySelector('.save-btn');
        if (emailSaveBtn) {
            emailSaveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const unlock = window.withButtonLock
                    ? window.withButtonLock(emailSaveBtn, { label: '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...' })
                    : null;
                if (window.withButtonLock && !unlock) return;

                const formData = collectFormValues(emailForm);
                const validation = validateEmailSettings(formData);

                if (validation.valid) {
                    const payload = buildEmailPayload(formData);
                    persistIntegrationSettings('email', payload)
                        .then(() => {
                            closeIntegrationEditModal();
                            showInlineMessage(emailPanel, 'Email SMTP settings saved successfully.', 'success');
                        })
                        .catch((err) => showInlineMessage(emailPanel, err.message || 'Save failed', 'error'))
                        .finally(() => {
                            if (unlock) unlock();
                        });
                } else {
                    showInlineMessage(emailPanel, validation.message, 'error');
                    if (unlock) unlock();
                }
            });
        }
    }

    if (genieacsForm) {
        const genieacsSaveBtn = genieacsForm.querySelector('.save-btn');
        if (genieacsSaveBtn) {
            genieacsSaveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const unlock = window.withButtonLock
                    ? window.withButtonLock(genieacsSaveBtn, { label: '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...' })
                    : null;
                if (window.withButtonLock && !unlock) return;

                const formData = collectFormValues(genieacsForm);
                const validation = validateGenieacsSettings(formData);

                if (validation.valid) {
                    const payload = buildGenieacsPayload(formData);
                    persistIntegrationSettings('genieacs', payload)
                        .then(() => {
                            closeIntegrationEditModal();
                            showInlineMessage(genieacsPanel, 'GenieACS settings saved successfully.', 'success');
                        })
                        .catch((err) => showInlineMessage(genieacsPanel, err.message || 'Save failed', 'error'))
                        .finally(() => {
                            if (unlock) unlock();
                        });
                } else {
                    showInlineMessage(genieacsPanel, validation.message, 'error');
                    if (unlock) unlock();
                }
            });
        }
    }

    if (ipBrowserForm) {
        const ipBrowserSaveBtn = ipBrowserForm.querySelector('.save-btn');
        if (ipBrowserSaveBtn) {
            ipBrowserSaveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const unlock = window.withButtonLock
                    ? window.withButtonLock(ipBrowserSaveBtn, { label: '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...' })
                    : null;
                if (window.withButtonLock && !unlock) return;

                const formData = collectFormValues(ipBrowserForm);
                const validation = validateIpBrowserSettings(formData);

                if (validation.valid) {
                    const payload = buildIpBrowserPayload(formData);
                    persistIntegrationSettings('ipBrowser', payload)
                        .then(() => {
                            closeIntegrationEditModal();
                            showInlineMessage(ipBrowserPanel, 'IP Browser auto-login settings saved successfully.', 'success');
                        })
                        .catch((err) => showInlineMessage(ipBrowserPanel, err.message || 'Save failed', 'error'))
                        .finally(() => {
                            if (unlock) unlock();
                        });
                } else {
                    showInlineMessage(ipBrowserPanel, validation.message, 'error');
                    if (unlock) unlock();
                }
            });
        }
    }

    // MikroTik settings are saved automatically when routers/default changes.

    if (mikrotikToggle) {
        mikrotikToggle.addEventListener('change', async () => {
            if (mikrotikToggleProgrammatic) return;
            const requestedState = mikrotikToggle.checked;
            if (requestedState && !hasMikrotikCredentials()) {
                showInlineMessage(mikrotikPanel, 'Enter address, username, and password before enabling MikroTik.', 'error');
                applyMikrotikEnabledState(false);
                return;
            }
            try {
                const routers = collectRoutersFromUI().map((router) => ({ ...router, enabled: requestedState }));
                const defaultId = mikrotikDefaultSelect?.value || routers[0]?.id || '';
                await persistIntegrationSettings('mikrotik', { routers, defaultId, enabled: requestedState });
                showInlineMessage(
                    mikrotikPanel,
                    requestedState ? 'MikroTik integration enabled.' : 'MikroTik integration disabled.',
                    'success'
                );
                applyMikrotikEnabledState(requestedState);
            } catch (err) {
                showInlineMessage(mikrotikPanel, err.message || 'Failed to update integration state', 'error');
                applyMikrotikEnabledState(!requestedState);
            }
        });
    }

    // PPPoE add
    if (pppoeAddBtn && pppoeForm) {
        pppoeAddBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const formData = collectFormValues(pppoeForm);
            const validation = validatePppoe(formData);
            if (!validation.valid) {
                showInlineMessage(pppoePanel, validation.message || 'Invalid data', 'error');
                return;
            }
            const entry = {
                username: formData.username || '',
                password: formData.password || '',
                profile: formData.profile || '',
                pairedCustomer: formData.pairedCustomer || '',
                pairedPppoe: formData.pairedPppoe || '',
                status: formData.status || 'active',
                inactiveSince: formData.inactiveSince || ''
            };
            const originalLabel = pppoeAddBtn.innerHTML;
            pppoeAddBtn.disabled = true;
            pppoeAddBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
            savePppoeToMikrotik(entry)
                .then((savedEntry) => {
                    pppoeState.accounts.push(savedEntry);
                    renderPppoeTable();
                    return persistPppoe();
                })
                .then(() => {
                    showInlineMessage(pppoePanel, 'PPPoE entry added and saved to MikroTik.', 'success');
                    pppoeForm.reset();
                })
                .catch((err) => {
                    showInlineMessage(pppoePanel, err.message || 'Save failed', 'error');
                })
                .finally(() => {
                    pppoeAddBtn.disabled = false;
                    pppoeAddBtn.innerHTML = originalLabel;
                });
        });
    }

    // PPPoE delete via delegation
    if (pppoeTableBody) {
        pppoeTableBody.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-pppoe-action="delete"]');
            if (!btn) return;
            const row = btn.closest('tr');
            const idx = row ? Number(row.getAttribute('data-index')) : -1;
            if (Number.isInteger(idx) && idx >= 0) {
                const confirmed = window.appConfirm
                    ? await window.appConfirm('Delete this PPPoE entry?', { title: 'Delete PPPoE Entry' })
                    : window.confirm('Delete this PPPoE entry?');
                if (!confirmed) return;
                const target = pppoeState.accounts[idx];
                const unlock = window.withButtonLock
                    ? window.withButtonLock(btn, { label: '<i class="fa-solid fa-circle-notch fa-spin"></i>' })
                    : null;
                if (window.withButtonLock && !unlock) return;
                try {
                    await deletePppoeFromMikrotik(target);
                    pppoeState.accounts.splice(idx, 1);
                    renderPppoeTable();
                    await persistPppoe();
                    showInlineMessage(pppoePanel, 'PPPoE entry removed.', 'success');
                } catch (err) {
                    showInlineMessage(pppoePanel, err.message || 'Delete failed', 'error');
                } finally {
                    if (unlock) unlock();
                }
            }
        });
    }

    // PPPoE sync placeholder
    if (pppoeSyncBtn) {
        pppoeSyncBtn.addEventListener('click', () => {
            syncPppoeFromMikrotik();
        });
    }
});
