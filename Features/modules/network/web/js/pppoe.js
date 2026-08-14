(function () {
  const pppoeForm = document.getElementById('pppoe-form');
  const pppoeAddBtn = document.getElementById('pppoe-add-btn');
  const pppoeSyncBtn = document.getElementById('pppoe-sync-btn');
  const pppoeTableBody = document.getElementById('pppoe-table-body');
  const toast = document.getElementById('toast');
  const searchInput = document.getElementById('pppoe-search');
  const statusChips = Array.from(document.querySelectorAll('[data-pppoe-status-chip]'));
  const assignmentChips = Array.from(document.querySelectorAll('[data-pppoe-assignment-chip]'));
  const pageSizeSelect = document.getElementById('pppoe-page-size');
  const routerSelect = document.getElementById('pppoe-router-select');
  const statusCard = document.getElementById('mikrotik-status-card');
  const statusDot = document.getElementById('mt-status-dot');
  const statusTitle = document.getElementById('mt-status-title');
  const statusSub = document.getElementById('mt-status-sub');
  const statusTimer = document.getElementById('mt-connection-timer');
  const statusRefreshBtn = document.getElementById('mt-info-refresh');
  const mtIdentity = document.getElementById('mt-identity');
  const mtAddress = document.getElementById('mt-address');
  const mtCpu = document.getElementById('mt-cpu-load');
  const mtUptime = document.getElementById('mt-uptime');
  const mtFreeMem = document.getElementById('mt-free-memory');
  const mtTotalMem = document.getElementById('mt-total-memory');
  const mtBoard = document.getElementById('mt-board');
  const mtVersion = document.getElementById('mt-version');
  const mtCpuIndicator = document.getElementById('mt-cpu-indicator');
  const mtCpuIndicatorBar = document.getElementById('mt-cpu-indicator-bar');
  const mtRamIndicator = document.getElementById('mt-ram-indicator');
  const mtRamIndicatorBar = document.getElementById('mt-ram-indicator-bar');
  const pppoeLastSyncTime = document.getElementById('pppoe-last-sync-time');
  const pppoeLastSyncState = document.getElementById('pppoe-last-sync-state');
  const pppoeSummaryTotal = document.getElementById('pppoe-summary-total');
  const pppoeSummaryOnline = document.getElementById('pppoe-summary-online');
  const pppoeSummaryOffline = document.getElementById('pppoe-summary-offline');
  const pppoeSummaryDisabled = document.getElementById('pppoe-summary-disabled');
  const pppoeSummaryUsage = document.getElementById('pppoe-summary-usage');
  const editModal = document.getElementById('pppoe-edit-modal');
  const editForm = document.getElementById('pppoe-edit-form');
  const editUsername = document.getElementById('pppoe-edit-username');
  const editPassword = document.getElementById('pppoe-edit-password');
  const editPasswordToggle = document.getElementById('pppoe-edit-password-toggle');
  const editProfile = document.getElementById('pppoe-edit-profile');
  const editClose = document.getElementById('pppoe-edit-close');
  const editCancel = document.getElementById('pppoe-edit-cancel');
  const assignModal = document.getElementById('pppoe-assign-modal');
  const assignForm = document.getElementById('pppoe-assign-form');
  const assignTitle = document.getElementById('pppoe-assign-title');
  const assignClose = document.getElementById('pppoe-assign-close');
  const assignUnassign = document.getElementById('pppoe-assign-unassign');
  const assignCancel = document.getElementById('pppoe-assign-cancel');
  const assignSave = document.getElementById('pppoe-assign-save');
  const assignCustomerSelect = document.getElementById('pppoe-assign-customer');
  const assignCustomerSearchInput = document.getElementById('pppoe-assign-customer-search');
  const assignCustomerResults = document.getElementById('pppoe-assign-customer-results');
  const assignUsernameInput = document.getElementById('pppoe-assign-username');
  const assignUsernameCopyBtn = document.getElementById('pppoe-assign-username-copy');
  const assignPasswordInput = document.getElementById('pppoe-assign-password');
  const assignPasswordCopyBtn = document.getElementById('pppoe-assign-password-copy');
  const assignProfileInput = document.getElementById('pppoe-assign-profile');
  const generateOpenBtn = document.getElementById('pppoe-generate-open-btn');
  const generateModal = document.getElementById('pppoe-generate-modal');
  const generateForm = document.getElementById('pppoe-generate-form');
  const generateClose = document.getElementById('pppoe-generate-close');
  const generateCancel = document.getElementById('pppoe-generate-cancel');
  const generateCustomerSelect = document.getElementById('pppoe-generate-customer');
  const generateCustomerSearchInput = document.getElementById('pppoe-generate-customer-search');
  const generateCustomerResults = document.getElementById('pppoe-generate-customer-results');
  const generateUsernameInput = document.getElementById('pppoe-generate-username');
  const generatePasswordInput = document.getElementById('pppoe-generate-password');
  const generateNote = document.getElementById('pppoe-generate-note');
  const generateSaveBtn = document.getElementById('pppoe-generate-save');
  const trafficModal = document.getElementById('pppoe-traffic-modal');
  const trafficTitle = document.getElementById('pppoe-traffic-title');
  const trafficSubtitle = document.getElementById('pppoe-traffic-subtitle');
  const trafficMeta = document.getElementById('pppoe-traffic-meta');
  const trafficClose = document.getElementById('pppoe-traffic-close');
  const trafficRateCanvas = document.getElementById('pppoe-traffic-rate-canvas');
  const trafficPacketCanvas = document.getElementById('pppoe-traffic-packet-canvas');
  const trafficRateEqualizer = document.getElementById('pppoe-traffic-rate-equalizer');
  const trafficPacketEqualizer = document.getElementById('pppoe-traffic-packet-equalizer');
  const trafficRateTooltip = document.getElementById('pppoe-traffic-rate-tooltip');
  const trafficPacketTooltip = document.getElementById('pppoe-traffic-packet-tooltip');
  const trafficStatus = document.getElementById('pppoe-traffic-status');
  const trafficStatusDot = document.getElementById('pppoe-traffic-status-dot');
  const trafficRateEmpty = document.getElementById('pppoe-traffic-rate-empty');
  const trafficPacketEmpty = document.getElementById('pppoe-traffic-packet-empty');
  const trafficDownloadRate = document.getElementById('pppoe-traffic-download-rate');
  const trafficUploadRate = document.getElementById('pppoe-traffic-upload-rate');
  const trafficDownloadPackets = document.getElementById('pppoe-traffic-download-packets');
  const trafficUploadPackets = document.getElementById('pppoe-traffic-upload-packets');
  const trafficUploadPeak = document.getElementById('pppoe-traffic-upload-peak');
  const trafficDownloadPeak = document.getElementById('pppoe-traffic-download-peak');
  const trafficTotalPackets = document.getElementById('pppoe-traffic-total-packets');
  const trafficPacketPeak = document.getElementById('pppoe-traffic-packet-peak');
  const trafficLatency = document.getElementById('pppoe-traffic-latency');
  const trafficLastUpdated = document.getElementById('pppoe-traffic-last-updated');
  const trafficInterface = document.getElementById('pppoe-traffic-interface');
  const trafficIp = document.getElementById('pppoe-traffic-ip');
  const sessionHistoryModal = document.getElementById('pppoe-session-history-modal');
  const sessionHistoryTitle = document.getElementById('pppoe-session-history-title');
  const sessionHistorySubtitle = document.getElementById('pppoe-session-history-subtitle');
  const sessionHistoryClose = document.getElementById('pppoe-session-history-close');
  const sessionHistoryCancel = document.getElementById('pppoe-session-history-cancel');
  const trafficSessionHistoryBody = document.getElementById('pppoe-session-history-body');
  const pppoeWorkbench = document.getElementById('pppoe-workbench');
  const pppoeDisabledNotice = document.getElementById('pppoe-disabled-notice');
  const disabledNoticeText = pppoeDisabledNotice?.querySelector('[data-pppoe-disabled-message]');

  const showToast = (msg, type = 'info') => {
    if (typeof window.appToast === 'function') {
      window.appToast(msg, { type });
      return;
    }
    if (!toast) return;
    const variant = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
    toast.textContent = msg;
    toast.className = `toast ${variant} show`;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  };

  const fallbackCopyText = (text) => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    textArea.style.pointerEvents = 'none';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    textArea.setSelectionRange(0, textArea.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (!ok) throw new Error('Copy command failed.');
  };

  const copyTextToClipboard = async (text) => {
    const value = String(text || '');
    if (!value.trim()) throw new Error('Nothing to copy.');
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // Fall back to the older execCommand path if clipboard permissions are blocked.
      }
    }
    fallbackCopyText(value);
  };

  const copyAssignFieldValue = async (input, label) => {
    const value = String(input?.dataset.copyValue || input?.value || '').trim();
    if (!value) {
      showToast(`No ${String(label || 'value').toLowerCase()} to copy.`, 'info');
      return;
    }
    try {
      await copyTextToClipboard(value);
      showToast(`${label} copied.`, 'success');
    } catch (error) {
      showToast(error.message || `Failed to copy ${String(label || 'value').toLowerCase()}.`, 'error');
    }
  };

  const state = { accounts: [] };
  const routerState = { routers: [], defaultId: '' };
  const routerRuntimeState = new Map();
  const trafficState = {
    selectedKey: '',
    samplesByKey: new Map(),
    maxSamples: 60,
    historyLimit: 90,
    minSampleIntervalMs: 850,
    selectedPointByPanel: {
      rate: null,
      packet: null
    },
    tooltipTimerByPanel: {
      rate: null,
      packet: null
    }
  };
  const trafficPlotByCanvas = new WeakMap();
  const BYTES_PER_GB = 1024 * 1024 * 1024;
  const PASSWORD_MASK_HTML = '&bull;&bull;&bull;&bull;&bull;&bull;';
  let activeRouterId = '';
  let connectedAt = null;
  let connectionTimerId = null;
  let wasConnected = false;
  let infoRefreshId = null;
  let lastInfo = null;
  let lastAddress = null;
  let planProfiles = [];
  let planLookupByName = new Map();
  const routerProfilesByRouterId = new Map();
  const routerProfilesLoaded = new Set();
  const TRAFFIC_EQUALIZER_SEGMENTS = 8;
  const TRAFFIC_TOOLTIP_HIDE_MS = 5000;
  const LIVE_STATUS_INTERVAL_MS = 1000;
  const INFO_REFRESH_INTERVAL_MS = 30000;
  const AUTO_SYNC_INTERVAL_MS = 30000;
  const PPPoE_SESSION_RESTART_GRACE_MS = 2 * 60 * 1000;
  const PPPoE_SESSION_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
  const activeRouterStorageKey = 'pppoeActiveRouterId';
  let liveStatusIntervalId = null;
  let liveStatusInFlight = false;
  let directTrafficInFlight = false;
  // Default to on; will auto-fallback if backend lacks the live endpoint
  let liveStatusSupported = true;
  let liveStatusErrorNotified = false;
  const pageSizeStorageKey = 'pppoePageSizeCompact';
  const initialPageSize =
    sessionStorage.getItem(pageSizeStorageKey) ||
    (pageSizeSelect ? pageSizeSelect.value : '50');
  const normalizeFilterValue = (value, allowedValues, fallback = 'all') => {
    const normalized = String(value || '').trim().toLowerCase();
    return allowedValues.includes(normalized) ? normalized : fallback;
  };
  const initialStatus = normalizeFilterValue(
    sessionStorage.getItem('pppoeStatus') || 'all',
    ['all', 'online', 'offline', 'disabled']
  );
  const initialAssignment = normalizeFilterValue(
    sessionStorage.getItem('pppoeAssignment') || 'all',
    ['all', 'assigned', 'unassigned']
  );
  const filters = { search: '', status: initialStatus, assignment: initialAssignment, pageSize: initialPageSize };
  let autoSyncId = null;
  let page = 1;
  const cacheKey = 'pppoeLastInfo';
  let customerLookupByUsername = new Map();
  let customerRecords = [];
  let customerByAccount = new Map();
  let assignCustomerSearchRows = [];
  let generateCustomerSearchRows = [];
  let coverageAreaRouterMap = new Map();
  let napBindingByAccount = new Map();
  let mikrotikConnected = false;
  let hasConfirmedOnlineStatus = false;
  let pageTransitioning = false;
  let usagePersistTimer = null;

  const isPageTransitioning = () => pageTransitioning || document.visibilityState === 'hidden';

  const normalizeSettingValue = (value) => String(value || '').trim();
  const normalizeRouterId = (value) => String(value || '').trim();
  const normalizeSecretId = (value) => String(value || '').trim();
  const normalizeCoverageAreaKey = (value) => String(value || '').trim().toLowerCase();
  const normalizePppoeUsernameKey = (value) => String(value || '').trim().toLowerCase();
  const normalizePlanName = (value) => String(value || '').trim().toLowerCase();
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const resolveCustomerCoverageAreaName = (customer = {}) => String(
    customer?.area || customer?.coverageArea || customer?.areaName || ''
  ).trim();
  const normalizePlanProfileBindings = (value) => {
    let source = value;
    if (typeof source === 'string') {
      const trimmed = source.trim();
      if (!trimmed) return {};
      try {
        source = JSON.parse(trimmed);
      } catch (_error) {
        return {};
      }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return {};
    }
    return Object.entries(source).reduce((acc, [routerId, profile]) => {
      const normalizedRouter = normalizeRouterId(routerId);
      const normalizedProfile = String(profile || '').trim();
      if (normalizedRouter && normalizedProfile) {
        acc[normalizedRouter] = normalizedProfile;
      }
      return acc;
    }, {});
  };
  const resolvePlanProfileForRouter = (plan, routerId = '', fallbackRouterId = '') => {
    if (!plan || typeof plan !== 'object') return '';
    const bindings = normalizePlanProfileBindings(plan.profileBindings || plan.profile_bindings);
    const primaryRouterId = normalizeRouterId(routerId);
    if (primaryRouterId) {
      return bindings[primaryRouterId] || '';
    }
    const fallbackId = normalizeRouterId(fallbackRouterId);
    if (fallbackId) {
      return bindings[fallbackId] || '';
    }
    return String(plan.profile || '').trim();
  };
  const claimActiveSessionForUsername = (activeMap, claimedUsernames, username) => {
    const usernameKey = normalizePppoeUsernameKey(username);
    if (!usernameKey) return null;
    const bucket = activeMap?.get(usernameKey) || null;
    const active = Array.isArray(bucket) ? (bucket.shift() || null) : bucket;
    if (!active) return null;
    if (active) claimedUsernames?.add(usernameKey);
    return active;
  };
  const getAccountIdentityKey = (entry, fallbackRouterId = '') => {
    const routerId = normalizeRouterId(entry?.routerId) || fallbackRouterId || routerState.defaultId || '';
    const secretId = normalizeSecretId(entry?.secretId || entry?.['.id']);
    if (secretId) return `${routerId}::id:${secretId}`;
    const usernameKey = normalizePppoeUsernameKey(entry?.username || entry?.name || entry?.user);
    return usernameKey ? `${routerId}::user:${usernameKey}` : '';
  };

  const getRoutersFromSettings = (settings) =>
    Array.isArray(settings?.mikrotikRouters) ? settings.mikrotikRouters : [];

  const resolveDefaultRouterId = (settings, routers = []) => {
    const preferred = normalizeRouterId(settings?.mikrotikDefaultId);
    if (preferred && routers.some((router) => router.id === preferred)) return preferred;
    const explicitDefault = routers.find((router) => router.isDefault);
    if (explicitDefault?.id) return explicitDefault.id;
    return routers[0]?.id || '';
  };

  const hasRouterCredentials = (router) => {
    const address = normalizeSettingValue(router?.address);
    const username = normalizeSettingValue(router?.username);
    const password = normalizeSettingValue(router?.password);
    return Boolean(address && username && password);
  };

  const hasValidMikrotikCredentials = (settings) => {
    if (!settings?.mikrotik?.enabled) return false;
    const routers = getRoutersFromSettings(settings);
    if (routers.length) {
      return routers.some((router) => hasRouterCredentials(router));
    }
    const address = normalizeSettingValue(settings?.mikrotik?.address);
    const username = normalizeSettingValue(settings?.mikrotik?.username);
    const password = normalizeSettingValue(settings?.mikrotik?.password);
    return Boolean(address && username && password);
  };

  const syncRouterSelect = (settings = {}) => {
    let routers = getRoutersFromSettings(settings);
    if (!routers.length && settings?.mikrotik) {
      routers = [{
        id: settings.mikrotikDefaultId || settings.mikrotik.id || 'default',
        label: settings.mikrotik.label || 'Default router',
        address: settings.mikrotik.address || '',
        username: settings.mikrotik.username || '',
        password: settings.mikrotik.password || '',
        port: settings.mikrotik.port || ''
      }];
    }
    routerState.routers = routers;
    routerState.defaultId = resolveDefaultRouterId(settings, routers);
    const savedRouterId = readSavedActiveRouterId();
    const preferredRouterId =
      (activeRouterId && routers.some((router) => router.id === activeRouterId) && activeRouterId)
      || (savedRouterId && routers.some((router) => router.id === savedRouterId) && savedRouterId)
      || routerState.defaultId
      || routers[0]?.id
      || '';
    activeRouterId = preferredRouterId;
    if (!routerSelect) return;
    routerSelect.innerHTML = '';
    if (!routers.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No routers configured';
      routerSelect.appendChild(opt);
      routerSelect.disabled = true;
      return;
    }
    routers.forEach((router) => {
      const opt = document.createElement('option');
      opt.value = router.id;
      opt.textContent = router.label || router.address || 'MikroTik Router';
      routerSelect.appendChild(opt);
    });
    routerSelect.disabled = routers.length <= 1;
    routerSelect.value = activeRouterId || routerState.defaultId || routers[0].id;
    activeRouterId = routerSelect.value;
    persistActiveRouterId(activeRouterId);
  };

  const resolveActiveRouterId = () => activeRouterId || routerState.defaultId || '';
  const resolveRowRouterId = (row) => {
    const explicit = normalizeRouterId(row?.routerId);
    return explicit || resolveActiveRouterId() || routerState.defaultId || '';
  };
  const resolveRouterInfo = (routerId) => {
    const normalizedId = normalizeRouterId(routerId);
    const router = routerState.routers.find((item) => item.id === normalizedId);
    if (router) {
      return {
        label: router.label || router.address || 'MikroTik Router',
        address: router.address || ''
      };
    }
    if (normalizedId) {
      return { label: normalizedId, address: '' };
    }
    return { label: 'Unknown router', address: '' };
  };

  const normalizeProfileNames = (profiles = []) => Array.from(
    new Set(
      (Array.isArray(profiles) ? profiles : [])
        .map((profile) => String(profile || '').trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));

  const getRouterProfiles = (routerId = '') => {
    const normalizedId = normalizeRouterId(routerId) || resolveActiveRouterId() || routerState.defaultId || '';
    return normalizedId ? (routerProfilesByRouterId.get(normalizedId) || []) : [];
  };

  const setRouterProfiles = (routerId = '', profiles = []) => {
    const normalizedId = normalizeRouterId(routerId) || resolveActiveRouterId() || routerState.defaultId || '';
    if (!normalizedId) return [];
    const normalizedProfiles = normalizeProfileNames(profiles);
    routerProfilesByRouterId.set(normalizedId, normalizedProfiles);
    routerProfilesLoaded.add(normalizedId);
    return normalizedProfiles;
  };

  const hasLoadedRouterProfiles = (routerId = '') => {
    const normalizedId = normalizeRouterId(routerId) || resolveActiveRouterId() || routerState.defaultId || '';
    return Boolean(normalizedId) && routerProfilesLoaded.has(normalizedId);
  };

  const getProfilesFromStoredAccounts = (routerId = '') => {
    const normalizedId = normalizeRouterId(routerId) || resolveActiveRouterId() || routerState.defaultId || '';
    if (!normalizedId) return [];
    return normalizeProfileNames(
      state.accounts
        .filter((entry) => {
          const entryRouterId = normalizeRouterId(entry?.routerId) || routerState.defaultId || '';
          return entryRouterId === normalizedId;
        })
        .map((entry) => entry?.profile)
    );
  };

  const getKnownProfilesForRouter = (routerId = '') => {
    const routerProfiles = getRouterProfiles(routerId);
    if (routerProfiles.length) return routerProfiles;
    const accountProfiles = getProfilesFromStoredAccounts(routerId);
    if (accountProfiles.length) return accountProfiles;
    return planProfiles;
  };

  const hasRouterProfile = (routerId = '', profile = '', providedProfiles = null) => {
    const targetProfile = String(profile || '').trim();
    if (!targetProfile) return true;
    const profileList = Array.isArray(providedProfiles)
      ? normalizeProfileNames(providedProfiles)
      : getRouterProfiles(routerId);
    if (!profileList.length) return true;
    const targetKey = normalizePlanName(targetProfile);
    return profileList.some((item) => normalizePlanName(item) === targetKey);
  };

  const buildRouterProfileMissingMessage = (routerId = '', profile = '', providedProfiles = null) => {
    const targetProfile = String(profile || '').trim();
    const router = resolveRouterInfo(routerId);
    const routerLabel = String(router?.label || router?.address || 'selected router').trim() || 'selected router';
    const knownProfiles = Array.isArray(providedProfiles)
      ? normalizeProfileNames(providedProfiles)
      : getKnownProfilesForRouter(routerId);
    if (!targetProfile) {
      return `The selected PPPoE profile does not exist on ${routerLabel}.`;
    }
    if (!knownProfiles.length) {
      return `Profile "${targetProfile}" does not exist on ${routerLabel}. Sync or create that profile on the router first.`;
    }
    const preview = knownProfiles.slice(0, 8).join(', ');
    const suffix = knownProfiles.length > 8 ? ', ...' : '';
    return `Profile "${targetProfile}" does not exist on ${routerLabel}. Available profiles: ${preview}${suffix}.`;
  };

  const loadRouterProfiles = async (requestedRouterId = resolveActiveRouterId(), { silent = true, force = false } = {}) => {
    const routerId = normalizeRouterId(requestedRouterId) || resolveActiveRouterId() || routerState.defaultId || '';
    if (!routerId) return [];
    if (!force && hasLoadedRouterProfiles(routerId)) {
      return getRouterProfiles(routerId);
    }
    try {
      const query = `?routerId=${encodeURIComponent(routerId)}`;
      const res = await fetch(`/api/mikrotik/pppoe/profiles${query}`, {
        credentials: 'include',
        cache: 'no-store'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Unable to load MikroTik PPPoE profiles');
      return setRouterProfiles(routerId, data?.profiles);
    } catch (err) {
      if (!silent && !isPageTransitioning()) {
        showToast(err.message || 'Unable to load MikroTik PPPoE profiles', 'error');
      }
      return getRouterProfiles(routerId);
    }
  };

  const ensureRouterProfilesLoaded = async (routerId = '') => {
    const normalizedId = normalizeRouterId(routerId) || resolveActiveRouterId() || routerState.defaultId || '';
    if (!normalizedId) return [];
    if (hasLoadedRouterProfiles(normalizedId)) {
      return getRouterProfiles(normalizedId);
    }
    return loadRouterProfiles(normalizedId, { silent: true });
  };

  const populateEditProfileOptions = (entry = null) => {
    if (!editProfile) return;
    const routerId = resolveRowRouterId(entry);
    const currentValue = String(entry?.profile || '').trim();
    const knownProfiles = getKnownProfilesForRouter(routerId).slice();
    if (
      currentValue &&
      !knownProfiles.some((profile) => normalizePlanName(profile) === normalizePlanName(currentValue))
    ) {
      knownProfiles.unshift(currentValue);
    }
    editProfile.innerHTML = '<option value="">Select profile</option>' + knownProfiles.map((profile) => `<option value="${profile}">${profile}</option>`).join('');
    editProfile.value = currentValue;
  };

  const mergeAccountsForRouter = (allAccounts, routerId, routerAccounts) => {
    const normalizedId = normalizeRouterId(routerId) || routerState.defaultId || '';
    const sourceAccounts = Array.isArray(allAccounts) ? allAccounts : [];
    const scopedExisting = sourceAccounts.filter((acc) => {
      const accRouterId = normalizeRouterId(acc?.routerId) || routerState.defaultId || '';
      return accRouterId === normalizedId;
    });
    const existingByKey = new Map(
      scopedExisting
        .map((acc) => [getAccountIdentityKey(acc, normalizedId), acc])
        .filter(([key]) => Boolean(key))
    );

    const preserved = sourceAccounts.filter((acc) => {
      const accRouterId = normalizeRouterId(acc?.routerId) || routerState.defaultId || '';
      return accRouterId !== normalizedId;
    });

    const merged = (Array.isArray(routerAccounts) ? routerAccounts : []).map((acc) => {
      const nextAccount = {
        ...acc,
        routerId: normalizeRouterId(acc?.routerId) || normalizedId
      };
      const accountKey = getAccountIdentityKey(nextAccount, normalizedId);
      if (!accountKey) return nextAccount;
      const previous = existingByKey.get(accountKey);
      const mergedAccount = mergePppoeUsageState(previous, nextAccount).account;
      return previous ? mergeDuplicatePppoeAccount(previous, mergedAccount) : mergedAccount;
    });

    return [...preserved, ...merged];
  };

  const getStatusPriority = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'online' || normalized === 'active') return 3;
    if (normalized === 'offline') return 2;
    if (normalized === 'disabled' || normalized === 'inactive') return 1;
    return 0;
  };

  const pickNonEmptyValue = (...values) => {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text) return value;
    }
    return '';
  };

  const resolveCallerIdValue = (row) => String(
    pickNonEmptyValue(row?.callerId, row?.['caller-id'])
  ).trim();

  const resolvePppoeAddressValue = (row) => String(
    pickNonEmptyValue(row?.activeAddress, row?.address, row?.['remote-address'])
  ).trim();

  const formatMacAddress = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const hex = raw.replace(/[^a-fA-F0-9]/g, '');
    if (hex.length !== 12) return raw;
    return (hex.match(/.{1,2}/g) || []).join(':').toUpperCase();
  };

  const pickLatestDateValue = (...values) => {
    let best = '';
    let bestTime = Number.NEGATIVE_INFINITY;
    values.forEach((value) => {
      const text = String(value || '').trim();
      if (!text) return;
      const parsed = Date.parse(text);
      if (!Number.isNaN(parsed) && parsed >= bestTime) {
        bestTime = parsed;
        best = value;
        return;
      }
      if (!best) best = value;
    });
    return best;
  };

  const mergeDuplicatePppoeAccount = (existing, incoming) => {
    const preferredStatus =
      normalizePppoeUsageStatus(incoming?.status)
      || normalizePppoeUsageStatus(existing?.status)
      || '';
    const existingUsage = readPppoeUsageState(existing);
    const incomingUsage = readPppoeUsageState(incoming);
    const existingRxPackets = parseMetric(existing?.sessionRxPackets) ?? 0;
    const existingTxPackets = parseMetric(existing?.sessionTxPackets) ?? 0;
    const existingTotalPackets = parseMetric(existing?.sessionTotalPackets) ?? (existingRxPackets + existingTxPackets);
    const incomingRxPackets = parseMetric(incoming?.sessionRxPackets) ?? 0;
    const incomingTxPackets = parseMetric(incoming?.sessionTxPackets) ?? 0;
    const incomingTotalPackets = parseMetric(incoming?.sessionTotalPackets) ?? (incomingRxPackets + incomingTxPackets);
    return {
      ...existing,
      ...incoming,
      username: pickNonEmptyValue(incoming?.username, existing?.username),
      routerId: normalizeRouterId(incoming?.routerId || existing?.routerId) || routerState.defaultId || '',
      secretId: normalizeSecretId(incoming?.secretId || existing?.secretId || incoming?.['.id'] || existing?.['.id']),
      customerAccount: pickNonEmptyValue(
        incoming?.customerAccount,
        existing?.customerAccount,
        incoming?.accountNumber,
        existing?.accountNumber,
        incoming?.customerId,
        existing?.customerId
      ),
      password: pickNonEmptyValue(incoming?.password, existing?.password),
      profile: pickNonEmptyValue(incoming?.profile, existing?.profile),
      pairedCustomer: pickNonEmptyValue(existing?.pairedCustomer, incoming?.pairedCustomer),
      pairedPppoe: pickNonEmptyValue(existing?.pairedPppoe, incoming?.pairedPppoe),
      status: preferredStatus,
      routerDisabled: mergeRouterDisabledFlag(existing, incoming),
      inactiveSince: pickLatestDateValue(existing?.inactiveSince, incoming?.inactiveSince),
      sessionUptime: pickNonEmptyValue(incoming?.sessionUptime, existing?.sessionUptime),
      currentSessionLoginAt: isPppoeOnlineStatus(preferredStatus)
        ? pickNonEmptyValue(incoming?.currentSessionLoginAt, existing?.currentSessionLoginAt)
        : '',
      pppoeSessionHistory: (
        Array.isArray(incoming?.pppoeSessionHistory) && incoming.pppoeSessionHistory.length
          ? incoming.pppoeSessionHistory
          : (Array.isArray(existing?.pppoeSessionHistory) ? existing.pppoeSessionHistory : [])
      ).slice(-20),
      activeAddress: pickNonEmptyValue(incoming?.activeAddress, existing?.activeAddress),
      callerId: pickNonEmptyValue(incoming?.callerId, existing?.callerId, incoming?.['caller-id'], existing?.['caller-id']),
      sessionRxBytes: Math.max(existingUsage.sessionRx, incomingUsage.sessionRx),
      sessionTxBytes: Math.max(existingUsage.sessionTx, incomingUsage.sessionTx),
      sessionTotalBytes: Math.max(existingUsage.sessionTotal, incomingUsage.sessionTotal),
      activeSessionCount: Math.max(
        Number(existing?.activeSessionCount || 0),
        Number(incoming?.activeSessionCount || 0),
        Number(existing?.sessionCount || 0),
        Number(incoming?.sessionCount || 0)
      ),
      usageCarryRxBytes: Math.max(existingUsage.carryRx, incomingUsage.carryRx),
      usageCarryTxBytes: Math.max(existingUsage.carryTx, incomingUsage.carryTx),
      usageCarryTotalBytes: Math.max(existingUsage.carryTotal, incomingUsage.carryTotal),
      sessionRxPackets: Math.max(existingRxPackets, incomingRxPackets),
      sessionTxPackets: Math.max(existingTxPackets, incomingTxPackets),
      sessionTotalPackets: Math.max(existingTotalPackets, incomingTotalPackets)
    };
  };

  const dedupePppoeAccounts = (accounts = []) => {
    const order = [];
    const byKey = new Map();
    (Array.isArray(accounts) ? accounts : []).forEach((account) => {
      if (!account || typeof account !== 'object') return;
      const username = String(account.username || account.name || account.user || '').trim();
      if (!username) return;
      const routerId = normalizeRouterId(account.routerId) || routerState.defaultId || '';
      const normalized = {
        ...account,
        username,
        routerId,
        secretId: normalizeSecretId(account.secretId || account['.id'])
      };
      const key = getAccountIdentityKey(normalized, routerId);
      if (!key) return;
      if (!byKey.has(key)) {
        order.push(key);
        byKey.set(key, normalized);
        return;
      }
      byKey.set(key, mergeDuplicatePppoeAccount(byKey.get(key), normalized));
    });
    return order.map((key) => byKey.get(key)).filter(Boolean);
  };

  const setStateAccounts = (accounts = []) => {
    state.accounts = dedupePppoeAccounts(accounts);
    recordTrafficSamples(state.accounts);
    refreshTrafficModalIfOpen();
    return state.accounts;
  };

  const syncGenerateButtonVisibility = () => {
    if (!generateOpenBtn) return;
    const visible = Boolean(mikrotikConnected && hasConfirmedOnlineStatus);
    if (visible) {
      generateOpenBtn.hidden = false;
      generateOpenBtn.disabled = false;
      generateOpenBtn.style.display = 'inline-flex';
      return;
    }
    generateOpenBtn.hidden = true;
    generateOpenBtn.disabled = true;
    generateOpenBtn.style.display = 'none';
    if (generateModal?.classList.contains('active')) {
      generateModal.classList.remove('active');
      generateModal.setAttribute('aria-hidden', 'true');
    }
  };
  const markStatusPending = () => {
    hasConfirmedOnlineStatus = false;
    syncGenerateButtonVisibility();
  };
  syncGenerateButtonVisibility();

  const showIntegrationDisabled = (message) => {
    if (statusCard) statusCard.style.display = 'none';
    if (pppoeWorkbench) pppoeWorkbench.style.display = 'none';
    mikrotikConnected = false;
    markStatusPending();
    if (pppoeDisabledNotice) {
      pppoeDisabledNotice.hidden = false;
      pppoeDisabledNotice.style.display = '';
      if (disabledNoticeText) {
        disabledNoticeText.textContent = message;
      }
    }
  };

  const hideIntegrationDisabled = () => {
    if (statusCard) statusCard.style.display = '';
    if (pppoeWorkbench) pppoeWorkbench.style.display = '';
    if (pppoeDisabledNotice) {
      pppoeDisabledNotice.hidden = true;
      pppoeDisabledNotice.style.display = 'none';
    }
  };

  const getAllRouterIds = () => {
    const routerIds = routerState.routers
      .map((router) => normalizeRouterId(router?.id))
      .filter(Boolean);
    if (routerIds.length) return Array.from(new Set(routerIds));
    const fallbackId = normalizeRouterId(routerState.defaultId);
    return fallbackId ? [fallbackId] : [];
  };

  const resolveRuntimeRouterId = (routerId = '') => normalizeRouterId(routerId) || routerState.defaultId || '';

  const getRouterRuntime = (routerId = '') => {
    const runtimeRouterId = resolveRuntimeRouterId(routerId);
    const existing = routerRuntimeState.get(runtimeRouterId);
    if (existing) return existing;
    const initial = {
      connected: false,
      connectedAt: null,
      wasConnected: false,
      info: null,
      address: '',
      reason: '',
      hasConfirmedOnlineStatus: false
    };
    routerRuntimeState.set(runtimeRouterId, initial);
    return initial;
  };

  const getCacheKeyForRouter = (routerId = '') => {
    const runtimeRouterId = resolveRuntimeRouterId(routerId) || 'default';
    return `${cacheKey}:${runtimeRouterId}`;
  };

  const readRuntimeCacheValue = (key) => {
    try {
      const localValue = window.localStorage?.getItem(key);
      if (localValue) return localValue;
    } catch (e) {
      // ignore localStorage read failures
    }
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  };

  const writeRuntimeCacheValue = (key, value) => {
    try {
      window.localStorage?.setItem(key, value);
    } catch (e) {
      // ignore localStorage write failures
    }
    try {
      sessionStorage.setItem(key, value);
    } catch (e) {
      // ignore sessionStorage write failures
    }
  };

  const readSavedActiveRouterId = () => normalizeRouterId(readRuntimeCacheValue(activeRouterStorageKey));

  const persistActiveRouterId = (routerId = '') => {
    const normalizedId = normalizeRouterId(routerId);
    if (!normalizedId) return;
    writeRuntimeCacheValue(activeRouterStorageKey, normalizedId);
  };

  const loadCache = (routerId = '') => {
    try {
      const runtimeRouterId = resolveRuntimeRouterId(routerId);
      const scopedRaw = readRuntimeCacheValue(getCacheKeyForRouter(runtimeRouterId));
      if (scopedRaw) return JSON.parse(scopedRaw);
      const canUseLegacyCache = !runtimeRouterId || runtimeRouterId === resolveActiveRouterId();
      const raw = canUseLegacyCache ? readRuntimeCacheValue(cacheKey) : '';
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  };

  const saveCache = (routerId, payload) => {
    const runtimeRouterId = resolveRuntimeRouterId(routerId);
    try {
      const serialized = JSON.stringify(payload);
      writeRuntimeCacheValue(getCacheKeyForRouter(runtimeRouterId), serialized);
      if (!runtimeRouterId || runtimeRouterId === resolveActiveRouterId()) {
        writeRuntimeCacheValue(cacheKey, serialized);
      }
    } catch (e) {
      // ignore
    }
  };

  const syncActiveRouterRuntime = () => {
    const runtime = getRouterRuntime(resolveActiveRouterId());
    mikrotikConnected = Boolean(runtime.connected);
    hasConfirmedOnlineStatus = Boolean(runtime.hasConfirmedOnlineStatus);
    connectedAt = runtime.connectedAt || null;
    wasConnected = Boolean(runtime.wasConnected);
    lastInfo = runtime.info || null;
    lastAddress = runtime.address || '';
  };

  const renderActiveRouterConnection = () => {
    if (!statusCard) return;
    syncActiveRouterRuntime();
    const isConnected = mikrotikConnected;
    syncGenerateButtonVisibility();
    statusCard.classList.toggle('is-online', isConnected);
    statusCard.classList.toggle('is-offline', !isConnected);
    if (statusDot) statusDot.classList.toggle('offline', !isConnected);

    if (isConnected) {
      if (statusTitle) statusTitle.textContent = 'Connected to MikroTik';
      if (statusSub) statusSub.textContent = '';
      renderConnectionTimer();
      if (connectionTimerId) clearInterval(connectionTimerId);
      connectionTimerId = setInterval(renderConnectionTimer, 1000);
      return;
    }

    if (statusTitle) statusTitle.textContent = 'Disconnected from MikroTik';
    if (statusSub) statusSub.textContent = getRouterRuntime(resolveActiveRouterId()).reason || 'MikroTik not connected';
    if (statusTimer) statusTimer.textContent = '\u2014';
    if (connectionTimerId) {
      clearInterval(connectionTimerId);
      connectionTimerId = null;
    }
  };

  const renderPppoeSyncStatus = ({ ok = false, message = '' } = {}) => {
    if (pppoeLastSyncTime) {
      pppoeLastSyncTime.textContent = new Date().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
      });
    }
    if (pppoeLastSyncState) {
      pppoeLastSyncState.classList.toggle('is-error', !ok);
      pppoeLastSyncState.innerHTML = ok
        ? '<i class="ti ti-circle-filled" aria-hidden="true"></i> Success'
        : `<i class="ti ti-circle-filled" aria-hidden="true"></i> ${escapeHtml(message || 'Failed')}`;
    }
  };

  const renderActiveRouterSnapshot = () => {
    const runtime = getRouterRuntime(resolveActiveRouterId());
    renderInfo(runtime.info, runtime.address);
    renderActiveRouterConnection();
  };

  const hydrateRouterRuntimeFromCache = (routerId = '') => {
    const cached = loadCache(routerId);
    if (!cached) return;
    const runtime = getRouterRuntime(routerId);
    runtime.info = cached.info || runtime.info;
    runtime.address = cached.address || runtime.address;
    runtime.reason = cached.connected ? '' : runtime.reason;
    runtime.connected = Boolean(cached.connected);
    runtime.connectedAt = cached.connectedAt || null;
    runtime.wasConnected = Boolean(cached.connected);
    runtime.hasConfirmedOnlineStatus = Boolean(cached.connected);
  };

  const loadPlanProfiles = async () => {
    try {
      const res = await fetch('/api/plans', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Failed to fetch plans');
      const collected = new Set();
      const nextLookup = new Map();
      ['prepaid', 'postpaid'].forEach((cat) => {
        const list = Array.isArray(data?.plans?.[cat]) ? data.plans[cat] : [];
        list.forEach((plan) => {
          const normalizedPlan = {
            ...plan,
            profileBindings: normalizePlanProfileBindings(plan?.profileBindings || plan?.profile_bindings)
          };
          [plan?.name, plan?.label, plan?.id].forEach((candidate) => {
            const key = normalizePlanName(candidate);
            if (key && !nextLookup.has(key)) {
              nextLookup.set(key, normalizedPlan);
            }
          });
          const profile = String(normalizedPlan?.profile || '').trim();
          if (profile) collected.add(profile);
          Object.values(normalizedPlan.profileBindings || {}).forEach((bindingProfile) => {
            const normalizedProfile = String(bindingProfile || '').trim();
            if (normalizedProfile) collected.add(normalizedProfile);
          });
        });
      });
      planLookupByName = nextLookup;
      planProfiles = Array.from(collected).sort((a, b) => a.localeCompare(b));
    } catch (err) {
      console.warn('Unable to load plan profiles:', err?.message || err);
      planLookupByName = new Map();
      planProfiles = [];
    }
  };

  const collectFormValues = (form) => {
    if (!form) return {};
    const result = {};
    Array.from(form.elements).forEach((el) => {
      if (!el.name) return;
      if (el.type === 'checkbox') {
        result[el.name] = el.checked;
      } else if (el.type === 'radio') {
        if (el.checked) result[el.name] = el.value;
      } else {
        result[el.name] = el.value;
      }
    });
    return result;
  };

  const validate = (data) => {
    if (!data.username) return { valid: false, message: 'Username is required' };
    if (!data.password) return { valid: false, message: 'Password is required' };
    const usernameKey = normalizePppoeUsernameKey(data.username);
    const routerId = resolveActiveRouterId();
    const duplicate = dedupePppoeAccounts(state.accounts).some((entry) => {
      if (normalizeRouterId(entry?.routerId) !== routerId) return false;
      return normalizePppoeUsernameKey(entry?.username) === usernameKey;
    });
    if (duplicate) return { valid: false, message: 'PPPoE secret already exists on this router' };
    return { valid: true };
  };

  const formatDuration = (ms) => {
    if (!Number.isFinite(ms) || ms <= 0) return '0s';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    if (minutes) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    return `${seconds}s`;
  };

  const formatSessionDuration = (ms) => {
    if (!Number.isFinite(ms) || ms <= 0) return '-';
    const totalMinutes = Math.floor(ms / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours || days) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(' ');
  };

  const getSessionTimestampKey = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = parseOfflineDate(raw);
    return parsed ? parsed.toISOString() : raw.toLowerCase();
  };

  const getSessionTimestampMs = (value) => {
    const parsed = parseOfflineDate(value);
    return parsed ? parsed.getTime() : null;
  };

  const hasSessionHistoryEntry = (history = [], { loginAt = '', logoutAt = '', source = '' } = {}) => {
    const targetLogoutMs = getSessionTimestampMs(logoutAt);
    const targetLoginMs = getSessionTimestampMs(loginAt);
    const targetLogoutKey = targetLogoutMs == null ? getSessionTimestampKey(logoutAt) : '';
    const targetSource = String(source || '').trim().toLowerCase();
    if (!targetLogoutKey && targetLogoutMs == null && targetLoginMs == null) return false;
    return (Array.isArray(history) ? history : []).some((entry) => {
      const entryLogoutMs = getSessionTimestampMs(entry?.logoutAt);
      if (
        targetLogoutMs != null &&
        entryLogoutMs != null &&
        Math.abs(entryLogoutMs - targetLogoutMs) <= PPPoE_SESSION_DUPLICATE_WINDOW_MS
      ) {
        return true;
      }
      if (targetLogoutKey && getSessionTimestampKey(entry?.logoutAt) === targetLogoutKey) return true;

      const entryLoginMs = getSessionTimestampMs(entry?.loginAt);
      const entrySource = String(entry?.source || '').trim().toLowerCase();
      return (
        targetLoginMs != null &&
        entryLoginMs != null &&
        Math.abs(entryLoginMs - targetLoginMs) <= PPPoE_SESSION_DUPLICATE_WINDOW_MS &&
        (!targetSource || !entrySource || targetSource === entrySource)
      );
    });
  };

  const buildCompletedSessionHistoryEntry = ({
    loginAt = '',
    logoutAt = '',
    source = ''
  } = {}) => {
    const logoutDate = parseOfflineDate(logoutAt) || new Date();
    const loginDate = parseOfflineDate(loginAt);
    const durationMs = loginDate ? Math.max(logoutDate.getTime() - loginDate.getTime(), 0) : null;
    return {
      loginAt: String(loginAt || '').trim(),
      logoutAt: String(logoutAt || logoutDate.toISOString()).trim(),
      durationMs,
      durationLabel: Number.isFinite(durationMs) ? formatSessionDuration(durationMs) : '-',
      status: 'Completed',
      source
    };
  };

  const parseMikrotikDurationMs = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    let total = 0;
    const weekMatch = raw.match(/(\d+(?:\.\d+)?)w/);
    const dayMatch = raw.match(/(\d+(?:\.\d+)?)d/);
    const hourMatch = raw.match(/(\d+(?:\.\d+)?)h/);
    const minuteMatch = raw.match(/(\d+(?:\.\d+)?)m/);
    const secondMatch = raw.match(/(\d+(?:\.\d+)?)s/);
    if (weekMatch) total += Number(weekMatch[1]) * 7 * 24 * 60 * 60 * 1000;
    if (dayMatch) total += Number(dayMatch[1]) * 24 * 60 * 60 * 1000;
    if (hourMatch) total += Number(hourMatch[1]) * 60 * 60 * 1000;
    if (minuteMatch) total += Number(minuteMatch[1]) * 60 * 1000;
    if (secondMatch) total += Number(secondMatch[1]) * 1000;
    if (total > 0) return total;
    const colonParts = raw.split(':').map((part) => Number(part));
    if (colonParts.length >= 2 && colonParts.every(Number.isFinite)) {
      const [hours = 0, minutes = 0, seconds = 0] = colonParts.length === 2
        ? [0, colonParts[0], colonParts[1]]
        : colonParts;
      return ((hours * 3600) + (minutes * 60) + seconds) * 1000;
    }
    return null;
  };

  const formatSessionDateTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '-';
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

  const parseMetric = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const compact = raw.replace(/[\s,]+/g, '');
    if (!compact) return null;
    if (/^\d+(\.\d+)?$/.test(compact)) {
      const num = Number(compact);
      return Number.isFinite(num) ? num : null;
    }
    const match = compact.match(/^(\d+(?:\.\d+)?)([kmgt]i?b)?$/i);
    if (!match) return null;
    const num = Number(match[1]);
    if (!Number.isFinite(num)) return null;
    const unit = (match[2] || '').toLowerCase();
    const factors = {
      kb: 1e3,
      mb: 1e6,
      gb: 1e9,
      tb: 1e12,
      kib: 1024,
      mib: 1024 * 1024,
      gib: 1024 * 1024 * 1024,
      tib: 1024 * 1024 * 1024 * 1024
    };
    const factor = factors[unit] || 1;
    return num * factor;
  };

  function normalizePppoeUsageStatus(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'active') return 'online';
    if (normalized === 'inactive') return 'disabled';
    return normalized;
  }

  function isPppoeOnlineStatus(value = '') {
    return normalizePppoeUsageStatus(value) === 'online';
  }

  function isPppoeOfflineStatus(value = '') {
    const normalized = normalizePppoeUsageStatus(value);
    return normalized === 'offline' || normalized === 'disabled';
  }

  function hasOwnValue(source, key) {
    return Object.prototype.hasOwnProperty.call(source || {}, key);
  }

  function readRouterDisabledFlag(row = {}) {
    return (
      row?.routerDisabled === true
      || row?.disabled === true
      || String(row?.disabled || '').trim().toLowerCase() === 'true'
      || normalizePppoeUsageStatus(row?.status) === 'disabled'
    );
  }

  function mergeRouterDisabledFlag(existing = {}, incoming = {}) {
    const incomingIsAuthoritative =
      hasOwnValue(incoming, 'routerDisabled')
      || hasOwnValue(incoming, 'disabled')
      || Boolean(String(incoming?.status || '').trim());
    return incomingIsAuthoritative
      ? readRouterDisabledFlag(incoming)
      : readRouterDisabledFlag(existing);
  }

  const formatTrafficRate = (bytesPerSecond) => {
    const safeBytes = Number(bytesPerSecond);
    if (!Number.isFinite(safeBytes) || safeBytes <= 0) return '0 bps';
    const bitsPerSecond = safeBytes * 8;
    const units = [
      { label: 'Gbps', value: 1000 * 1000 * 1000 },
      { label: 'Mbps', value: 1000 * 1000 },
      { label: 'Kbps', value: 1000 }
    ];
    for (const unit of units) {
      if (bitsPerSecond >= unit.value) {
        const scaled = bitsPerSecond / unit.value;
        const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
        return `${scaled.toFixed(digits)} ${unit.label}`;
      }
    }
    return `${bitsPerSecond.toFixed(0)} bps`;
  };

  const formatTrafficVolume = (bytes) => {
    const safeBytes = Number(bytes);
    if (!Number.isFinite(safeBytes) || safeBytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let scaled = safeBytes;
    let unitIndex = 0;
    while (scaled >= 1024 && unitIndex < units.length - 1) {
      scaled /= 1024;
      unitIndex += 1;
    }
    const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return `${scaled.toFixed(digits)} ${units[unitIndex]}`;
  };

  const formatPacketRate = (packetsPerSecond) => {
    const safePackets = Number(packetsPerSecond);
    if (!Number.isFinite(safePackets) || safePackets <= 0) return '0 p/s';
    const digits = safePackets >= 100 ? 0 : safePackets >= 10 ? 1 : 2;
    return `${safePackets.toFixed(digits)} p/s`;
  };

  const formatTrafficAxisLabel = (bytesPerSecond) => {
    const formatted = formatTrafficRate(bytesPerSecond);
    return formatted.replace(/\.0 (?=Kbps|Mbps|Gbps)/, ' ');
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const formatTrafficSampleTime = (timestamp) => {
    const safeTimestamp = Number(timestamp);
    if (!Number.isFinite(safeTimestamp) || safeTimestamp <= 0) return 'Live sample';
    return new Date(safeTimestamp).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getTrafficCanvasByPanel = (panelName) => (
    panelName === 'packet' ? trafficPacketCanvas : trafficRateCanvas
  );

  const getTrafficTooltipByPanel = (panelName) => (
    panelName === 'packet' ? trafficPacketTooltip : trafficRateTooltip
  );

  const ensureTrafficEqualizer = (element) => {
    if (!element || element.childElementCount) return;
    ['tx', 'rx'].forEach((channel) => {
      const column = document.createElement('div');
      column.className = 'pppoe-traffic-panel__equalizer-column';
      column.dataset.channel = channel;
      for (let index = 0; index < TRAFFIC_EQUALIZER_SEGMENTS; index += 1) {
        const segment = document.createElement('span');
        segment.className = 'pppoe-traffic-panel__equalizer-segment';
        segment.dataset.channel = channel;
        column.appendChild(segment);
      }
      element.appendChild(column);
    });
  };

  const renderTrafficEqualizer = (element, txValue, rxValue, maxValue) => {
    if (!element) return;
    ensureTrafficEqualizer(element);
    const safeMax = Number.isFinite(Number(maxValue)) && Number(maxValue) > 0 ? Number(maxValue) : 1;
    ['tx', 'rx'].forEach((channel) => {
      const value = channel === 'tx' ? Number(txValue) || 0 : Number(rxValue) || 0;
      const ratio = clamp(value / safeMax, 0, 1);
      const activeCount = Math.max(0, Math.min(
        TRAFFIC_EQUALIZER_SEGMENTS,
        value > 0 ? Math.ceil(ratio * TRAFFIC_EQUALIZER_SEGMENTS) : 0
      ));
      const segments = Array.from(element.querySelectorAll(`.pppoe-traffic-panel__equalizer-segment[data-channel="${channel}"]`));
      segments.forEach((segment, index) => {
        segment.classList.toggle('is-active', index < activeCount);
      });
    });
  };

  const renderTrafficMetaSummary = ({
    totalUpload = 0,
    totalDownload = 0,
    totalUploadPackets = 0,
    totalDownloadPackets = 0
  } = {}) => {
    if (!trafficMeta) return;
    trafficMeta.innerHTML = [
      '<div class="pppoe-traffic-modal__meta-column">',
      `<span>Session Tx: ${formatTrafficVolume(totalUpload)}</span>`,
      `<span>Session Rx: ${formatTrafficVolume(totalDownload)}</span>`,
      '</div>',
      '<div class="pppoe-traffic-modal__meta-column">',
      `<span>Tx Packets: ${Math.round(totalUploadPackets)}</span>`,
      `<span>Rx Packets: ${Math.round(totalDownloadPackets)}</span>`,
      '</div>'
    ].join('');
  };

  const buildCurrentSessionRow = (row = {}) => {
    if (!isPppoeOnlineStatus(row?.status)) return null;
    const uptimeMs = parseMikrotikDurationMs(row?.sessionUptime || row?.uptime);
    const loginAt = row?.currentSessionLoginAt || (Number.isFinite(uptimeMs) ? new Date(Date.now() - uptimeMs).toISOString() : '');
    return {
      loginAt,
      logoutAt: '',
      durationMs: uptimeMs,
      durationLabel: 'Running',
      status: 'Active',
      active: true
    };
  };

  const pickLatestSessionDateValue = (...values) => {
    let best = '';
    let bestTime = Number.NEGATIVE_INFINITY;
    values.forEach((value) => {
      const text = String(value || '').trim();
      if (!text) return;
      const parsed = parseOfflineDate(text);
      const timestamp = parsed ? parsed.getTime() : NaN;
      if (Number.isFinite(timestamp) && timestamp >= bestTime) {
        bestTime = timestamp;
        best = value;
        return;
      }
      if (!best) best = value;
    });
    return best;
  };

  const getLatestSessionLogoutAt = (row = {}) => {
    const history = Array.isArray(row?.pppoeSessionHistory) ? row.pppoeSessionHistory : [];
    return pickLatestSessionDateValue(...history.map((entry) => entry?.logoutAt).filter(Boolean));
  };

  const getResolvedLastSeenValue = (row = {}) => pickLatestSessionDateValue(
    row?.lastSeen,
    row?.lastseen,
    row?.inactiveSince,
    row?.['last-seen'],
    getLatestSessionLogoutAt(row)
  );

  const getPppoeSessionHistoryRows = (row = {}) => {
    const history = Array.isArray(row?.pppoeSessionHistory) ? row.pppoeSessionHistory : [];
    const completedRows = history
      .filter((entry) => entry && (entry.loginAt || entry.logoutAt))
      .map((entry) => ({
        loginAt: entry.loginAt || '',
        logoutAt: entry.logoutAt || '',
        durationMs: Number(entry.durationMs),
        durationLabel: entry.durationLabel || '',
        status: entry.status || 'Completed',
        source: entry.source || '',
        active: false
      }));
    const lastSeenLogoutAt = getResolvedLastSeenValue(row);
    if (!isPppoeOnlineStatus(row?.status) && lastSeenLogoutAt && !hasSessionHistoryEntry(completedRows, {
      loginAt: row?.currentSessionLoginAt || '',
      logoutAt: lastSeenLogoutAt,
      source: 'MikroTik last seen'
    })) {
      completedRows.push(buildCompletedSessionHistoryEntry({
        loginAt: row?.currentSessionLoginAt || '',
        logoutAt: lastSeenLogoutAt,
        source: 'MikroTik last seen'
      }));
    }
    const activeRow = buildCurrentSessionRow(row);
    return [...completedRows, ...(activeRow ? [activeRow] : [])];
  };

  const renderTrafficSessionHistory = (row = null) => {
    if (!trafficSessionHistoryBody) return;
    const rows = row ? getPppoeSessionHistoryRows(row) : [];
    if (!rows.length) {
      trafficSessionHistoryBody.innerHTML = '<tr><td colspan="5" class="pppoe-session-history__empty">No session history yet.</td></tr>';
      return;
    }
    trafficSessionHistoryBody.innerHTML = rows.map((entry, index) => {
      const duration = entry.active
        ? (entry.durationLabel || 'Running')
        : (entry.durationLabel || formatSessionDuration(Number(entry.durationMs)));
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(formatSessionDateTime(entry.loginAt))}</td>
          <td>${entry.active ? 'Still Online' : escapeHtml(formatSessionDateTime(entry.logoutAt))}</td>
          <td>${escapeHtml(duration || '-')}</td>
          <td><span class="badge rounded-pill pppoe-session-status ${entry.active ? 'is-active' : 'is-completed'}">${escapeHtml(entry.status || (entry.active ? 'Active' : 'Completed'))}</span></td>
        </tr>
      `;
    }).join('');
  };

  const clearTrafficTooltipTimer = (panelName) => {
    const timerId = trafficState.tooltipTimerByPanel?.[panelName];
    if (!timerId) return;
    clearTimeout(timerId);
    trafficState.tooltipTimerByPanel[panelName] = null;
  };

  const scheduleTrafficTooltipHide = (panelName) => {
    clearTrafficTooltipTimer(panelName);
    trafficState.tooltipTimerByPanel[panelName] = window.setTimeout(() => {
      hideTrafficTooltip(panelName);
    }, TRAFFIC_TOOLTIP_HIDE_MS);
  };

  const hideTrafficTooltip = (panelName) => {
    clearTrafficTooltipTimer(panelName);
    const tooltip = getTrafficTooltipByPanel(panelName);
    if (tooltip) {
      tooltip.hidden = true;
      tooltip.innerHTML = '';
      tooltip.style.left = '';
      tooltip.style.top = '';
    }
    if (trafficState.selectedPointByPanel) {
      trafficState.selectedPointByPanel[panelName] = null;
    }
  };

  const hideAllTrafficTooltips = () => {
    hideTrafficTooltip('rate');
    hideTrafficTooltip('packet');
  };

  const renderTrafficTooltip = (panelName) => {
    const tooltip = getTrafficTooltipByPanel(panelName);
    const canvas = getTrafficCanvasByPanel(panelName);
    const selection = trafficState.selectedPointByPanel?.[panelName];
    const plot = canvas ? trafficPlotByCanvas.get(canvas) : null;
    if (!tooltip || !canvas || !selection || !plot || !Array.isArray(plot.points) || !plot.points.length) {
      if (tooltip) tooltip.hidden = true;
      return;
    }

    let sampleIndex = plot.points.findIndex((point) => point?.timestamp === selection.timestamp);
    if (sampleIndex < 0 && Number.isInteger(selection.sampleIndex)) {
      sampleIndex = clamp(selection.sampleIndex, 0, Math.max(plot.points.length - 1, 0));
    }
    if (sampleIndex < 0) {
      tooltip.hidden = true;
      return;
    }

    const sample = plot.points[sampleIndex] || {};
    const txValue = Number(sample?.[plot.txKey]) || 0;
    const rxValue = Number(sample?.[plot.rxKey]) || 0;
    const x = plot.toX(sampleIndex);
    const y = Math.min(plot.toY(txValue), plot.toY(rxValue), plot.chartBottom - 18);
    const panel = tooltip.parentElement;
    if (!panel) {
      tooltip.hidden = true;
      return;
    }

    tooltip.innerHTML = [
      `<strong>${formatTrafficSampleTime(sample?.timestamp)}</strong>`,
      `<span>${plot.txLabel}: ${plot.labelFormatter(txValue)}</span>`,
      `<span>${plot.rxLabel}: ${plot.labelFormatter(rxValue)}</span>`
    ].join('');
    tooltip.hidden = false;

    const panelWidth = panel.clientWidth || 0;
    const panelHeight = panel.clientHeight || 0;
    const tooltipWidth = tooltip.offsetWidth || 140;
    const tooltipHeight = tooltip.offsetHeight || 60;
    const left = clamp(x + 8, 4, Math.max(4, panelWidth - tooltipWidth - 4));
    const preferredTop = y - tooltipHeight - 8;
    const fallbackTop = y + 8;
    const top = preferredTop >= 4
      ? preferredTop
      : clamp(fallbackTop, 4, Math.max(4, panelHeight - tooltipHeight - 4));
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  };

  const selectTrafficPoint = (panelName, event, { persist = true } = {}) => {
    const canvas = getTrafficCanvasByPanel(panelName);
    const plot = canvas ? trafficPlotByCanvas.get(canvas) : null;
    if (!canvas || !plot || !Array.isArray(plot.points) || !plot.points.length) {
      hideTrafficTooltip(panelName);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const positions = Array.isArray(plot.pointPositions) ? plot.pointPositions : [];
    const minX = positions.length ? positions[0] : plot.chartPadding.left;
    const maxX = positions.length ? positions[positions.length - 1] : plot.chartPadding.left + plot.chartWidth;
    if (pointerX < minX - 8 || pointerX > maxX + 8) {
      hideTrafficTooltip(panelName);
      return;
    }

    let sampleIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    positions.forEach((position, index) => {
      const distance = Math.abs(position - pointerX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        sampleIndex = index;
      }
    });
    const sampleSpacing = Number(plot.sampleSpacing) || plot.chartWidth;
    if (nearestDistance > Math.max(8, sampleSpacing * 0.75)) {
      hideTrafficTooltip(panelName);
      return;
    }

    const sample = plot.points[sampleIndex] || {};
    trafficState.selectedPointByPanel[panelName] = {
      sampleIndex,
      timestamp: sample?.timestamp || 0
    };
    renderTrafficModal();
    renderTrafficTooltip(panelName);
    if (persist) {
      scheduleTrafficTooltipHide(panelName);
    } else {
      clearTrafficTooltipTimer(panelName);
    }
  };

  const getTrafficSamplesForKey = (key) => {
    const safeKey = String(key || '').trim();
    if (!safeKey) return [];
    if (!trafficState.samplesByKey.has(safeKey)) {
      trafficState.samplesByKey.set(safeKey, []);
    }
    return trafficState.samplesByKey.get(safeKey);
  };

  const findAccountByIdentityKey = (key) => {
    const safeKey = String(key || '').trim();
    if (!safeKey) return null;
    return state.accounts.find((entry) => (
      getAccountIdentityKey(entry, resolveRowRouterId(entry)) === safeKey
    )) || null;
  };

  const findAccountIndexByIdentityKey = (key) => {
    const safeKey = String(key || '').trim();
    if (!safeKey) return -1;
    return state.accounts.findIndex((entry) => (
      getAccountIdentityKey(entry, resolveRowRouterId(entry)) === safeKey
    ));
  };

  const recordTrafficSample = (row, timestamp = Date.now()) => {
    if (!row || typeof row !== 'object') return;
    const accountKey = getAccountIdentityKey(row, resolveRowRouterId(row));
    if (!accountKey) return;

    const rxBytes = parseMetric(row?.sessionRxBytes) ?? 0;
    const txBytes = parseMetric(row?.sessionTxBytes) ?? 0;
    const rxPackets = parseMetric(row?.sessionRxPackets) ?? 0;
    const txPackets = parseMetric(row?.sessionTxPackets) ?? 0;
    const online = isPppoeOnlineStatus(row?.status);
    const samples = getTrafficSamplesForKey(accountKey);
    const lastSample = samples[samples.length - 1] || null;

    if (lastSample) {
      const elapsed = timestamp - lastSample.timestamp;
      const unchanged = (
        lastSample.rxBytes === rxBytes &&
        lastSample.txBytes === txBytes &&
        lastSample.rxPackets === rxPackets &&
        lastSample.txPackets === txPackets &&
        lastSample.online === online
      );
      if (unchanged && elapsed < trafficState.minSampleIntervalMs) {
        return;
      }
    }

    let downloadRate = 0;
    let uploadRate = 0;
    let downloadPacketRate = 0;
    let uploadPacketRate = 0;
    const directRxRate = parseMetric(row?.liveRxBytesPerSecond);
    const directTxRate = parseMetric(row?.liveTxBytesPerSecond);
    const directRxPacketRate = parseMetric(row?.liveRxPacketsPerSecond);
    const directTxPacketRate = parseMetric(row?.liveTxPacketsPerSecond);
    const hasDirectTrafficRate = online && (
      Number.isFinite(directRxRate) ||
      Number.isFinite(directTxRate) ||
      Number.isFinite(directRxPacketRate) ||
      Number.isFinite(directTxPacketRate)
    );
    if (hasDirectTrafficRate) {
      downloadRate = Number.isFinite(directRxRate) ? directRxRate : 0;
      uploadRate = Number.isFinite(directTxRate) ? directTxRate : 0;
      downloadPacketRate = Number.isFinite(directRxPacketRate) ? directRxPacketRate : 0;
      uploadPacketRate = Number.isFinite(directTxPacketRate) ? directTxPacketRate : 0;
    } else if (lastSample && online && lastSample.online) {
      const elapsed = Math.max(timestamp - lastSample.timestamp, 1);
      const rxDelta = rxBytes - lastSample.rxBytes;
      const txDelta = txBytes - lastSample.txBytes;
      const rxPacketDelta = rxPackets - lastSample.rxPackets;
      const txPacketDelta = txPackets - lastSample.txPackets;
      if (rxDelta >= 0) downloadRate = (rxDelta / elapsed) * 1000;
      if (txDelta >= 0) uploadRate = (txDelta / elapsed) * 1000;
      if (rxPacketDelta >= 0) downloadPacketRate = (rxPacketDelta / elapsed) * 1000;
      if (txPacketDelta >= 0) uploadPacketRate = (txPacketDelta / elapsed) * 1000;
    }

    samples.push({
      timestamp,
      rxBytes,
      txBytes,
      rxPackets,
      txPackets,
      online,
      downloadRate,
      uploadRate,
      downloadPacketRate,
      uploadPacketRate
    });

    if (samples.length > trafficState.historyLimit) {
      samples.splice(0, samples.length - trafficState.historyLimit);
    }
  };

  const recordTrafficSamples = (accounts = state.accounts, timestamp = Date.now()) => {
    (Array.isArray(accounts) ? accounts : []).forEach((row) => {
      recordTrafficSample(row, timestamp);
    });
  };

  const getTrafficScaleMax = (values = []) => {
    const rates = (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    const observedPeak = rates.length ? rates[rates.length - 1] : 1;
    const safeValue = Math.max(observedPeak * 1.15, 1);
    const exponent = 10 ** Math.floor(Math.log10(safeValue));
    const fraction = safeValue / exponent;
    if (fraction <= 1) return 1 * exponent;
    if (fraction <= 2) return 2 * exponent;
    if (fraction <= 5) return 5 * exponent;
    return 10 * exponent;
  };

  function drawTrafficPanel(canvas, samples = [], config = {}) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = Math.max(Math.floor(canvas.clientWidth || 640), 320);
    const height = Math.max(Math.floor(canvas.clientHeight || 138), 120);
    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = Math.floor(width * dpr);
    const canvasHeight = Math.floor(height * dpr);
    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const chartPadding = { top: 8, right: 22, bottom: 26, left: 82 };
    const chartWidth = width - chartPadding.left - chartPadding.right;
    const chartHeight = height - chartPadding.top - chartPadding.bottom;
    if (chartWidth <= 0 || chartHeight <= 0) return;

    const points = (Array.isArray(samples) ? samples : []).slice(-trafficState.maxSamples);
    const txKey = String(config.txKey || 'uploadRate');
    const rxKey = String(config.rxKey || 'downloadRate');
    const labelFormatter = typeof config.labelFormatter === 'function' ? config.labelFormatter : formatTrafficRate;
    const txStroke = config.txStroke || '#0095ff';
    const rxStroke = config.rxStroke || '#23c200';
    const allRates = points.flatMap((point) => [point?.[txKey] || 0, point?.[rxKey] || 0]);
    const scaledMax = getTrafficScaleMax(allRates);
    const chartBottom = chartPadding.top + chartHeight;
    const chartRight = chartPadding.left + chartWidth;
    const isDarkTheme = document.body.classList.contains('theme-dark');
    const gridColor = isDarkTheme ? 'rgba(71, 85, 105, 0.58)' : 'rgba(226, 232, 240, 0.95)';
    const axisLabelColor = isDarkTheme ? '#cbd5e1' : '#334155';
    const chartBackground = isDarkTheme ? '#0f172a' : '#ffffff';
    const guideColor = isDarkTheme ? 'rgba(226, 232, 240, 0.5)' : 'rgba(15, 23, 42, 0.42)';

    ctx.save();
    ctx.fillStyle = chartBackground;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    const horizontalSteps = 5;
    for (let lineIndex = 0; lineIndex <= horizontalSteps; lineIndex += 1) {
      const y = chartPadding.top + (chartHeight / horizontalSteps) * lineIndex;
      const value = scaledMax - ((scaledMax / horizontalSteps) * lineIndex);
      ctx.beginPath();
      ctx.moveTo(chartPadding.left + 0.5, Math.round(y) + 0.5);
      ctx.lineTo(chartRight + 0.5, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = axisLabelColor;
      ctx.font = '12px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = lineIndex === 0 ? 'top' : lineIndex === horizontalSteps ? 'bottom' : 'middle';
      ctx.fillText(labelFormatter(value), 0, y);
    }
    ctx.restore();

    const latestPoint = points[points.length - 1] || null;
    renderTrafficEqualizer(
      config.equalizerElement,
      latestPoint?.[txKey] || 0,
      latestPoint?.[rxKey] || 0,
      scaledMax
    );

    if (!points.length) {
      trafficPlotByCanvas.set(canvas, {
        points: [],
        txKey,
        rxKey,
        txLabel: String(config.txLabel || 'Tx'),
        rxLabel: String(config.rxLabel || 'Rx'),
        labelFormatter,
        chartPadding,
        chartWidth,
        chartHeight,
        chartBottom,
        stepCount: Math.max(trafficState.maxSamples - 1, 1),
        sampleSpacing: chartWidth / Math.max(trafficState.maxSamples - 1, 1),
        pointPositions: [],
        toX: () => chartPadding.left,
        toY: () => chartBottom
      });
      return;
    }

    const slotCount = Math.max(Math.min(trafficState.maxSamples, Math.max(points.length, 2)) - 1, 1);
    const sampleSpacing = chartWidth / slotCount;
    const startX = chartRight - sampleSpacing * Math.max(points.length - 1, 0);
    const toX = (index) => startX + sampleSpacing * index;
    const toY = (value) => chartBottom - ((value || 0) / scaledMax) * chartHeight;
    const pointPositions = points.map((_, index) => toX(index));
    const timeLabelIndexes = [];
    if (points.length > 1) {
      const desiredLabels = Math.min(Math.max(Math.floor(chartWidth / 110), 2), 6, points.length);
      const lastIndex = points.length - 1;
      for (let labelIndex = 0; labelIndex < desiredLabels; labelIndex += 1) {
        const pointIndex = Math.round((lastIndex / Math.max(desiredLabels - 1, 1)) * labelIndex);
        if (!timeLabelIndexes.includes(pointIndex)) timeLabelIndexes.push(pointIndex);
      }
    }
    trafficPlotByCanvas.set(canvas, {
      points,
      txKey,
      rxKey,
      txLabel: String(config.txLabel || 'Tx'),
      rxLabel: String(config.rxLabel || 'Rx'),
      labelFormatter,
      chartPadding,
      chartWidth,
      chartHeight,
      chartBottom,
      stepCount: slotCount,
      sampleSpacing,
      pointPositions,
      toX,
      toY
    });
    if (timeLabelIndexes.length) {
      ctx.save();
      ctx.fillStyle = axisLabelColor;
      ctx.font = '12px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      timeLabelIndexes.forEach((index) => {
        const point = points[index];
        const x = toX(index);
        const timestamp = Number(point?.timestamp || 0);
        const label = timestamp
          ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
        if (label) ctx.fillText(label, x, height - 2);
      });
      ctx.restore();
    }
    const drawSeries = (seriesKey, strokeStyle) => {
      ctx.save();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = 1.7;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = toX(index);
        const y = toY(point?.[seriesKey] || 0);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      ctx.restore();
    };

    drawSeries(rxKey, rxStroke);
    drawSeries(txKey, txStroke);

    const selectedPanelName = String(config.panelName || '');
    const selection = selectedPanelName ? trafficState.selectedPointByPanel?.[selectedPanelName] : null;
    if (selection) {
      let selectedIndex = points.findIndex((point) => point?.timestamp === selection.timestamp);
      if (selectedIndex < 0 && Number.isInteger(selection.sampleIndex)) {
        selectedIndex = clamp(selection.sampleIndex, 0, Math.max(points.length - 1, 0));
      }
      if (selectedIndex >= 0) {
        const selectedPoint = points[selectedIndex] || {};
        const guideX = toX(selectedIndex);
        const txY = toY(Number(selectedPoint?.[txKey]) || 0);
        const rxY = toY(Number(selectedPoint?.[rxKey]) || 0);
        ctx.save();
        ctx.strokeStyle = guideColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(guideX, chartPadding.top);
        ctx.lineTo(guideX, chartBottom);
        ctx.stroke();
        ctx.setLineDash([]);
        [
          { y: txY, color: txStroke },
          { y: rxY, color: rxStroke }
        ].forEach((marker) => {
          ctx.beginPath();
          ctx.fillStyle = chartBackground;
          ctx.strokeStyle = marker.color;
          ctx.lineWidth = 2;
          ctx.arc(guideX, marker.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
        ctx.restore();
      }
    }
  }

  function renderTrafficModal() {
    if (!trafficModal || !trafficTitle || !trafficSubtitle || !trafficRateCanvas || !trafficPacketCanvas) return;

    const selectedKey = String(trafficState.selectedKey || '').trim();
    const row = findAccountByIdentityKey(selectedKey);
    if (!selectedKey || !row) {
      trafficTitle.textContent = 'PPPoE Traffic';
      trafficSubtitle.textContent = 'Select a PPPoE row to monitor live traffic.';
      if (trafficStatus) {
        trafficStatus.textContent = 'Offline';
        trafficStatus.classList.add('is-offline');
      }
      trafficStatusDot?.classList.remove('is-online');
      renderTrafficMetaSummary();
      if (trafficDownloadRate) trafficDownloadRate.textContent = '0 bps';
      if (trafficUploadRate) trafficUploadRate.textContent = '0 bps';
      if (trafficDownloadPackets) trafficDownloadPackets.textContent = '0 p/s';
      if (trafficUploadPackets) trafficUploadPackets.textContent = '0 p/s';
      if (trafficUploadPeak) trafficUploadPeak.textContent = 'Peak: 0 bps';
      if (trafficDownloadPeak) trafficDownloadPeak.textContent = 'Peak: 0 bps';
      if (trafficTotalPackets) trafficTotalPackets.textContent = '0 p/s';
      if (trafficPacketPeak) trafficPacketPeak.textContent = 'Peak: 0 p/s';
      if (trafficLatency) trafficLatency.textContent = '--';
      if (trafficLastUpdated) trafficLastUpdated.textContent = 'Last Updated: --';
      if (trafficInterface) trafficInterface.textContent = '--';
      if (trafficIp) trafficIp.textContent = '--';
      if (trafficRateEmpty) {
        trafficRateEmpty.hidden = false;
        trafficRateEmpty.textContent = 'No live traffic data available.';
      }
      if (trafficPacketEmpty) {
        trafficPacketEmpty.hidden = false;
        trafficPacketEmpty.textContent = 'No live packet data available.';
      }
      hideAllTrafficTooltips();
      drawTrafficPanel(trafficRateCanvas, [], {
        panelName: 'rate',
        showScaleLabel: false,
        equalizerElement: null
      });
      drawTrafficPanel(trafficPacketCanvas, [], {
        panelName: 'packet',
        labelFormatter: formatPacketRate,
        txKey: 'uploadPacketRate',
        rxKey: 'downloadPacketRate',
        showScaleLabel: false,
        equalizerElement: null,
        txLabel: 'Tx Packet',
        rxLabel: 'Rx Packet'
      });
      return;
    }

    const routerInfo = resolveRouterInfo(resolveRowRouterId(row));
    const customerInfo = resolveCustomerInfo(row);
    const status = isPppoeOnlineStatus(row?.status) ? 'Online' : isPppoeOfflineStatus(row?.status) ? 'Offline' : 'Unknown';
    const samples = getTrafficSamplesForKey(selectedKey).slice(-trafficState.maxSamples);
    const latestSample = samples[samples.length - 1] || null;
    const currentDownload = latestSample?.online ? (latestSample?.downloadRate || 0) : 0;
    const currentUpload = latestSample?.online ? (latestSample?.uploadRate || 0) : 0;
    const currentDownloadPackets = latestSample?.online ? (latestSample?.downloadPacketRate || 0) : 0;
    const currentUploadPackets = latestSample?.online ? (latestSample?.uploadPacketRate || 0) : 0;
    const totalDownload = parseMetric(row?.sessionRxBytes) ?? 0;
    const totalUpload = parseMetric(row?.sessionTxBytes) ?? 0;
    const totalDownloadPackets = parseMetric(row?.sessionRxPackets) ?? 0;
    const totalUploadPackets = parseMetric(row?.sessionTxPackets) ?? 0;
    const bandwidthRates = samples.flatMap((point) => [
      Number(point?.uploadRate) || 0,
      Number(point?.downloadRate) || 0
    ]);
    const peakUpload = Math.max(0, ...samples.map((point) => Number(point?.uploadRate) || 0));
    const peakDownload = Math.max(0, ...samples.map((point) => Number(point?.downloadRate) || 0));
    const currentTotalPackets = currentDownloadPackets + currentUploadPackets;
    const peakTotalPackets = Math.max(0, ...samples.map((point) => (
      (Number(point?.downloadPacketRate) || 0) + (Number(point?.uploadPacketRate) || 0)
    )));
    const hasTrafficHistory = samples.length >= 2;
    const hasPacketHistory = samples.length >= 2 && (
      totalDownloadPackets > 0 ||
      totalUploadPackets > 0 ||
      samples.some((point) => (point?.downloadPacketRate || 0) > 0 || (point?.uploadPacketRate || 0) > 0)
    );

    trafficTitle.textContent = `Traffic: ${String(row?.username || '').trim() || 'PPPoE Entry'}`;
    trafficSubtitle.textContent = [
      `Router: ${routerInfo.label}`,
      customerInfo?.hasAssignment ? `Customer: ${customerInfo.name}` : 'Customer: Unassigned',
      `Status: ${status}`
    ].join(' | ');
    if (trafficStatus) {
      trafficStatus.textContent = status;
      trafficStatus.classList.toggle('is-offline', status !== 'Online');
    }
    trafficStatusDot?.classList.toggle('is-online', status === 'Online');
    renderTrafficMetaSummary({
      totalUpload,
      totalDownload,
      totalUploadPackets,
      totalDownloadPackets
    });

    if (trafficDownloadRate) trafficDownloadRate.textContent = formatTrafficRate(currentDownload);
    if (trafficUploadRate) trafficUploadRate.textContent = formatTrafficRate(currentUpload);
    if (trafficDownloadPackets) trafficDownloadPackets.textContent = formatPacketRate(currentDownloadPackets);
    if (trafficUploadPackets) trafficUploadPackets.textContent = formatPacketRate(currentUploadPackets);
    if (trafficUploadPeak) trafficUploadPeak.textContent = `Peak: ${formatTrafficRate(peakUpload)}`;
    if (trafficDownloadPeak) trafficDownloadPeak.textContent = `Peak: ${formatTrafficRate(peakDownload)}`;
    if (trafficTotalPackets) trafficTotalPackets.textContent = formatPacketRate(currentTotalPackets);
    if (trafficPacketPeak) trafficPacketPeak.textContent = `Peak: ${formatPacketRate(peakTotalPackets)}`;
    if (trafficLatency) trafficLatency.textContent = latestSample?.online ? 'Live' : '--';
    if (trafficLastUpdated) {
      trafficLastUpdated.textContent = latestSample?.timestamp
        ? `Last Updated: ${formatTrafficSampleTime(latestSample.timestamp)}`
        : 'Last Updated: --';
    }
    if (trafficInterface) trafficInterface.textContent = routerInfo.label || 'MikroTik';
    if (trafficIp) trafficIp.textContent = resolvePppoeAddressValue(row) || '--';

    if (trafficRateEmpty) {
      if (!mikrotikConnected) {
        trafficRateEmpty.hidden = false;
        trafficRateEmpty.textContent = 'MikroTik live status is unavailable.';
      } else if (!hasTrafficHistory) {
        trafficRateEmpty.hidden = false;
        trafficRateEmpty.textContent = isPppoeOnlineStatus(row?.status)
          ? 'Waiting for live traffic samples...'
          : 'This PPPoE entry is currently offline.';
      } else {
        trafficRateEmpty.hidden = true;
      }
    }
    if (trafficPacketEmpty) {
      if (!mikrotikConnected) {
        trafficPacketEmpty.hidden = false;
        trafficPacketEmpty.textContent = 'MikroTik live packet data is unavailable.';
      } else if (!hasPacketHistory) {
        trafficPacketEmpty.hidden = false;
        trafficPacketEmpty.textContent = isPppoeOnlineStatus(row?.status)
          ? 'Waiting for live packet samples...'
          : 'This PPPoE entry is currently offline.';
      } else {
        trafficPacketEmpty.hidden = true;
      }
    }

    drawTrafficPanel(trafficRateCanvas, samples, {
      panelName: 'rate',
      txKey: 'uploadRate',
      rxKey: 'downloadRate',
      labelFormatter: formatTrafficAxisLabel,
      showScaleLabel: true,
      equalizerElement: null,
      txLabel: 'Download (Tx)',
      rxLabel: 'Upload (Rx)',
      txStroke: '#0095ff',
      rxStroke: '#23c200'
    });
    drawTrafficPanel(trafficPacketCanvas, samples, {
      panelName: 'packet',
      txKey: 'uploadPacketRate',
      rxKey: 'downloadPacketRate',
      labelFormatter: formatPacketRate,
      showScaleLabel: false,
      equalizerElement: null,
      txLabel: 'Tx Packet',
      rxLabel: 'Rx Packet',
      txStroke: '#0095ff',
      rxStroke: '#23c200'
    });
    renderTrafficTooltip('rate');
    renderTrafficTooltip('packet');
  }

  function refreshTrafficModalIfOpen() {
    if (!trafficModal?.classList.contains('active')) return;
    renderTrafficModal();
  }

  function openTrafficModal(index) {
    if (!trafficModal) return;
    if (!Number.isInteger(index) || index < 0 || index >= state.accounts.length) return;
    const row = state.accounts[index];
    const selectedKey = getAccountIdentityKey(row, resolveRowRouterId(row));
    if (!selectedKey) {
      showToast('Unable to open traffic monitor for this PPPoE entry.', 'error');
      return;
    }
    trafficState.selectedKey = selectedKey;
    hideAllTrafficTooltips();
    const baselineSample = {
      timestamp: Date.now(),
      rxBytes: parseMetric(row?.sessionRxBytes) ?? 0,
      txBytes: parseMetric(row?.sessionTxBytes) ?? 0,
      rxPackets: parseMetric(row?.sessionRxPackets) ?? 0,
      txPackets: parseMetric(row?.sessionTxPackets) ?? 0,
      online: isPppoeOnlineStatus(row?.status),
      downloadRate: 0,
      uploadRate: 0,
      downloadPacketRate: 0,
      uploadPacketRate: 0
    };
    trafficState.samplesByKey.set(selectedKey, [baselineSample]);
    renderTrafficModal();
    trafficModal.classList.add('active');
    trafficModal.setAttribute('aria-hidden', 'false');
  }

  function closeTrafficModal() {
    if (!trafficModal) return;
    trafficModal.classList.remove('active');
    trafficModal.setAttribute('aria-hidden', 'true');
    trafficState.selectedKey = '';
    hideAllTrafficTooltips();
  }

  function openSessionHistoryModal(index = null) {
    if (!sessionHistoryModal) return;
    if (Number.isInteger(index) && index >= 0 && index < state.accounts.length) {
      trafficState.selectedKey = getAccountIdentityKey(state.accounts[index], resolveRowRouterId(state.accounts[index]));
    }
    const selectedKey = String(trafficState.selectedKey || '').trim();
    const row = findAccountByIdentityKey(selectedKey);
    if (!row) {
      showToast('Open a PPPoE traffic row first.', 'error');
      return;
    }
    const routerInfo = resolveRouterInfo(resolveRowRouterId(row));
    const customerInfo = resolveCustomerInfo(row);
    if (sessionHistoryTitle) {
      sessionHistoryTitle.textContent = `Session History: ${String(row?.username || '').trim() || 'PPPoE Entry'}`;
    }
    if (sessionHistorySubtitle) {
      sessionHistorySubtitle.textContent = [
        `Router: ${routerInfo.label}`,
        customerInfo?.hasAssignment ? `Customer: ${customerInfo.name}` : 'Customer: Unassigned'
      ].join(' | ');
    }
    renderTrafficSessionHistory(row);
    sessionHistoryModal.classList.add('active');
    sessionHistoryModal.setAttribute('aria-hidden', 'false');
  }

  function closeSessionHistoryModal() {
    if (!sessionHistoryModal) return;
    sessionHistoryModal.classList.remove('active');
    sessionHistoryModal.setAttribute('aria-hidden', 'true');
  }

  function readPppoeUsageState(row = {}) {
    const sessionRx = parseMetric(row?.sessionRxBytes) ?? 0;
    const sessionTx = parseMetric(row?.sessionTxBytes) ?? 0;
    const sessionTotal = parseMetric(row?.sessionTotalBytes) ?? (sessionRx + sessionTx);
    const carryRx = parseMetric(row?.usageCarryRxBytes) ?? 0;
    const carryTx = parseMetric(row?.usageCarryTxBytes) ?? 0;
    const carryTotal = parseMetric(row?.usageCarryTotalBytes) ?? (carryRx + carryTx);
    return { sessionRx, sessionTx, sessionTotal, carryRx, carryTx, carryTotal };
  }

  function mergePppoeUsageState(previous = null, next = {}) {
    const current = next && typeof next === 'object' ? next : {};
    const nextUsage = readPppoeUsageState(current);
    const history = Array.isArray(previous?.pppoeSessionHistory)
      ? previous.pppoeSessionHistory.slice(-20)
      : [];
    const nextUptimeMs = parseMikrotikDurationMs(current?.sessionUptime || current?.uptime);
    const previousLoginAt = String(previous?.currentSessionLoginAt || '').trim();
    const inferredLoginAt = Number.isFinite(nextUptimeMs)
      ? new Date(Date.now() - nextUptimeMs).toISOString()
      : '';
    if (!previous || typeof previous !== 'object') {
      const initialHistory = Array.isArray(current.pppoeSessionHistory)
        ? current.pppoeSessionHistory.slice(-20)
        : [];
      const initialLogoutAt = !isPppoeOnlineStatus(current.status)
        ? String(current.inactiveSince || '').trim()
        : '';
      let initialHistoryChanged = false;
      if (initialLogoutAt && !hasSessionHistoryEntry(initialHistory, {
        logoutAt: initialLogoutAt,
        source: 'MikroTik last-logged-out'
      })) {
        initialHistory.push(buildCompletedSessionHistoryEntry({
          logoutAt: initialLogoutAt,
          source: 'MikroTik last-logged-out'
        }));
        initialHistoryChanged = true;
      }
      return {
        account: {
          ...current,
          usageCarryRxBytes: nextUsage.carryRx,
          usageCarryTxBytes: nextUsage.carryTx,
          usageCarryTotalBytes: nextUsage.carryTotal,
          sessionRxBytes: nextUsage.sessionRx,
          sessionTxBytes: nextUsage.sessionTx,
          sessionTotalBytes: nextUsage.sessionTotal,
          currentSessionLoginAt: isPppoeOnlineStatus(current.status) ? (inferredLoginAt || current.currentSessionLoginAt || '') : '',
          pppoeSessionHistory: initialHistory.slice(-20)
        },
        rolledOver: initialHistoryChanged
      };
    }

    const prevStatus = normalizePppoeUsageStatus(previous.status);
    const nextStatus = normalizePppoeUsageStatus(current.status);
    const prevUsage = readPppoeUsageState(previous);
    let carryRx = prevUsage.carryRx;
    let carryTx = prevUsage.carryTx;
    let carryTotal = prevUsage.carryTotal;
    const previousLoginTime = Date.parse(previousLoginAt);
    const inferredLoginTime = Date.parse(inferredLoginAt);
    const restartedWhileOnline =
      isPppoeOnlineStatus(prevStatus) &&
      isPppoeOnlineStatus(nextStatus) &&
      Number.isFinite(previousLoginTime) &&
      Number.isFinite(inferredLoginTime) &&
      inferredLoginTime - previousLoginTime > PPPoE_SESSION_RESTART_GRACE_MS;

    const wentOffline = isPppoeOnlineStatus(prevStatus) && isPppoeOfflineStatus(nextStatus);
    const counterResetWhileOnline =
      isPppoeOnlineStatus(prevStatus) &&
      isPppoeOnlineStatus(nextStatus) &&
      prevUsage.sessionTotal > 0 &&
      nextUsage.sessionTotal < prevUsage.sessionTotal;
    const resumedFromLegacyOfflineSnapshot =
      !isPppoeOnlineStatus(prevStatus) &&
      isPppoeOnlineStatus(nextStatus) &&
      prevUsage.sessionTotal > 0 &&
      nextUsage.sessionTotal < prevUsage.sessionTotal;
    const shouldRollPreviousSession =
      prevUsage.sessionTotal > 0 &&
      (wentOffline || counterResetWhileOnline || resumedFromLegacyOfflineSnapshot || restartedWhileOnline);
    const sessionHistory = history.slice();
    let historyChanged = false;

    const appendCompletedSession = (loginAt, logoutAt, source = '') => {
      const safeLogoutAt = String(logoutAt || '').trim();
      if (!safeLogoutAt || hasSessionHistoryEntry(sessionHistory, { loginAt, logoutAt: safeLogoutAt, source })) return;
      sessionHistory.push(buildCompletedSessionHistoryEntry({
        loginAt,
        logoutAt: safeLogoutAt,
        source
      }));
      historyChanged = true;
    };

    if (wentOffline) {
      appendCompletedSession(
        previousLoginAt,
        current.inactiveSince || new Date().toISOString(),
        current.inactiveSince ? 'MikroTik last-logged-out' : 'Billing live status'
      );
    }

    if (!isPppoeOnlineStatus(nextStatus) && current.inactiveSince) {
      appendCompletedSession(
        previousLoginAt,
        current.inactiveSince,
        'MikroTik last-logged-out'
      );
    }

    if (restartedWhileOnline) {
      appendCompletedSession(
        previousLoginAt,
        inferredLoginAt,
        'MikroTik uptime reset'
      );
    }

    if (shouldRollPreviousSession) {
      carryRx += prevUsage.sessionRx;
      carryTx += prevUsage.sessionTx;
      carryTotal += prevUsage.sessionTotal;
    }

    const clearCurrentSession = wentOffline;
    const nextCurrentSessionLoginAt = isPppoeOnlineStatus(nextStatus)
      ? ((restartedWhileOnline || counterResetWhileOnline)
        ? (inferredLoginAt || current.currentSessionLoginAt || '')
        : (previousLoginAt || inferredLoginAt || current.currentSessionLoginAt || ''))
      : '';
    return {
      account: {
        ...current,
        usageCarryRxBytes: carryRx,
        usageCarryTxBytes: carryTx,
        usageCarryTotalBytes: carryTotal,
        sessionRxBytes: clearCurrentSession ? 0 : nextUsage.sessionRx,
        sessionTxBytes: clearCurrentSession ? 0 : nextUsage.sessionTx,
        sessionTotalBytes: clearCurrentSession ? 0 : nextUsage.sessionTotal,
        currentSessionLoginAt: nextCurrentSessionLoginAt,
        pppoeSessionHistory: sessionHistory.slice(-20)
      },
      rolledOver: shouldRollPreviousSession || historyChanged
    };
  }

  const formatBytesGb = (value) => {
    const bytes = parseMetric(value);
    if (!Number.isFinite(bytes)) return '-';
    const gb = bytes / BYTES_PER_GB;
    if (!Number.isFinite(gb)) return '-';
    return `${gb.toFixed(2)} GB`;
  };

  const getRowSessionCount = (row = {}) => {
    const count = Number(row?.activeSessionCount ?? row?.sessionCount ?? 0);
    if (!Number.isFinite(count) || count <= 0) return 0;
    return Math.trunc(count);
  };

  const clampPercent = (value) => {
    if (!Number.isFinite(value)) return null;
    return Math.min(Math.max(value, 0), 100);
  };

  const setUsageIndicator = (container, bar, percent) => {
    if (!container || !bar) return;
    container.classList.remove('is-good', 'is-warn', 'is-high');
    const safe = clampPercent(percent);
    if (!Number.isFinite(safe)) {
      bar.style.width = '0%';
      return;
    }
    bar.style.width = `${safe.toFixed(1)}%`;
    if (safe >= 85) {
      container.classList.add('is-high');
    } else if (safe >= 65) {
      container.classList.add('is-warn');
    } else {
      container.classList.add('is-good');
    }
  };

  const renderConnectionTimer = () => {
    if (!statusTimer) return;
    const activeConnectedAt = getRouterRuntime(resolveActiveRouterId()).connectedAt;
    if (!activeConnectedAt) {
      statusTimer.textContent = 'Connected';
      return;
    }
    statusTimer.textContent = `Connected for ${formatDuration(Date.now() - activeConnectedAt)}`;
  };

  const setConnectionStatus = ({ routerId = '', connected, info, address, reason, source = 'runtime' }) => {
    const runtimeRouterId = resolveRuntimeRouterId(routerId);
    const runtime = getRouterRuntime(runtimeRouterId);
    const isConnected = !!connected;
    const nextInfo = info && typeof info === 'object'
      ? { ...(runtime.info || {}), ...info }
      : runtime.info;
    runtime.connected = isConnected;
    if (isConnected) {
      hideIntegrationDisabled();
      if (runtimeRouterId === resolveActiveRouterId() || (!runtimeRouterId && !resolveActiveRouterId())) {
        renderPppoeSyncStatus({ ok: true });
      }
      runtime.reason = '';
      if (source !== 'cache') {
        runtime.hasConfirmedOnlineStatus = true;
      }
    } else {
      if (runtimeRouterId === resolveActiveRouterId() || (!runtimeRouterId && !resolveActiveRouterId())) {
        renderPppoeSyncStatus({ ok: false, message: 'Failed' });
      }
      runtime.hasConfirmedOnlineStatus = false;
    }

    if (isConnected) {
      if (!runtime.wasConnected) {
        const cached = loadCache(runtimeRouterId);
        runtime.connectedAt = cached?.connectedAt || Date.now();
      }
      runtime.info = nextInfo;
      runtime.address = address || runtime.address;
      runtime.wasConnected = true;
      saveCache(runtimeRouterId, {
        info: runtime.info,
        address: runtime.address,
        connectedAt: runtime.connectedAt,
        connected: true
      });
    } else {
      const previousConnectedAt = runtime.connectedAt;
      runtime.wasConnected = false;
      runtime.connectedAt = null;
      runtime.reason = reason || runtime.reason || 'MikroTik not connected';
      if (info) runtime.info = nextInfo;
      if (address) runtime.address = address;
      saveCache(runtimeRouterId, {
        info: runtime.info,
        address: runtime.address,
        connectedAt: previousConnectedAt || null,
        connected: false
      });
    }

    if (!liveStatusSupported) {
      if (getAllRouterIds().length) {
        startAutoSync();
      } else {
        stopAutoSync();
      }
    }

    if (runtimeRouterId === resolveActiveRouterId() || (!runtimeRouterId && !resolveActiveRouterId())) {
      renderActiveRouterConnection();
    }
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

  const getStatusInfo = (status, inactiveSince, activeSessionCount = 0) => {
    const normalized = String(status || '').toLowerCase();
    const sessionMeta = Number(activeSessionCount) > 1 ? `${Math.trunc(Number(activeSessionCount))} sessions` : '';
    if (normalized === 'online') return { label: 'Online', className: 'status-pill status-pill--good', meta: sessionMeta };
    if (normalized === 'offline') return { label: 'Offline', className: 'status-pill status-pill--neutral', meta: '' };
    if (normalized === 'disabled' || normalized === 'inactive') return { label: 'Disabled', className: 'status-pill status-pill--alert', meta: '' };
    if (normalized === 'active') return { label: 'Online', className: 'status-pill status-pill--good', meta: sessionMeta }; // legacy support
    return { label: 'Unknown', className: 'status-pill', meta: '' };
  };

  const getUsageBytes = (row) => {
    const usage = readPppoeUsageState(row);
    const total = usage.carryTotal + usage.sessionTotal;
    if (!Number.isFinite(total) || total <= 0) return 0;
    return total;
  };

  const formatUsageFromBytes = (bytes) => {
    const gb = Number(bytes) / BYTES_PER_GB;
    if (!Number.isFinite(gb) || gb <= 0) return '0.00 GB';
    if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
    return `${gb.toFixed(2)} GB`;
  };

  const getMaskedPassword = (password) => {
    const raw = String(password || '').trim();
    if (!raw) return '-';
    return PASSWORD_MASK_HTML;
  };

  const getLastSeenInfo = (row) => {
    const status = String(row?.status || '').toLowerCase();
    if (status === 'online' || status === 'active') {
      if (!mikrotikConnected) {
        return { label: '--', meta: '', className: 'last-seen-cell last-seen-cell--muted' };
      }
      const uptime = String(row?.sessionUptime || row?.uptime || '').trim();
      return {
        label: uptime || 'Live',
        meta: '',
        className: 'last-seen-cell last-seen-cell--online'
      };
    }
    const raw = getResolvedLastSeenValue(row);
    const formatted = formatOfflineDate(raw);
    if (formatted) {
      return { label: formatted, meta: '', className: 'last-seen-cell' };
    }
    return { label: '--', meta: '', className: 'last-seen-cell last-seen-cell--muted' };
  };

  const customerLabel = (customer = {}) => {
    const fullName = (customer.name || `${customer.firstName || ''} ${customer.lastName || ''}`.trim()).trim();
    const accountTag = customer.accountNumber ? ` (${customer.accountNumber})` : '';
    if (fullName) return `${fullName}${accountTag}`;
    return customer.accountNumber || '';
  };

  const customerDisplayName = (customer = {}) => {
    const fullName = String(customer?.name || '').trim();
    if (fullName) return fullName;
    return `${String(customer?.firstName || '').trim()} ${String(customer?.lastName || '').trim()}`.trim();
  };

  const splitCustomerLabel = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return { name: '', account: '' };

    const paren = raw.match(/^(.*?)\s*\((\d{4,})\)\s*$/);
    if (paren) {
      return {
        name: String(paren[1] || '').trim(),
        account: String(paren[2] || '').trim()
      };
    }

    if (/^\d{4,}$/.test(raw)) {
      return { name: '', account: raw };
    }

    const suffix = raw.match(/^(.*?)[\s-]+(\d{4,})$/);
    if (suffix && /[A-Za-z]/.test(String(suffix[1] || ''))) {
      return {
        name: String(suffix[1] || '').trim(),
        account: String(suffix[2] || '').trim()
      };
    }

    return { name: raw, account: '' };
  };

  const getCustomerNameParts = (customer = {}) => {
    const rawFirst = String(customer?.firstName || '').trim();
    const rawLast = String(customer?.lastName || '').trim();
    const rawName = String(customer?.name || '').trim();
    if (rawFirst || rawLast) {
      return {
        firstName: rawFirst,
        lastName: rawLast,
        fullName: rawName || `${rawFirst} ${rawLast}`.trim()
      };
    }
    if (!rawName) return { firstName: '', lastName: '', fullName: '' };
    const parts = rawName.split(/\s+/).filter(Boolean);
    const firstName = parts.shift() || '';
    const lastName = parts.join(' ');
    return { firstName, lastName, fullName: rawName };
  };

  const toSlugToken = (value) => {
    const ascii = String(value || '')
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '');
    return ascii
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toUpperCase();
  };

  const toPasswordChunk = (value) => {
    const token = toSlugToken(value).replace(/-/g, '');
    if (!token) return '';
    return token.slice(0, 2);
  };

  const parseNapCodeParts = (rawCode) => {
    const normalizedCode = toSlugToken(rawCode);
    if (!normalizedCode) return { napCode: '', napNumber: '' };
    const compactMatch = normalizedCode.match(/(?:^|.*-)([A-Z0-9]+)-NAP-([A-Z0-9]+)$/);
    if (compactMatch) {
      const napNoRaw = compactMatch[2];
      const napNo = /^\d+$/.test(napNoRaw) ? napNoRaw.padStart(2, '0') : napNoRaw;
      return { napCode: compactMatch[1], napNumber: `NAP-${napNo}` };
    }
    const parts = normalizedCode.split('-').filter(Boolean);
    const napIndex = parts.lastIndexOf('NAP');
    if (napIndex > 0 && napIndex < parts.length - 1) {
      const napCode = parts[napIndex - 1] || '';
      const rawNo = parts[napIndex + 1] || '';
      if (!napCode || !rawNo) return { napCode: '', napNumber: '' };
      const napNo = /^\d+$/.test(rawNo) ? rawNo.padStart(2, '0') : rawNo;
      return { napCode, napNumber: `NAP-${napNo}` };
    }
    return { napCode: '', napNumber: '' };
  };

  const findCustomerByAccount = (accountNumber) => {
    const key = String(accountNumber || '').trim();
    if (!key) return null;
    return customerByAccount.get(key) || null;
  };

  const resolveCustomerAssignedPppoe = (customer) => {
    if (!customer) return null;
    const username = String(customer?.pppoeUsername || '').trim();
    if (!username) return null;

    const usernameKey = normalizePppoeUsernameKey(username);
    const customerRouterId = normalizeRouterId(customer?.mikrotikId || customer?.routerId) || '';
    const matchingRow = state.accounts.find((entry) => {
      const entryUsernameKey = normalizePppoeUsernameKey(entry?.username || entry?.name);
      if (entryUsernameKey !== usernameKey) return false;
      if (!customerRouterId) return true;
      return resolveRowRouterId(entry) === customerRouterId;
    }) || state.accounts.find((entry) => normalizePppoeUsernameKey(entry?.username || entry?.name) === usernameKey);

    const password = String(customer?.pppoePassword || matchingRow?.password || '').trim();
    if (!password) return null;

    return {
      username,
      password,
      profile: String(customer?.pppoeProfile || matchingRow?.profile || '').trim(),
      routerId: customerRouterId || resolveRowRouterId(matchingRow) || resolveActiveRouterId() || routerState.defaultId || '',
      row: matchingRow || null
    };
  };

  const resolveCustomerPlan = (customer) => {
    const planKey = normalizePlanName(customer?.planName);
    if (!planKey) return null;
    return planLookupByName.get(planKey) || null;
  };

  const getCoverageLinkedRouterId = (customer = {}) => {
    const areaKey = normalizeCoverageAreaKey(resolveCustomerCoverageAreaName(customer));
    if (!areaKey) return '';
    return normalizeRouterId(coverageAreaRouterMap.get(areaKey));
  };

  const resolvePreferredGenerateRouterId = (customer = null, fallbackRouterId = '') => {
    const coverageRouterId = getCoverageLinkedRouterId(customer);
    if (coverageRouterId) return coverageRouterId;
    const customerRouterId = normalizeRouterId(customer?.mikrotikId || customer?.routerId);
    if (customerRouterId) return customerRouterId;
    return normalizeRouterId(fallbackRouterId) || resolveActiveRouterId() || routerState.defaultId || '';
  };

  const resolveSuggestedGenerateProfile = (customer, preferredRouterId = '') => {
    const matchedPlan = resolveCustomerPlan(customer);
    const targetRouterId =
      normalizeRouterId(preferredRouterId)
      || resolveActiveRouterId()
      || routerState.defaultId
      || '';
    const customerRouterId = normalizeRouterId(customer?.mikrotikId || customer?.routerId) || '';
    const customerProfile = String(customer?.pppoeProfile || '').trim();
    if (customerProfile && (!customerRouterId || customerRouterId === targetRouterId)) {
      return { profile: customerProfile, source: 'customer', matchedPlan };
    }
    const planProfile = resolvePlanProfileForRouter(matchedPlan, targetRouterId);
    if (planProfile) {
      return { profile: planProfile, source: 'plan', matchedPlan };
    }
    return { profile: '', source: '', matchedPlan };
  };

  const resolveGenerateSetupState = (customer = null, fallbackRouterId = '') => {
    const activeRouterId =
      normalizeRouterId(fallbackRouterId)
      || resolveActiveRouterId()
      || routerState.defaultId
      || '';
    const coverageLinkedRouterId = getCoverageLinkedRouterId(customer);
    const targetRouterId = resolvePreferredGenerateRouterId(customer, activeRouterId);
    const profileSuggestion = resolveSuggestedGenerateProfile(customer, targetRouterId);
    const activeRouter = resolveRouterInfo(activeRouterId);
    const activeRouterLabel = String(
      activeRouter?.label || activeRouter?.address || 'selected router'
    ).trim() || 'selected router';
    const targetRouter = resolveRouterInfo(targetRouterId);
    const targetRouterLabel = String(
      targetRouter?.label || targetRouter?.address || activeRouterLabel
    ).trim() || activeRouterLabel;
    const customerAreaName = resolveCustomerCoverageAreaName(customer);
    const matchedPlanLabel = String(
      profileSuggestion.matchedPlan?.label
      || profileSuggestion.matchedPlan?.name
      || customer?.planName
      || ''
    ).trim();
    const coverageSetupAction = customerAreaName
      ? `Set Coverage Table > MikroTik Link for area "${customerAreaName}".`
      : 'Set the customer coverage area first, then link it in Coverage Table.';
    const coverageMessage = !customer
      ? ''
      : coverageLinkedRouterId && customerAreaName
        ? `Coverage area "${customerAreaName}" is linked to ${targetRouterLabel}.`
        : customerAreaName
          ? `Coverage area "${customerAreaName}" has no MikroTik link yet. ${coverageSetupAction}`
          : coverageSetupAction;
    const routerSwitchMessage =
      !coverageLinkedRouterId
      && targetRouterId
      && normalizeRouterId(targetRouterId) !== normalizeRouterId(activeRouterId)
        ? `Generate will use ${targetRouterLabel} instead of ${activeRouterLabel}.`
        : '';
    const routingMessage = coverageLinkedRouterId && customerAreaName
      ? coverageMessage
      : [coverageMessage, routerSwitchMessage].filter(Boolean).join(' ');
    const profileSourceLabel = profileSuggestion.source === 'customer'
      ? 'customer PPPoE profile'
      : matchedPlanLabel
        ? `plan "${matchedPlanLabel}"`
        : 'customer plan';
    const profileMissingOnRouter = Boolean(
      profileSuggestion.profile
      && hasLoadedRouterProfiles(targetRouterId)
      && !hasRouterProfile(targetRouterId, profileSuggestion.profile)
    );
    const planSetupAction = matchedPlanLabel
      ? `Set Plans > Router Profile for ${targetRouterLabel} under plan "${matchedPlanLabel}", then make sure that profile exists on ${targetRouterLabel}.`
      : 'Set the customer plan first, or assign a PPPoE profile before generating.';
    const profileMissingAction = matchedPlanLabel
      ? `Create that profile on ${targetRouterLabel}, or update Plans > Router Profile for plan "${matchedPlanLabel}".`
      : `Create that profile on ${targetRouterLabel}, or set the customer plan first.`;
    const planMessage = !customer
      ? ''
      : profileSuggestion.profile
        ? (
            profileMissingOnRouter
              ? `Auto profile: ${profileSuggestion.profile} from ${profileSourceLabel}, but it is missing on ${targetRouterLabel}. ${profileMissingAction}`
              : `Auto profile: ${profileSuggestion.profile} from ${profileSourceLabel}.`
          )
        : planSetupAction;

    return {
      activeRouterId,
      activeRouterLabel,
      coverageLinkedRouterId,
      coverageMessage,
      coverageSetupAction,
      customerAreaName,
      matchedPlanLabel,
      planMessage,
      planSetupAction,
      profileMissingOnRouter,
      profileSuggestion,
      routingMessage,
      targetRouterId,
      targetRouterLabel
    };
  };

  const buildGeneratedCredentials = (customer, preferredRouterId = '') => {
    if (!customer) {
      return {
        username: '',
        password: '',
        napBinding: null,
        source: 'generated',
        existingAssignment: null,
        reusedExistingCredentials: false,
        assignmentMatchesRouter: false
      };
    }
    const accountNumber = String(customer.accountNumber || customer.id || '').trim();
    const napBinding = napBindingByAccount.get(accountNumber) || null;
    const targetRouterId =
      normalizeRouterId(preferredRouterId)
      || resolveActiveRouterId()
      || routerState.defaultId
      || '';
    const existingAssignment = resolveCustomerAssignedPppoe(customer);
    if (existingAssignment) {
      const existingRouterId = normalizeRouterId(existingAssignment.routerId);
      const assignmentMatchesRouter =
        !targetRouterId
        || !existingRouterId
        || existingRouterId === targetRouterId;
      return {
        username: existingAssignment.username,
        password: existingAssignment.password,
        napBinding,
        source: assignmentMatchesRouter ? 'assigned' : 'generated',
        existingAssignment,
        reusedExistingCredentials: true,
        assignmentMatchesRouter
      };
    }

    const nameParts = getCustomerNameParts(customer);
    const firstToken = toSlugToken(nameParts.firstName || nameParts.fullName || 'CUSTOMER') || 'CUSTOMER';
    const lastToken = toSlugToken(nameParts.lastName || '');
    const usernameNameParts = [firstToken, lastToken].filter(Boolean);

    const parsedNap = parseNapCodeParts(napBinding?.code || '');
    const usernameParts = [
      parsedNap.napCode,
      parsedNap.napNumber,
      ...usernameNameParts
    ].filter(Boolean);
    const fallbackUsernameParts = usernameNameParts.length ? usernameNameParts : ['CUSTOMER'];
    const username = (usernameParts.length ? usernameParts : fallbackUsernameParts).join('-');

    const firstChunk = toPasswordChunk(nameParts.firstName || nameParts.fullName || 'CU');
    const lastChunk = toPasswordChunk(nameParts.lastName || '');
    const prefix = `${firstChunk}${lastChunk}` || firstChunk || 'PW';
    const safeAccount = accountNumber || '00000000';
    const password = `${prefix}-${safeAccount}`.toUpperCase();

    return {
      username,
      password,
      napBinding,
      source: 'generated',
      existingAssignment: null,
      reusedExistingCredentials: false,
      assignmentMatchesRouter: false
    };
  };

  const getGenerateEligibleCustomers = (routerId = resolveActiveRouterId()) => {
    const targetRouterId = normalizeRouterId(routerId) || resolveActiveRouterId() || routerState.defaultId || '';
    if (!targetRouterId) return [];
    return customerRecords.filter((customer) => {
      const accountNumber = String(customer?.accountNumber || '').trim();
      if (!accountNumber) return false;
      return getCoverageLinkedRouterId(customer) === targetRouterId;
    });
  };

  const populateGenerateCustomerOptions = () => {
    if (!generateCustomerSelect) return;
    const previousValue = String(generateCustomerSelect.value || '');
    const previousSearch = String(generateCustomerSearchInput?.value || '').trim();
    const activeGenerateRouterId = resolveActiveRouterId();
    const activeGenerateRouter = resolveRouterInfo(activeGenerateRouterId);
    const activeGenerateRouterLabel = String(
      activeGenerateRouter?.label || activeGenerateRouter?.address || 'this router'
    ).trim() || 'this router';
    const eligibleCustomers = getGenerateEligibleCustomers(activeGenerateRouterId);
    const placeholderLabel = eligibleCustomers.length
      ? 'Select customer'
      : `No Coverage Table customers linked to ${activeGenerateRouterLabel}`;
    generateCustomerSelect.innerHTML = '';
    generateCustomerSelect.add(new Option(placeholderLabel, ''));
    const sorted = [...eligibleCustomers].sort((a, b) => {
      const labelA = customerLabel(a).toLowerCase();
      const labelB = customerLabel(b).toLowerCase();
      return labelA.localeCompare(labelB);
    });
    generateCustomerSearchRows = [];
    sorted.forEach((customer) => {
      const accountNumber = String(customer?.accountNumber || '').trim();
      if (!accountNumber) return;
      const label = customerLabel(customer) || accountNumber;
      const napBinding = napBindingByAccount.get(accountNumber);
      const suffix = napBinding?.code ? ` • ${napBinding.code}` : '';
      const optionLabel = `${label}${suffix}`;
      const searchText = [
        optionLabel,
        accountNumber,
        customerDisplayName(customer),
        customer?.firstName,
        customer?.lastName,
        customer?.name,
        customer?.planName,
        customer?.area,
        customer?.coverageArea,
        customer?.address,
        customer?.mobile,
        napBinding?.code,
        customer?.pppoeUsername
      ].join(' ').toLowerCase();
      generateCustomerSearchRows.push({
        accountNumber,
        label: optionLabel,
        searchText
      });
      generateCustomerSelect.add(new Option(optionLabel, accountNumber));
    });
    if (previousValue && sorted.some((customer) => String(customer?.accountNumber || '').trim() === previousValue)) {
      generateCustomerSelect.value = previousValue;
      const selectedRow = generateCustomerSearchRows.find((row) => row.accountNumber === previousValue);
      if (generateCustomerSearchInput && selectedRow) {
        generateCustomerSearchInput.value = selectedRow.label;
      }
    } else {
      generateCustomerSelect.value = '';
      if (generateCustomerSearchInput) {
        generateCustomerSearchInput.value = previousSearch && generateCustomerSearchRows.some((row) =>
          row.label.toLowerCase() === previousSearch.toLowerCase()
          || row.accountNumber.toLowerCase() === previousSearch.toLowerCase()
        ) ? previousSearch : '';
      }
    }
  };

  const syncGenerateCustomerFromSearch = ({ allowSingleMatch = false } = {}) => {
    if (!generateCustomerSelect || !generateCustomerSearchInput) return '';
    const raw = String(generateCustomerSearchInput.value || '').trim();
    if (!raw) {
      generateCustomerSelect.value = '';
      return '';
    }
    const normalized = raw.toLowerCase();
    let match = generateCustomerSearchRows.find((row) =>
      row.label.toLowerCase() === normalized
      || row.accountNumber.toLowerCase() === normalized
    );
    if (!match && allowSingleMatch) {
      const matches = generateCustomerSearchRows.filter((row) => row.searchText.includes(normalized));
      if (matches.length === 1) {
        match = matches[0];
      }
    }
    generateCustomerSelect.value = match ? match.accountNumber : '';
    if (match && generateCustomerSearchInput.value !== match.label) {
      generateCustomerSearchInput.value = match.label;
    }
    return generateCustomerSelect.value;
  };

  const hideGenerateCustomerResults = () => {
    if (!generateCustomerResults) return;
    generateCustomerResults.hidden = true;
    generateCustomerResults.innerHTML = '';
    generateCustomerSearchInput?.setAttribute('aria-expanded', 'false');
  };

  const selectGenerateCustomerRow = (row) => {
    if (!row || !generateCustomerSelect || !generateCustomerSearchInput) return;
    generateCustomerSelect.value = row.accountNumber;
    generateCustomerSearchInput.value = row.label;
    hideGenerateCustomerResults();
    syncGeneratePreview();
  };

  const renderGenerateCustomerResults = () => {
    if (!generateCustomerResults || !generateCustomerSearchInput) return;
    const query = String(generateCustomerSearchInput.value || '').trim().toLowerCase();
    const matches = (query
      ? generateCustomerSearchRows.filter((row) => row.searchText.includes(query))
      : generateCustomerSearchRows
    ).slice(0, 12);

    generateCustomerResults.innerHTML = '';
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'pppoe-customer-search-empty';
      empty.textContent = query ? 'No matching customers' : 'No customers available';
      generateCustomerResults.appendChild(empty);
    } else {
      matches.forEach((row) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pppoe-customer-search-option';
        button.setAttribute('role', 'option');
        button.dataset.accountNumber = row.accountNumber;
        button.innerHTML = `
          <span class="pppoe-customer-search-option__label">${escapeHtml(row.label)}</span>
          <span class="pppoe-customer-search-option__meta">${escapeHtml(row.accountNumber)}</span>
        `;
        generateCustomerResults.appendChild(button);
      });
    }
    generateCustomerResults.hidden = false;
    generateCustomerSearchInput.setAttribute('aria-expanded', 'true');
  };

  const syncGeneratePreview = () => {
    if (!generateCustomerSelect || !generateUsernameInput || !generatePasswordInput) return;
    syncGenerateCustomerFromSearch();
    const accountNumber = String(generateCustomerSelect.value || '').trim();
    const activeGenerateRouterId = resolveActiveRouterId();
    const customer = findCustomerByAccount(accountNumber);
    const setupState = resolveGenerateSetupState(customer, activeGenerateRouterId);
    const targetGenerateRouterId = setupState.targetRouterId;
    const generated = buildGeneratedCredentials(customer, targetGenerateRouterId);
    const profileSuggestion = setupState.profileSuggestion;
    const targetGenerateRouterLabel = setupState.targetRouterLabel;
    const routingPrefix = setupState.routingMessage;
    generateUsernameInput.value = generated.username || '';
    generatePasswordInput.value = generated.password || '';
    if (generateSaveBtn) {
      generateSaveBtn.innerHTML = generated.source === 'assigned'
        ? 'Use Assigned PPPoE'
        : 'Generate &amp; Save';
    }

    if (generateNote) {
      let usernameNote = 'Username format: NAPCODE-NAPNO-FIRST-LAST (or FIRST-LAST if no NAP).';
      const eligibleCustomers = getGenerateEligibleCustomers(activeGenerateRouterId);
      if (!accountNumber || !customer) {
        if (!eligibleCustomers.length) {
          generateNote.textContent = `No customers are linked to ${setupState.activeRouterLabel} in Coverage Table. Link an area to ${setupState.activeRouterLabel} first.`;
        } else {
          generateNote.textContent = `${usernameNote} If the customer already has PPPoE assigned, the existing username/password will be shown.`;
        }
      } else if (generated.source === 'assigned' && generated.existingAssignment) {
        const assignedRouter = resolveRouterInfo(generated.existingAssignment.routerId);
        const routerLabel = String(assignedRouter?.label || '').trim();
        const profileLabel = String(generated.existingAssignment.profile || profileSuggestion.profile || '').trim();
        const routerSuffix = routerLabel ? ` on ${routerLabel}` : '';
        const profileSuffix = profileLabel ? ` Profile: ${profileLabel}.` : '';
        const routeText = routingPrefix ? `${routingPrefix} ` : '';
        generateNote.textContent = `${routeText}Customer already has assigned PPPoE${routerSuffix}. Using existing username/password: ${generated.username}.${profileSuffix}`;
      } else if (generated.reusedExistingCredentials && generated.existingAssignment) {
        const assignedRouter = resolveRouterInfo(generated.existingAssignment.routerId);
        const routerLabel = String(assignedRouter?.label || assignedRouter?.address || '').trim();
        const routerSuffix = routerLabel ? ` on ${routerLabel}` : '';
        usernameNote = `Customer already has assigned PPPoE${routerSuffix}. Reusing username/password ${generated.username} for ${targetGenerateRouterLabel}.`;
      } else if (generated.napBinding?.code) {
        usernameNote = `NAP detected: ${generated.napBinding.code}. Username: ${generated.username}`;
      } else {
        usernameNote = `No NAP assignment found for this customer. Username: ${generated.username}`;
      }

      if (routingPrefix && generated.source !== 'assigned') {
        usernameNote = `${routingPrefix} ${usernameNote}`;
      }

      if (accountNumber && customer && generated.source !== 'assigned') {
        generateNote.textContent = setupState.planMessage
          ? `${usernameNote} ${setupState.planMessage}`
          : usernameNote;
      }
    }
  };

  const openGenerateModal = () => {
    if (!generateModal) return;
    if (!mikrotikConnected || !hasConfirmedOnlineStatus) {
      showToast('Generate PPPoE is available only when OLT/MikroTik is online.', 'error');
      return;
    }
    populateGenerateCustomerOptions();
    syncGeneratePreview();
    generateModal.classList.add('active');
    generateModal.setAttribute('aria-hidden', 'false');
    generateCustomerSearchInput?.focus();
  };

  const closeGenerateModal = () => {
    if (!generateModal) return;
    generateModal.classList.remove('active');
    generateModal.setAttribute('aria-hidden', 'true');
    if (generateForm) generateForm.reset();
    generateCustomerSearchInput && (generateCustomerSearchInput.value = '');
    if (generateSaveBtn) {
      generateSaveBtn.innerHTML = 'Generate &amp; Save';
    }
    if (generateNote) {
      generateNote.textContent = 'Username format: NAPCODE-NAPNO-FIRST-LAST (or FIRST-LAST if no NAP). If the customer already has PPPoE assigned, the existing username/password will be shown.';
    }
  };

  const linkGeneratedToCustomer = async (customerAccount, entry, customer) => {
    const accountKey = String(customerAccount || '').trim();
    if (!accountKey || !entry?.username) return;
    const payload = {
      pppoeMode: 'manual',
      pppoeUsername: String(entry.username || ''),
      pppoePassword: String(entry.password || ''),
      pppoeProfile: String(entry.profile || ''),
      mikrotikId: resolveRowRouterId(entry)
    };
    const res = await fetch(`/api/customers/${encodeURIComponent(accountKey)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.message || data?.error || 'Failed to update customer PPPoE details');
    }
    const target = customer || findCustomerByAccount(accountKey);
    if (target) {
      target.pppoeMode = payload.pppoeMode;
      target.pppoeUsername = payload.pppoeUsername;
      target.pppoePassword = payload.pppoePassword;
      target.pppoeProfile = payload.pppoeProfile;
      target.mikrotikId = payload.mikrotikId;
      customerByAccount.set(accountKey, target);
    }
    hydrateCustomerLookup(customerRecords);
  };

  const unlinkPppoeFromCustomer = async (customerAccount) => {
    const accountKey = String(customerAccount || '').trim();
    if (!accountKey) return;
    const payload = {
      pppoeMode: '',
      pppoeUsername: '',
      pppoePassword: '',
      pppoeProfile: ''
    };
    const res = await fetch(`/api/customers/${encodeURIComponent(accountKey)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.message || data?.error || 'Failed to clear customer PPPoE details');
    }
    const target = findCustomerByAccount(accountKey);
    if (target) {
      target.pppoeMode = '';
      target.pppoeUsername = '';
      target.pppoePassword = '';
      target.pppoeProfile = '';
      customerByAccount.set(accountKey, target);
    }
    hydrateCustomerLookup(customerRecords);
  };

  const loadPonState = async () => {
    try {
      const res = await fetch('/api/pon/state', { cache: 'no-store', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || 'Failed to load PON state');
      const nextMap = new Map();
      const naps = Array.isArray(data?.naps) ? data.naps : [];
      naps.forEach((nap) => {
        const napCode = String(nap?.code || '').trim();
        const connections = Array.isArray(nap?.connections) ? nap.connections : [];
        connections.forEach((connection) => {
          const customerRef = String(connection?.customerRef || '').trim();
          const refAccountMatch = customerRef.match(/\b\d{6,12}\b/);
          const customerAccount = String(connection?.customerId || refAccountMatch?.[0] || '').trim();
          if (!customerAccount) return;
          const portNumber = Number(connection?.port);
          nextMap.set(customerAccount, {
            code: napCode,
            port: Number.isFinite(portNumber) && portNumber > 0 ? portNumber : null
          });
        });
      });
      napBindingByAccount = nextMap;
      populateGenerateCustomerOptions();
      syncGeneratePreview();
    } catch (err) {
      napBindingByAccount = new Map();
      populateGenerateCustomerOptions();
      syncGeneratePreview();
      console.warn('Failed to load PON state for PPPoE generation:', err?.message || err);
    }
  };

  const getAssignedCustomerAccountForEntry = (entry) => {
    const explicitAccount = String(entry?.customerAccount || entry?.accountNumber || entry?.customerId || '').trim();
    if (explicitAccount) return explicitAccount;
    const usernameKey = String(entry?.username || '').trim().toLowerCase();
    if (!usernameKey) return '';
    const routerKey = resolveRowRouterId(entry);
    const lookupKey = `${routerKey}::${usernameKey}`;
    const mapped = customerLookupByUsername.get(lookupKey);
    return String(mapped?.accountNumber || '').trim();
  };

  const applyCustomerAssignmentToAccounts = (accounts = [], customerAccount = '', targetEntry = null, customer = null) => {
    const sourceAccounts = Array.isArray(accounts) ? accounts : [];
    const accountKey = String(customerAccount || '').trim();
    if (!accountKey || !targetEntry) return sourceAccounts.slice();
    const targetKey = getAccountIdentityKey(
      targetEntry,
      resolveRowRouterId(targetEntry) || resolveActiveRouterId() || routerState.defaultId || ''
    );
    if (!targetKey) return sourceAccounts.slice();
    const targetPresent = sourceAccounts.some((entry) =>
      getAccountIdentityKey(entry, resolveRowRouterId(entry)) === targetKey
    );
    if (!targetPresent) return sourceAccounts.slice();
    const assignedLabel = customer ? customerLabel(customer) : String(targetEntry?.pairedCustomer || '').trim();
    return sourceAccounts.map((entry) => {
      const rowKey = getAccountIdentityKey(entry, resolveRowRouterId(entry));
      if (rowKey === targetKey) {
        return {
          ...entry,
          customerAccount: accountKey,
          pairedCustomer: assignedLabel || String(entry?.pairedCustomer || '').trim(),
          pairedPppoe: ''
        };
      }
      const explicitAccount = String(entry?.customerAccount || entry?.accountNumber || entry?.customerId || '').trim();
      if (explicitAccount && explicitAccount === accountKey) {
        return {
          ...entry,
          customerAccount: '',
          pairedCustomer: '',
          pairedPppoe: ''
        };
      }
      return entry;
    });
  };

  const buildCustomerSearchText = (customer = {}, label = '', extraValues = []) => [
    label,
    customer?.accountNumber,
    customerDisplayName(customer),
    customer?.firstName,
    customer?.lastName,
    customer?.name,
    customer?.planName,
    customer?.area,
    customer?.coverageArea,
    customer?.address,
    customer?.mobile,
    customer?.pppoeUsername,
    customer?.pppoeProfile,
    ...extraValues
  ].join(' ').toLowerCase();

  const setCustomerSelectOption = (select, accountNumber = '', label = 'Select customer') => {
    if (!select) return;
    const value = String(accountNumber || '').trim();
    select.innerHTML = '';
    select.add(new Option(value ? label : 'Select customer', value));
    select.value = value;
  };

  const hideAssignCustomerResults = () => {
    if (!assignCustomerResults) return;
    assignCustomerResults.hidden = true;
    assignCustomerResults.innerHTML = '';
    assignCustomerSearchInput?.setAttribute('aria-expanded', 'false');
  };

  const selectAssignCustomerRow = (row) => {
    if (!row || !assignCustomerSelect || !assignCustomerSearchInput) return;
    setCustomerSelectOption(assignCustomerSelect, row.accountNumber, row.label);
    assignCustomerSearchInput.value = row.label;
    hideAssignCustomerResults();
  };

  const syncAssignCustomerFromSearch = ({ allowSingleMatch = false } = {}) => {
    if (!assignCustomerSelect || !assignCustomerSearchInput) return '';
    const raw = String(assignCustomerSearchInput.value || '').trim();
    if (!raw) {
      setCustomerSelectOption(assignCustomerSelect);
      return '';
    }
    const normalized = raw.toLowerCase();
    let match = assignCustomerSearchRows.find((row) =>
      row.label.toLowerCase() === normalized
      || row.accountNumber.toLowerCase() === normalized
    );
    if (!match && allowSingleMatch) {
      const matches = assignCustomerSearchRows.filter((row) => row.searchText.includes(normalized));
      if (matches.length === 1) match = matches[0];
    }
    if (match) {
      setCustomerSelectOption(assignCustomerSelect, match.accountNumber, match.label);
      if (assignCustomerSearchInput.value !== match.label) {
        assignCustomerSearchInput.value = match.label;
      }
      return match.accountNumber;
    }
    setCustomerSelectOption(assignCustomerSelect);
    return '';
  };

  const renderAssignCustomerResults = () => {
    if (!assignCustomerResults || !assignCustomerSearchInput) return;
    const query = String(assignCustomerSearchInput.value || '').trim().toLowerCase();
    const matches = (query
      ? assignCustomerSearchRows.filter((row) => row.searchText.includes(query))
      : assignCustomerSearchRows
    ).slice(0, 15);

    const fragment = document.createDocumentFragment();
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'pppoe-customer-search-empty';
      empty.textContent = query ? 'No matching customers' : 'No customers available';
      fragment.appendChild(empty);
    } else {
      matches.forEach((row) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pppoe-customer-search-option';
        button.setAttribute('role', 'option');
        button.dataset.accountNumber = row.accountNumber;
        button.innerHTML = `
          <span class="pppoe-customer-search-option__label">${escapeHtml(row.label)}</span>
          <span class="pppoe-customer-search-option__meta">${escapeHtml(row.meta || row.accountNumber)}</span>
        `;
        fragment.appendChild(button);
      });
    }
    assignCustomerResults.replaceChildren(fragment);
    assignCustomerResults.hidden = false;
    assignCustomerSearchInput.setAttribute('aria-expanded', 'true');
  };

  const populateAssignCustomerOptions = (preferredAccount = '') => {
    if (!assignCustomerSelect) return;
    const previousValue = String(preferredAccount || assignCustomerSelect.value || '').trim();
    const sorted = [...customerRecords].sort((a, b) => {
      const labelA = customerLabel(a).toLowerCase();
      const labelB = customerLabel(b).toLowerCase();
      return labelA.localeCompare(labelB);
    });
    assignCustomerSearchRows = [];
    sorted.forEach((customer) => {
      const accountNumber = String(customer?.accountNumber || '').trim();
      if (!accountNumber) return;
      const hasPppoe = Boolean(String(customer?.pppoeUsername || '').trim());
      const pppoeUsername = String(customer?.pppoeUsername || '').trim();
      const suffix = hasPppoe ? ` • current: ${pppoeUsername}` : '';
      const label = `${customerLabel(customer)}${suffix}` || accountNumber;
      const meta = [
        accountNumber ? `Acct: ${accountNumber}` : '',
        customer?.planName || '',
        resolveCustomerCoverageAreaName(customer),
        pppoeUsername ? `PPPoE: ${pppoeUsername}` : ''
      ].filter(Boolean).join(' • ');
      assignCustomerSearchRows.push({
        accountNumber,
        label,
        meta,
        searchText: buildCustomerSearchText(customer, label)
      });
    });
    const selectedRow = previousValue
      ? assignCustomerSearchRows.find((row) => row.accountNumber === previousValue)
      : null;
    if (selectedRow) {
      setCustomerSelectOption(assignCustomerSelect, selectedRow.accountNumber, selectedRow.label);
      if (assignCustomerSearchInput) assignCustomerSearchInput.value = selectedRow.label;
    } else {
      setCustomerSelectOption(assignCustomerSelect);
      if (assignCustomerSearchInput) assignCustomerSearchInput.value = '';
    }
  };

  const getCurrentAssignEntry = () => {
    const indexFromKey = findAccountIndexByIdentityKey(assigningKey);
    if (indexFromKey >= 0) {
      assigningIndex = indexFromKey;
      return state.accounts[indexFromKey] || null;
    }
    if (Number.isInteger(assigningIndex) && assigningIndex >= 0 && assigningIndex < state.accounts.length) {
      const fallbackEntry = state.accounts[assigningIndex] || null;
      const fallbackKey = getAccountIdentityKey(fallbackEntry, resolveRowRouterId(fallbackEntry));
      if (!assigningKey || fallbackKey === assigningKey) return fallbackEntry;
    }
    return null;
  };

  const openAssignModal = (indexOrKey) => {
    if (!assignModal) return;
    const index = typeof indexOrKey === 'string'
      ? findAccountIndexByIdentityKey(indexOrKey)
      : indexOrKey;
    if (!Number.isInteger(index) || index < 0 || index >= state.accounts.length) return;
    const entry = state.accounts[index];
    const usernameValue = String(entry?.username || '');
    const passwordValue = String(entry?.password || '').trim();
    assigningIndex = index;
    assigningKey = getAccountIdentityKey(entry, resolveRowRouterId(entry));
    if (assignTitle) {
      const username = usernameValue.trim() || 'PPPoE Entry';
      assignTitle.textContent = `Assign PPPoE: ${username}`;
    }
    if (assignUsernameInput) {
      assignUsernameInput.value = usernameValue;
      assignUsernameInput.dataset.copyValue = usernameValue;
    }
    if (assignPasswordInput) {
      assignPasswordInput.value = passwordValue;
      assignPasswordInput.dataset.copyValue = passwordValue;
    }
    if (assignProfileInput) assignProfileInput.value = String(entry?.profile || '');
    const mappedAccount = getAssignedCustomerAccountForEntry(entry);
    populateAssignCustomerOptions(mappedAccount);
    if (assignUnassign) {
      assignUnassign.disabled = !mappedAccount;
      assignUnassign.title = mappedAccount ? '' : 'No assigned customer for this PPPoE entry';
    }
    assignModal.classList.add('active');
    assignModal.setAttribute('aria-hidden', 'false');
    assignCustomerSearchInput?.focus();
  };

  const closeAssignModal = () => {
    if (!assignModal) return;
    assignModal.classList.remove('active');
    assignModal.setAttribute('aria-hidden', 'true');
    if (assignForm) assignForm.reset();
    if (assignCustomerSearchInput) assignCustomerSearchInput.value = '';
    setCustomerSelectOption(assignCustomerSelect);
    hideAssignCustomerResults();
    if (assignUsernameInput) {
      assignUsernameInput.dataset.copyValue = '';
    }
    if (assignPasswordInput) {
      assignPasswordInput.dataset.copyValue = '';
    }
    assigningIndex = -1;
    assigningKey = '';
  };

  const handleAssignSubmit = async (event) => {
    event.preventDefault();
    const entry = getCurrentAssignEntry();
    if (!entry) {
      closeAssignModal();
      showToast('Selected PPPoE entry is no longer available. Please open the assign modal again.', 'error');
      return;
    }
    syncAssignCustomerFromSearch({ allowSingleMatch: true });
    const selectedAccount = String(assignCustomerSelect?.value || '').trim();
    if (!selectedAccount) {
      showToast('Select a customer to assign.', 'error');
      return;
    }
    const customer = findCustomerByAccount(selectedAccount);
    if (!customer) {
      showToast('Customer not found.', 'error');
      return;
    }
    if (!String(entry?.username || '').trim()) {
      showToast('Selected PPPoE entry has no username.', 'error');
      return;
    }

    const currentlyAssignedAccount = getAssignedCustomerAccountForEntry(entry);
    if (currentlyAssignedAccount === selectedAccount) {
      showToast('This PPPoE is already assigned to the selected customer.', 'info');
      return;
    }

    const originalLabel = assignSave ? assignSave.innerHTML : '';
    if (assignSave) {
      assignSave.disabled = true;
      assignSave.innerHTML = '<i class="ti ti-loader-2 pppoe-spin" aria-hidden="true"></i> Assigning...';
    }
    if (assignUnassign) {
      assignUnassign.disabled = true;
    }
    try {
      if (currentlyAssignedAccount && currentlyAssignedAccount !== selectedAccount) {
        await unlinkPppoeFromCustomer(currentlyAssignedAccount);
      }
      await linkGeneratedToCustomer(selectedAccount, entry, customer);
      const updatedEntry = {
        ...entry,
        customerAccount: selectedAccount,
        pairedCustomer: customerLabel(customer),
        pairedPppoe: ''
      };
      const nextAccounts = applyCustomerAssignmentToAccounts(state.accounts, selectedAccount, updatedEntry, customer);
      setStateAccounts(nextAccounts);
      await persist();
      renderTable();
      showToast('PPPoE assigned to customer.', 'success');
      closeAssignModal();
      await loadCustomers();
    } catch (err) {
      showToast(err.message || 'Failed to assign PPPoE', 'error');
    } finally {
      if (assignSave) {
        assignSave.disabled = false;
        assignSave.innerHTML = originalLabel;
      }
      if (assignUnassign) {
        const mappedAccount = getAssignedCustomerAccountForEntry(entry);
        assignUnassign.disabled = !mappedAccount;
      }
    }
  };

  const handleUnassignSubmit = async () => {
    const entry = getCurrentAssignEntry();
    if (!entry) {
      closeAssignModal();
      showToast('Selected PPPoE entry is no longer available. Please open the assign modal again.', 'error');
      return;
    }
    const assignedAccount = getAssignedCustomerAccountForEntry(entry);
    if (!assignedAccount) {
      showToast('No customer is currently assigned to this PPPoE entry.', 'info');
      return;
    }

    const originalLabel = assignUnassign ? assignUnassign.innerHTML : '';
    if (assignUnassign) {
      assignUnassign.disabled = true;
      assignUnassign.innerHTML = '<i class="ti ti-loader-2 pppoe-spin" aria-hidden="true"></i> Unassigning...';
    }
    if (assignSave) assignSave.disabled = true;
    try {
      await unlinkPppoeFromCustomer(assignedAccount);
      state.accounts[assigningIndex] = {
        ...entry,
        customerAccount: '',
        pairedCustomer: ''
      };
      setStateAccounts(state.accounts);
      await persist();
      renderTable();
      showToast('PPPoE unassigned.', 'success');
      closeAssignModal();
      await loadCustomers();
    } catch (err) {
      showToast(err.message || 'Failed to unassign PPPoE', 'error');
      if (assignSave) assignSave.disabled = false;
      if (assignUnassign) {
        assignUnassign.disabled = false;
        assignUnassign.innerHTML = originalLabel;
      }
      return;
    }
    if (assignSave) assignSave.disabled = false;
    if (assignUnassign) {
      assignUnassign.disabled = false;
      assignUnassign.innerHTML = originalLabel;
    }
  };

  const resolveCustomerInfo = (row) => {
    const explicitAccount = String(row?.customerAccount || '').trim();
    const explicitCustomer = explicitAccount ? customerByAccount.get(explicitAccount) : null;
    const usernameKey = String(row?.username || '').trim().toLowerCase();
    const routerKey = resolveRowRouterId(row);
    const lookupKey = `${routerKey}::${usernameKey}`;
    const mapped = usernameKey ? customerLookupByUsername.get(lookupKey) : null;
    const rowLabelParts = splitCustomerLabel(row?.pairedCustomer);
    const mappedLabelParts = splitCustomerLabel(mapped?.label);
    const name =
      rowLabelParts.name ||
      customerDisplayName(explicitCustomer) ||
      mapped?.name ||
      mappedLabelParts.name ||
      String(row?.pairedCustomer || '').trim() ||
      String(mapped?.label || '').trim();
    const account = explicitAccount || rowLabelParts.account || mapped?.accountNumber || mappedLabelParts.account || '';
    const meta = account || mapped?.meta || '';
    const label = [name, account, mapped?.meta].filter(Boolean).join(' ');
    const hasAssignment = Boolean(name || account || mapped?.meta);
    return { label, name, account, meta, hasAssignment };
  };

  const hydrateCustomerLookup = (customers = []) => {
    const nextMap = new Map();
    customers.forEach((c) => {
      const uname = String(c?.pppoeUsername || '').trim().toLowerCase();
      if (!uname) return;
      const routerId = normalizeRouterId(c?.mikrotikId || c?.routerId) || routerState.defaultId || '';
      const label = customerLabel(c);
      const name = customerDisplayName(c) || String(c?.accountNumber || '').trim();
      const accountNumber = String(c?.accountNumber || '').trim();
      const meta = accountNumber || '';
      const key = `${routerId}::${uname}`;
      if (label && !nextMap.has(key)) nextMap.set(key, { label, name, meta, accountNumber });
    });
    customerLookupByUsername = nextMap;
  };

  const loadCoverageAreaRouterMap = async () => {
    try {
      const res = await fetch('/api/coverage', { cache: 'no-store', credentials: 'include' });
      const data = await res.json().catch(() => ([]));
      const coverageAreas = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      const nextMap = new Map();
      coverageAreas.forEach((area) => {
        const areaKey = normalizeCoverageAreaKey(area?.name || area?.areaName);
        const routerId = normalizeRouterId(area?.mikrotikId || area?.routerId);
        if (areaKey && routerId) {
          nextMap.set(areaKey, routerId);
        }
      });
      coverageAreaRouterMap = nextMap;
      populateGenerateCustomerOptions();
      syncGeneratePreview();
      return nextMap;
    } catch (err) {
      coverageAreaRouterMap = new Map();
      console.warn('Failed to load coverage area router links:', err?.message || err);
      populateGenerateCustomerOptions();
      syncGeneratePreview();
      return coverageAreaRouterMap;
    }
  };

  const loadCustomers = async () => {
    try {
      const res = await fetch('/api/customers', { cache: 'no-store', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      const customers = Array.isArray(data) ? data : Array.isArray(data?.customers) ? data.customers : [];
      customerRecords = customers;
      customerByAccount = new Map(
        customers
          .map((customer) => [String(customer?.accountNumber || '').trim(), customer])
          .filter(([accountNumber]) => Boolean(accountNumber))
      );
      hydrateCustomerLookup(customers);
      populateGenerateCustomerOptions();
      populateAssignCustomerOptions();
      syncGeneratePreview();
      renderTable();
    } catch (err) {
      customerRecords = [];
      customerByAccount = new Map();
      customerLookupByUsername = new Map();
      populateGenerateCustomerOptions();
      populateAssignCustomerOptions();
      syncGeneratePreview();
      console.warn('Failed to load customers for PPPoE pairing:', err?.message || err);
    }
  };

  const getRouterScopedRows = () => {
    const currentRouterId = resolveActiveRouterId();
    return state.accounts.filter((row) => {
      const rowRouterId = normalizeRouterId(row?.routerId) || routerState.defaultId || '';
      return !currentRouterId || rowRouterId === currentRouterId;
    });
  };

  const getFilteredRows = () => {
    const search = filters.search.trim().toLowerCase();
    const statusFilter = String(filters.status || 'all').toLowerCase();
    const assignmentFilter = String(filters.assignment || 'all').toLowerCase();
    const sourceRows = statusFilter === 'online'
      ? getRouterScopedRows()
      : getPersistentRouterScopedRows();
    return sourceRows.filter((row) => {
      const rowStatus = String(row.status || '').toLowerCase();
      const customerInfo = resolveCustomerInfo(row);
      const isAssigned = Boolean(customerInfo.hasAssignment);
      const routerDisabled = readRouterDisabledFlag(row);
      const routerInfo = resolveRouterInfo(resolveRowRouterId(row));
      const callerId = resolveCallerIdValue(row);
      const macAddress = formatMacAddress(callerId);
      const searchBlob = [
        row.username,
        row.profile,
        rowStatus,
        row.pairedCustomer,
        customerInfo.label,
        customerInfo.name,
        customerInfo.account,
        customerInfo.meta,
        callerId,
        macAddress,
        routerInfo.label,
        routerInfo.address
      ].join(' ').toLowerCase();
      const matchesSearch = !search || searchBlob.includes(search);
      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'disabled'
            ? routerDisabled
            : rowStatus === statusFilter && !routerDisabled;
      const matchesAssignment =
        assignmentFilter === 'all'
          ? true
          : assignmentFilter === 'assigned'
            ? isAssigned
            : assignmentFilter === 'unassigned'
              ? !isAssigned
              : true;
      return matchesSearch && matchesStatus && matchesAssignment;
    });
  };

  const getPersistentRouterScopedRows = () =>
    getRouterScopedRows().filter((row) => !row?.isLiveOnly);

  const updateSummaryCards = () => {
    const scoped = getPersistentRouterScopedRows();
    let fallbackOnline = 0;
    let fallbackOffline = 0;
    let fallbackDisabled = 0;
    let totalUsageBytes = 0;
    scoped.forEach((row) => {
      const rowStatus = String(row.status || '').toLowerCase();
      const routerDisabled = readRouterDisabledFlag(row);
      if (routerDisabled) {
        fallbackDisabled += 1;
      } else if (rowStatus === 'online' || rowStatus === 'active') {
        fallbackOnline += Math.max(Math.trunc(Number(row.activeSessionCount ?? row.sessionCount ?? 1)) || 1, 1);
      } else {
        fallbackOffline += 1;
      }
      totalUsageBytes += getUsageBytes(row);
    });
    const runtime = getRouterRuntime(resolveActiveRouterId());
    const liveInfo = runtime?.connected && runtime?.hasConfirmedOnlineStatus ? (runtime.info || {}) : {};
    const toCount = (value, fallback) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
    };
    const total = toCount(liveInfo.totalCount, scoped.length);
    const online = Math.max(Math.trunc(Number(
      toCount(
        liveInfo.activeSessionCount ?? liveInfo.activeCount ?? liveInfo.uniqueActiveCount ?? liveInfo.activeSecretCount,
        fallbackOnline
      )
    ) || 0), 0);
    const disabled = Math.max(Math.trunc(Number(toCount(liveInfo.disabledCount, fallbackDisabled)) || 0), 0);
    const offline = Math.max(Math.trunc(Number(toCount(liveInfo.offlineCount, fallbackOffline)) || 0), 0);
    if (pppoeSummaryTotal) pppoeSummaryTotal.textContent = String(total);
    if (pppoeSummaryOnline) pppoeSummaryOnline.textContent = String(online);
    if (pppoeSummaryOffline) pppoeSummaryOffline.textContent = String(offline);
    if (pppoeSummaryDisabled) pppoeSummaryDisabled.textContent = String(disabled);
    if (pppoeSummaryUsage) pppoeSummaryUsage.textContent = formatUsageFromBytes(totalUsageBytes);
  };

  const updateTableFooter = ({ total, start, end, pageCount }) => {
    const footerLabel = document.getElementById('pppoe-count-label');
    const footerPage = document.getElementById('pppoe-page-indicator');
    const prevBtn = document.getElementById('pppoe-prev');
    const nextBtn = document.getElementById('pppoe-next');
    const displayStart = total ? start + 1 : 0;
    const displayEnd = total ? Math.min(end, total) : 0;
    if (footerLabel) {
      footerLabel.textContent = total
        ? `Showing ${displayStart}-${displayEnd} of ${total} PPPoE entries`
        : 'Showing 0 of 0 PPPoE entries';
    }
    if (footerPage) footerPage.textContent = `Page ${page} of ${pageCount}`;
    if (prevBtn) prevBtn.disabled = page <= 1 || total === 0;
    if (nextBtn) nextBtn.disabled = page >= pageCount || total === 0;
  };

  const renderTable = () => {
    if (!pppoeTableBody) return;
    updateSummaryCards();
    const rows = getFilteredRows();
    const numericLimit = Number(filters.pageSize);
    const applyLimit = Number.isFinite(numericLimit) && numericLimit > 0;
    const total = rows.length;
    const pageCount = applyLimit ? Math.max(Math.ceil(total / numericLimit), 1) : 1;
    const safePage = applyLimit ? Math.min(Math.max(page, 1), pageCount) : 1;
    page = safePage;
    const start = applyLimit ? (safePage - 1) * numericLimit : 0;
    const end = applyLimit ? start + numericLimit : rows.length;
    const sliced = rows.slice(start, end);
    const maxUsageBytes = rows.reduce((max, row) => Math.max(max, getUsageBytes(row)), 0);

    if (!sliced.length) {
      pppoeTableBody.innerHTML = '<tr><td colspan="8" class="text-center text-secondary py-4">No PPPoE entries yet.</td></tr>';
      updateTableFooter({ total, start, end, pageCount });
      return;
    }

    pppoeTableBody.innerHTML = sliced
      .map((row, idx) => {
        const isLiveOnly = Boolean(row?.isLiveOnly);
        const normalizedStatus = normalizePppoeUsageStatus(row?.status);
        const isDisabled = readRouterDisabledFlag(row);
        const stateIndex = state.accounts.indexOf(row);
        const globalIndex = stateIndex >= 0 ? stateIndex : start + idx;
        const customerInfo = resolveCustomerInfo(row);
        const customerName = customerInfo.name || '';
        const customerInitials = customerInfo.hasAssignment
          ? customerName
              .split(/[\s-]+/)
              .map((part) => part.charAt(0))
              .join('')
              .slice(0, 2)
              .toUpperCase()
          : '';
        const username = String(row?.username || '').trim();
        const rowRouterId = resolveRowRouterId(row);
        const rowKey = getAccountIdentityKey(row, rowRouterId);
        const activeAddress = resolvePppoeAddressValue(row);
        const activeAddressCell = activeAddress
          ? `<button type="button" class="btn btn-link btn-sm p-0 pppoe-ip-browser-link" data-browser-player-ip data-browser-player-source="${escapeHtml(activeAddress)}">${escapeHtml(activeAddress)}</button>`
          : '<span class="pppoe-subtext"></span>';
        const usageBytes = getUsageBytes(row);
        const usage = formatUsageFromBytes(usageBytes);
        const usagePercent = maxUsageBytes > 0 ? Math.min((usageBytes / maxUsageBytes) * 100, 100) : 0;
        const lastSeen = isDisabled
          ? { label: 'Disabled', meta: '', className: 'last-seen-cell last-seen-cell--disabled' }
          : getLastSeenInfo(row);
        const rowStatusClass = isDisabled
          ? 'disabled'
          : isPppoeOnlineStatus(normalizedStatus)
            ? 'online'
            : 'offline';
        return `
          <tr class="pppoe-row pppoe-row--${escapeHtml(rowStatusClass)}${isDisabled ? ' pppoe-row--disabled' : ''}" data-index="${globalIndex}" data-account-key="${escapeHtml(rowKey)}" data-username="${escapeHtml(row.username || '')}" data-router-id="${escapeHtml(rowRouterId)}" data-secret-id="${escapeHtml(normalizeSecretId(row.secretId))}">
            <td>${start + idx + 1}</td>
            <td title="${escapeHtml(customerName)}">
              ${customerInfo.hasAssignment ? `
              <div class="pppoe-customer">
                <div class="avatar avatar-sm bg-blue-lt text-blue pppoe-avatar">${escapeHtml(customerInitials || 'NA')}</div>
                <div class="pppoe-customer-meta">
                  <div class="pppoe-name">${escapeHtml(customerName)}</div>
                  <div class="pppoe-subtext">${escapeHtml(customerInfo.meta || '')}</div>
                </div>
              </div>
              ` : ''}
            </td>
            <td title="${escapeHtml(username || '')}">
              <span class="pppoe-name">${escapeHtml(username || '')}</span>
            </td>
            <td title="${escapeHtml(activeAddress)}">
              ${activeAddressCell}
            </td>
            <td title="${escapeHtml(row.profile || '')}">${escapeHtml(row.profile || '')}</td>
            <td>
              <span class="last-seen-stack">
                <span class="${escapeHtml(lastSeen.className)}">${escapeHtml(lastSeen.label)}</span>
                ${lastSeen.meta ? `<span class="last-seen-meta">${escapeHtml(lastSeen.meta)}</span>` : ''}
              </span>
            </td>
            <td>
              <div class="usage-cell">
                <span class="usage-cell__value">${escapeHtml(usage)}</span>
                <span class="usage-progress" role="progressbar" aria-label="Usage ${escapeHtml(usage)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${usagePercent.toFixed(1)}">
                  <span class="usage-progress__bar" style="width:${usagePercent.toFixed(1)}%"></span>
                </span>
              </div>
            </td>
            <td>
              ${isLiveOnly
                ? `<div class="table-actions">
                <button class="icon-btn btn btn-icon btn-sm btn-outline-secondary" type="button" data-pppoe-action="traffic" aria-label="Traffic for ${escapeHtml(row.username || 'entry')}"><i class="ti ti-chart-line" aria-hidden="true"></i></button>
                <button class="icon-btn btn btn-icon btn-sm btn-outline-secondary" type="button" data-pppoe-action="sessions" aria-label="Session history for ${escapeHtml(row.username || 'entry')}" title="Session history"><i class="ti ti-history" aria-hidden="true"></i></button>
              </div>
              <span class="pppoe-subtext">Live only</span>`
                : `<div class="table-actions">
                <button class="icon-btn btn btn-icon btn-sm btn-outline-secondary" type="button" data-pppoe-action="traffic" aria-label="Traffic for ${escapeHtml(row.username || 'entry')}"${isDisabled ? ' disabled title="Traffic unavailable for disabled PPPoE"' : ''}><i class="ti ti-chart-line" aria-hidden="true"></i></button>
                <button class="icon-btn btn btn-icon btn-sm btn-outline-secondary" type="button" data-pppoe-action="sessions" aria-label="Session history for ${escapeHtml(row.username || 'entry')}" title="Session history"><i class="ti ti-history" aria-hidden="true"></i></button>
                <button class="icon-btn btn btn-icon btn-sm btn-outline-secondary" type="button" data-pppoe-action="edit" aria-label="Edit ${escapeHtml(row.username || 'entry')}"><i class="ti ti-edit" aria-hidden="true"></i></button>
                <button class="icon-btn btn btn-icon btn-sm btn-outline-danger" type="button" data-pppoe-action="delete" aria-label="Delete ${escapeHtml(row.username || 'entry')}"><i class="ti ti-trash" aria-hidden="true"></i></button>
              </div>`}
            </td>
          </tr>
        `;
      })
      .join('');

    window.AccountViewShared?.syncBrowserPlayerTriggers?.(pppoeTableBody);
    updateTableFooter({ total, start, end, pageCount });
  };

  const persist = async () => {
    const fallbackRouterId = resolveActiveRouterId() || routerState.defaultId || '';
    const normalizedAccounts = dedupePppoeAccounts(state.accounts.filter((acc) => !acc?.isLiveOnly).map((acc) => {
      if (acc?.routerId || !fallbackRouterId) return acc;
      return { ...acc, routerId: fallbackRouterId };
    }));
    state.accounts = normalizedAccounts.slice();
    const res = await fetch('/api/integrations/pppoe', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts: normalizedAccounts })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Save failed');
    return data;
  };

  const scheduleUsagePersist = () => {
    if (usagePersistTimer) clearTimeout(usagePersistTimer);
    usagePersistTimer = setTimeout(() => {
      persist().catch((err) => {
        console.warn('Failed to persist cumulative PPPoE usage:', err?.message || err);
      });
    }, 1200);
  };

  const load = async ({ skipRender = false } = {}) => {
    try {
      const res = await fetch('/api/integrations', { credentials: 'include', cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load settings');
      const settings = data?.settings || {};
      syncRouterSelect(settings);
      const accounts = settings?.pppoe?.accounts;
      setStateAccounts(Array.isArray(accounts) ? accounts.slice() : []);
      if (routerState.defaultId) {
        setStateAccounts(state.accounts.map((acc) => {
          if (acc?.routerId) return acc;
          return { ...acc, routerId: routerState.defaultId };
        }));
      }
      if (!skipRender) renderTable();
      return settings || null;
    } catch (err) {
      showToast(err.message || 'Load failed', 'error');
      return null;
    }
  };

  const renderInfo = (info, address) => {
    const safe = (v) => (v == null || v === '' ? '-' : v);
    const countsFromState = () => {
      const scoped = getPersistentRouterScopedRows();
      const active = scoped.reduce((sum, row) => {
        const normalized = String(row.status || '').toLowerCase();
        if (normalized !== 'online' && normalized !== 'active') return sum;
        return sum + 1;
      }, 0);
      const offline = scoped.filter((row) => String(row.status || '').toLowerCase() === 'offline').length;
      return { active, offline };
    };
    const fallbackCounts = countsFromState();
    const activeCount = info?.activeSessionCount ?? info?.activeCount ?? fallbackCounts.active;
    const offlineCount = info?.offlineCount ?? fallbackCounts.offline;
    const cpuLoadRaw = Number.parseFloat(String(info?.cpuLoad ?? ''));
    const cpuLoadPercent = Number.isFinite(cpuLoadRaw) ? cpuLoadRaw : null;
    const freeMemoryBytes = parseMetric(info?.freeMemory);
    const totalMemoryBytes = parseMetric(info?.totalMemory);
    const ramUsagePercent =
      Number.isFinite(freeMemoryBytes) &&
      Number.isFinite(totalMemoryBytes) &&
      totalMemoryBytes > 0
        ? ((totalMemoryBytes - freeMemoryBytes) / totalMemoryBytes) * 100
        : null;
    lastInfo = info || lastInfo;
    lastAddress = address || lastAddress;
    if (mtIdentity) mtIdentity.textContent = safe(info?.identity || info?.name);
    if (mtAddress) mtAddress.textContent = safe(address);
    if (mtCpu) mtCpu.textContent = cpuLoadPercent != null ? `${cpuLoadPercent.toFixed(0)}%` : safe(info?.cpuLoad);
    if (mtUptime) mtUptime.textContent = safe(info?.uptime);
    if (mtFreeMem) mtFreeMem.textContent = formatBytesGb(info?.freeMemory);
    if (mtTotalMem) mtTotalMem.textContent = formatBytesGb(info?.totalMemory);
    if (mtBoard) mtBoard.textContent = safe(info?.boardName);
    if (mtVersion) mtVersion.textContent = safe(info?.version);
    setUsageIndicator(mtCpuIndicator, mtCpuIndicatorBar, cpuLoadPercent);
    setUsageIndicator(mtRamIndicator, mtRamIndicatorBar, ramUsagePercent);
  };

  const loadMikrotikInfo = async (silent = false, requestedRouterId = resolveActiveRouterId()) => {
    const routerId = resolveRuntimeRouterId(requestedRouterId) || resolveActiveRouterId();
    try {
      const query = routerId ? `?routerId=${encodeURIComponent(routerId)}` : '';
      const res = await fetch(`/api/mikrotik/info${query}`, { credentials: 'include', cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Unable to fetch MikroTik info');
      if (routerId === resolveActiveRouterId()) {
        renderInfo(data.info, data.address);
      }
      setConnectionStatus({ routerId, connected: true, info: data.info, address: data.address });
    } catch (err) {
      if (isPageTransitioning()) return;
      if (routerId === resolveActiveRouterId()) {
        renderInfo(null);
      }
      setConnectionStatus({ routerId, connected: false, reason: err.message });
      if (!silent && routerId === resolveActiveRouterId()) {
        showToast(err.message || 'MikroTik info unavailable', 'error');
      }
    }
  };

  const loadAllMikrotikInfo = async (silent = false) => {
    const routerIds = getAllRouterIds();
    const targets = routerIds.length ? routerIds : [resolveActiveRouterId()].filter(Boolean);
    for (const routerId of targets) {
      await loadMikrotikInfo(silent, routerId);
    }
  };

  const startInfoRefresh = () => {
    // Only use the slower info refresh when live status is not available
    if (liveStatusSupported) return;
    if (infoRefreshId) return;
    infoRefreshId = setInterval(() => loadAllMikrotikInfo(true), INFO_REFRESH_INTERVAL_MS);
  };

  const startAutoSync = () => {
    // Only run the heavier full sync when live status is not available
    if (liveStatusSupported) {
      stopAutoSync();
      return;
    }
    if (autoSyncId || !getAllRouterIds().length) return;
    autoSyncId = setInterval(() => {
      syncFromMikrotik({ silent: true, background: true, allRouters: true });
    }, AUTO_SYNC_INTERVAL_MS);
  };

  const stopAutoSync = () => {
    if (!autoSyncId) return;
    clearInterval(autoSyncId);
    autoSyncId = null;
  };

  const applyLiveStatus = (routerId, activeList, infoPayload, address) => {
    const currentRouterId = resolveRuntimeRouterId(routerId);
    const rawActiveList = Array.isArray(activeList) ? activeList : [];
    const activeMap = new Map();
    const claimedActiveUsers = new Set();
    const nowIso = new Date().toISOString();
    let usageRolledOver = false;
    rawActiveList.forEach((item, index) => {
      const username = String(item.username || item.name || item.user || '').trim();
      if (!username) return;
      const usernameKey = normalizePppoeUsernameKey(username);
      if (!activeMap.has(usernameKey)) {
        activeMap.set(usernameKey, []);
      }
      activeMap.get(usernameKey).push({
        ...item,
        username,
        liveSessionKey:
          String(item?.liveSessionKey || item?.sessionId || item?.id || item?.['.id'] || '').trim()
          || `${usernameKey}:${String(item?.callerId || item?.['caller-id'] || '').trim()}:${String(item?.address || item?.['remote-address'] || '').trim()}:${index}`
      });
    });
    const rawActiveSessionCount = rawActiveList.length;
    const uniqueActiveUserCount = activeMap.size;
    const currentRouterRows = state.accounts.filter((acc) => {
      const accRouterId = normalizeRouterId(acc?.routerId) || routerState.defaultId || '';
      return !currentRouterId || accRouterId === currentRouterId;
    });
    const otherRouterRows = state.accounts.filter((acc) => {
      const accRouterId = normalizeRouterId(acc?.routerId) || routerState.defaultId || '';
      return currentRouterId && accRouterId !== currentRouterId;
    });
    const persistentRouterRows = currentRouterRows.filter((acc) => !acc?.isLiveOnly);
    const templateByUser = new Map();
    persistentRouterRows.forEach((acc) => {
      const usernameKey = normalizePppoeUsernameKey(acc?.username);
      if (usernameKey && !templateByUser.has(usernameKey)) {
        templateByUser.set(usernameKey, acc);
      }
    });
    const buildLiveOnlyRow = (active, usernameKey, fallbackIndex = 0) => {
      const username = String(active?.username || active?.name || active?.user || '').trim();
      if (!username) return null;
      const template = templateByUser.get(usernameKey) || null;
      const liveSessionIdentity =
        String(active?.liveSessionKey || active?.sessionId || active?.id || active?.['.id'] || '').trim()
        || `${usernameKey}:${fallbackIndex}`;
      return {
        username,
        password: '',
        profile: String(active?.profile || template?.profile || '').trim(),
        pairedCustomer: String(template?.pairedCustomer || '').trim(),
        pairedPppoe: String(template?.pairedPppoe || '').trim(),
        customerAccount: String(template?.customerAccount || template?.accountNumber || '').trim(),
        status: 'online',
        inactiveSince: '',
        sessionUptime: active?.uptime || active?.['session-uptime'] || '',
        interfaceName: active?.interfaceName || active?.interface || '',
        activeAddress: active?.address || active?.['remote-address'] || '',
        callerId: active?.callerId || active?.['caller-id'] || '',
        sessionRxBytes: active?.rxBytes ?? 0,
        sessionTxBytes: active?.txBytes ?? 0,
        sessionTotalBytes: active?.totalBytes ?? (active?.rxBytes ?? 0) + (active?.txBytes ?? 0),
        sessionRxPackets: active?.rxPackets ?? 0,
        sessionTxPackets: active?.txPackets ?? 0,
        sessionTotalPackets: active?.totalPackets ?? (active?.rxPackets ?? 0) + (active?.txPackets ?? 0),
        liveRxBytesPerSecond: active?.liveRxBytesPerSecond,
        liveTxBytesPerSecond: active?.liveTxBytesPerSecond,
        liveRxPacketsPerSecond: active?.liveRxPacketsPerSecond,
        liveTxPacketsPerSecond: active?.liveTxPacketsPerSecond,
        activeSessionCount: 1,
        routerId: currentRouterId,
        secretId: `live-session:${currentRouterId || 'default'}:${liveSessionIdentity}`,
        liveSessionKey: liveSessionIdentity,
        isLiveOnly: true
      };
    };
    const nextRouterRows = persistentRouterRows.map((acc) => {
      const username = String(acc.username || '').trim();
      const active = username ? claimActiveSessionForUsername(activeMap, claimedActiveUsers, username) : null;
      const statusRaw = String(acc.status || '').toLowerCase();
      const isDisabled = statusRaw === 'disabled' || statusRaw === 'inactive';
      if (active) {
        const merged = mergePppoeUsageState(acc, {
          ...acc,
          status: 'online',
          inactiveSince: '',
          sessionUptime: active.uptime || active['session-uptime'] || '',
          interfaceName: active.interfaceName || active.interface || acc.interfaceName || '',
          activeAddress: active.address || active['remote-address'] || '',
          callerId: active.callerId || active['caller-id'] || acc.callerId || '',
          sessionRxBytes: active.rxBytes ?? 0,
          sessionTxBytes: active.txBytes ?? 0,
          sessionTotalBytes: active.totalBytes ?? (active.rxBytes ?? 0) + (active.txBytes ?? 0),
          sessionRxPackets: active.rxPackets ?? 0,
          sessionTxPackets: active.txPackets ?? 0,
          sessionTotalPackets: active.totalPackets ?? (active.rxPackets ?? 0) + (active.txPackets ?? 0),
          liveRxBytesPerSecond: active.liveRxBytesPerSecond,
          liveTxBytesPerSecond: active.liveTxBytesPerSecond,
          liveRxPacketsPerSecond: active.liveRxPacketsPerSecond,
          liveTxPacketsPerSecond: active.liveTxPacketsPerSecond,
          activeSessionCount: Number(active.sessionCount || 1)
        });
        if (merged.rolledOver) usageRolledOver = true;
        return merged.account;
      }
      if (isDisabled) {
        const disabledSince = acc.inactiveSince || ((statusRaw === 'online' || statusRaw === 'active') ? nowIso : '');
        const merged = mergePppoeUsageState(acc, {
          ...acc,
          status: 'disabled',
          inactiveSince: disabledSince,
          sessionUptime: '',
          activeAddress: '',
          sessionRxBytes: acc.sessionRxBytes ?? 0,
          sessionTxBytes: acc.sessionTxBytes ?? 0,
          sessionTotalBytes: acc.sessionTotalBytes ?? 0,
          sessionRxPackets: acc.sessionRxPackets ?? 0,
          sessionTxPackets: acc.sessionTxPackets ?? 0,
          sessionTotalPackets: acc.sessionTotalPackets ?? 0,
          activeSessionCount: 0
        });
        if (merged.rolledOver) usageRolledOver = true;
        return merged.account;
      }
      const wentOffline = statusRaw !== 'offline';
      const merged = mergePppoeUsageState(acc, {
        ...acc,
        status: 'offline',
        inactiveSince: wentOffline ? (acc.inactiveSince || nowIso) : (acc.inactiveSince || ''),
        sessionUptime: '',
        activeAddress: '',
        sessionRxBytes: acc.sessionRxBytes ?? 0,
        sessionTxBytes: acc.sessionTxBytes ?? 0,
        sessionTotalBytes: acc.sessionTotalBytes ?? 0,
        sessionRxPackets: acc.sessionRxPackets ?? 0,
        sessionTxPackets: acc.sessionTxPackets ?? 0,
        sessionTotalPackets: acc.sessionTotalPackets ?? 0,
        activeSessionCount: 0
      });
      if (merged.rolledOver) usageRolledOver = true;
      return merged.account;
    });
    activeMap.forEach((bucket, usernameKey) => {
      (Array.isArray(bucket) ? bucket : [bucket]).forEach((active, bucketIndex) => {
        const liveOnlyRow = buildLiveOnlyRow(active, usernameKey, bucketIndex);
        if (liveOnlyRow) nextRouterRows.push(liveOnlyRow);
      });
    });
    setStateAccounts([...otherRouterRows, ...nextRouterRows]);
    const offlineCount = Number.isFinite(Number(infoPayload?.offlineCount))
      ? Number(infoPayload.offlineCount)
      : state.accounts.filter((acc) => {
          const accRouterId = normalizeRouterId(acc?.routerId) || routerState.defaultId || '';
          if (currentRouterId && accRouterId !== currentRouterId) return false;
          return String(acc.status || '').toLowerCase() === 'offline';
        }).length;
    if (usageRolledOver) scheduleUsagePersist();
    setConnectionStatus({ routerId: currentRouterId, connected: true, info: infoPayload, address });
    if (currentRouterId === resolveActiveRouterId()) {
      renderTable();
      renderInfo({
        ...(infoPayload || {}),
        activeCount: infoPayload?.activeCount ?? uniqueActiveUserCount,
        uniqueActiveCount: infoPayload?.uniqueActiveCount ?? uniqueActiveUserCount,
        activeSessionCount: infoPayload?.activeSessionCount ?? rawActiveSessionCount ?? uniqueActiveUserCount,
        offlineCount
      }, address);
    }
  };

  const fetchRouterLiveStatus = async (routerId) => {
    try {
      const query = routerId ? `?routerId=${encodeURIComponent(routerId)}` : '';
      const res = await fetch(`/api/mikrotik/pppoe/active${query}`, { credentials: 'include', cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      return { routerId, ok: res.ok, status: res.status, data };
    } catch (error) {
      return { routerId, ok: false, status: 0, error };
    }
  };

  const fetchDirectTrafficStatus = async (row) => {
    const username = String(row?.username || '').trim();
    if (!username) return null;
    const params = new URLSearchParams({ username });
    const routerId = resolveRowRouterId(row);
    if (routerId) params.set('routerId', routerId);
    const sessionId = String(row?.sessionId || row?.liveSessionKey || '').trim();
    if (sessionId) params.set('sessionId', sessionId);
    const res = await fetch(`/api/mikrotik/pppoe/traffic?${params.toString()}`, {
      credentials: 'include',
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  };

  const refreshDirectTrafficStatus = async () => {
    if (directTrafficInFlight || !trafficModal?.classList.contains('active')) return;
    const selectedKey = String(trafficState.selectedKey || '').trim();
    const index = findAccountIndexByIdentityKey(selectedKey);
    if (index < 0) return;
    const row = state.accounts[index];
    if (!row || !String(row.username || '').trim()) return;

    directTrafficInFlight = true;
    try {
      const result = await fetchDirectTrafficStatus(row);
      if (!result?.ok) return;
      const payload = result.data || {};
      const session = payload.session || {};
      const nextRow = payload.active
        ? {
            ...row,
            ...session,
            username: row.username || session.username || payload.username,
            routerId: normalizeRouterId(payload.routerId) || resolveRowRouterId(row),
            status: 'online',
            inactiveSince: '',
            sessionUptime: session.uptime || session.sessionUptime || row.sessionUptime || '',
            interfaceName: session.interfaceName || row.interfaceName || '',
            activeAddress: session.address || session.activeAddress || row.activeAddress || '',
            callerId: session.callerId || session['caller-id'] || row.callerId || '',
            sessionRxBytes: session.rxBytes ?? session.sessionRxBytes ?? row.sessionRxBytes ?? 0,
            sessionTxBytes: session.txBytes ?? session.sessionTxBytes ?? row.sessionTxBytes ?? 0,
            sessionTotalBytes: session.totalBytes ?? session.sessionTotalBytes ?? row.sessionTotalBytes ?? 0,
            sessionRxPackets: session.rxPackets ?? session.sessionRxPackets ?? row.sessionRxPackets ?? 0,
            sessionTxPackets: session.txPackets ?? session.sessionTxPackets ?? row.sessionTxPackets ?? 0,
            sessionTotalPackets: session.totalPackets ?? session.sessionTotalPackets ?? row.sessionTotalPackets ?? 0,
            liveRxBytesPerSecond: session.liveRxBytesPerSecond,
            liveTxBytesPerSecond: session.liveTxBytesPerSecond,
            liveRxPacketsPerSecond: session.liveRxPacketsPerSecond,
            liveTxPacketsPerSecond: session.liveTxPacketsPerSecond
          }
        : {
            ...row,
            status: readRouterDisabledFlag(row) ? 'disabled' : 'offline',
            liveRxBytesPerSecond: 0,
            liveTxBytesPerSecond: 0,
            liveRxPacketsPerSecond: 0,
            liveTxPacketsPerSecond: 0
          };
      const nextAccounts = state.accounts.slice();
      nextAccounts[index] = nextRow;
      setStateAccounts(nextAccounts);
    } catch (error) {
      console.warn('Direct PPPoE traffic refresh failed:', error?.message || error);
    } finally {
      directTrafficInFlight = false;
    }
  };

  const refreshLiveStatus = async () => {
    if (liveStatusInFlight || !liveStatusSupported) return;
    liveStatusInFlight = true;
    try {
      const routerIds = getAllRouterIds();
      const targets = routerIds.length ? routerIds : [resolveActiveRouterId()].filter(Boolean);
      const results = await Promise.all(targets.map((routerId) => fetchRouterLiveStatus(routerId)));
      if (results.some((result) => result.status === 404)) {
        liveStatusSupported = false;
        stopLiveStatus();
        if (!liveStatusErrorNotified) {
          liveStatusErrorNotified = true;
          console.warn('Live PPPoE endpoint not found; falling back to manual/30s sync.');
          showToast('Live PPPoE status not available on server. Using normal sync.', 'info');
        }
        // Ensure fallback timers are running
        startInfoRefresh();
        startAutoSync();
        return;
      }
      results.forEach((result) => {
        const scopedRouterId = resolveRuntimeRouterId(result.routerId);
        if (!result.ok) {
          setConnectionStatus({
            routerId: scopedRouterId,
            connected: false,
            reason: result.error?.message || result.data?.error || 'Unable to refresh PPPoE status'
          });
          return;
        }
        applyLiveStatus(
          scopedRouterId,
          Array.isArray(result.data.activeSessions)
            ? result.data.activeSessions
            : Array.isArray(result.data.active)
              ? result.data.active
              : [],
          result.data.info,
          result.data.address
        );
      });
      refreshDirectTrafficStatus();
    } catch (err) {
      if (isPageTransitioning()) return;
      setConnectionStatus({ routerId: resolveActiveRouterId(), connected: false, reason: err.message });
    } finally {
      liveStatusInFlight = false;
    }
  };

  const startLiveStatus = () => {
    if (liveStatusIntervalId || !liveStatusSupported) return;
    liveStatusIntervalId = setInterval(() => {
      refreshLiveStatus();
    }, LIVE_STATUS_INTERVAL_MS);
    refreshLiveStatus();
  };

  const stopLiveStatus = () => {
    if (!liveStatusIntervalId) return;
    clearInterval(liveStatusIntervalId);
    liveStatusIntervalId = null;
  };

  const saveToMikrotik = async (entry) => {
    const routerId = resolveRowRouterId(entry);
    const payload = { ...entry, routerId };
    const requestedProfile = String(payload.profile || '').trim();
    if (requestedProfile) {
      const availableProfiles = await ensureRouterProfilesLoaded(routerId);
      if (hasLoadedRouterProfiles(routerId) && !hasRouterProfile(routerId, requestedProfile, availableProfiles)) {
        throw new Error(buildRouterProfileMissingMessage(routerId, requestedProfile, availableProfiles));
      }
    }
    const res = await fetch('/api/mikrotik/pppoe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (Array.isArray(data?.availableProfiles)) {
        setRouterProfiles(routerId, data.availableProfiles);
      }
      const resolvedError = res.status === 400 && data?.profile
        ? buildRouterProfileMissingMessage(routerId, data.profile, data.availableProfiles)
        : (data?.error || data?.message || 'Failed to save to MikroTik');
      console.error('PPPoE save failed', {
        status: res.status,
        error: resolvedError,
        availableProfiles: data?.availableProfiles || [],
        payload
      });
      throw new Error(resolvedError);
    }
    const saved = data.entry || entry;
    return { ...saved, routerId: normalizeRouterId(saved?.routerId) || routerId };
  };

  let editingIndex = -1;
  let assigningIndex = -1;
  let assigningKey = '';

  const setEditPasswordVisibility = (visible) => {
    if (!editPassword) return;
    const show = Boolean(visible);
    editPassword.type = show ? 'text' : 'password';
    if (!editPasswordToggle) return;
    const icon = editPasswordToggle.querySelector('i');
    if (icon) {
      icon.classList.toggle('ti-eye', !show);
      icon.classList.toggle('ti-eye-off', show);
    }
    editPasswordToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    editPasswordToggle.title = show ? 'Hide password' : 'Show password';
  };

  const openEditModal = (idx) => {
    const current = state.accounts[idx];
    if (!current || !editModal) return;
    editingIndex = idx;
    populateEditProfileOptions(current);
    const currentRouterId = resolveRowRouterId(current);
    ensureRouterProfilesLoaded(currentRouterId).then(() => {
      if (editingIndex !== idx) return;
      const latestEntry = state.accounts[idx] || current;
      populateEditProfileOptions(latestEntry);
    }).catch(() => {});
    editUsername.value = current.username || '';
    editPassword.value = current.password || '';
    setEditPasswordVisibility(false);
    editModal.classList.add('active');
    editModal.setAttribute('aria-hidden', 'false');
  };

  const closeEditModal = () => {
    if (!editModal) return;
    editModal.classList.remove('active');
    editModal.setAttribute('aria-hidden', 'true');
    setEditPasswordVisibility(false);
    editingIndex = -1;
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (editingIndex < 0) {
      closeEditModal();
      return;
    }
    const current = state.accounts[editingIndex];
    if (!current) {
      closeEditModal();
      return;
    }
    const username = (editUsername.value || '').trim();
    const password = (editPassword.value || '').trim();
    const profile = (editProfile.value || '').trim();
    if (!username) {
      showToast('Username is required', 'error');
      return;
    }
    if (!password) {
      showToast('Password is required', 'error');
      return;
    }
    const usernameChanged = normalizePppoeUsernameKey(username) !== normalizePppoeUsernameKey(current?.username);
    if (usernameChanged) {
      const duplicate = dedupePppoeAccounts(state.accounts).some((entry, index) => {
        if (index === editingIndex) return false;
        if (resolveRowRouterId(entry) !== resolveRowRouterId(current)) return false;
        return normalizePppoeUsernameKey(entry?.username) === normalizePppoeUsernameKey(username);
      });
      if (duplicate) {
        showToast(`Username ${username} already exists on this router.`, 'error');
        return;
      }
    }
    const updated = {
      ...current,
      username,
      password,
      profile,
      routerId: resolveRowRouterId(current)
    };
    const saveBtn = document.getElementById('pppoe-edit-save');
    const originalLabel = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="ti ti-loader-2 pppoe-spin" aria-hidden="true"></i> Saving...';
    }
    try {
      const saved = await saveToMikrotik(updated);
      state.accounts[editingIndex] = saved;
      setStateAccounts(state.accounts);
      renderTable();
      await persist();
      showToast('PPPoE entry updated.', 'success');
      closeEditModal();
    } catch (err) {
      showToast(err.message || 'Update failed', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalLabel;
      }
    }
  };

  const syncRouterFromMikrotik = async (routerId) => {
    const res = await fetch('/api/mikrotik/pppoe/sync', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routerId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Sync failed');
    const synced = Array.isArray(data.accounts) ? data.accounts : [];
    setStateAccounts(mergeAccountsForRouter(state.accounts, routerId, synced));
    if (routerId === resolveActiveRouterId()) {
      renderInfo(data.info, data.address);
    }
    setConnectionStatus({ routerId, connected: true, info: data.info, address: data.address });
    return { synced, data };
  };

  const syncFromMikrotik = async ({ silent = false, background = false, allRouters = false } = {}) => {
    const originalLabel = pppoeSyncBtn ? pppoeSyncBtn.innerHTML : '';
    if (pppoeSyncBtn && !background && !allRouters) {
      pppoeSyncBtn.disabled = true;
      pppoeSyncBtn.innerHTML = '<i class="ti ti-loader-2 pppoe-spin" aria-hidden="true"></i> Syncing...';
    }
    const routerIds = allRouters ? getAllRouterIds() : [resolveActiveRouterId()].filter(Boolean);
    let syncedCount = 0;
    let lastError = null;
    try {
      for (const routerId of routerIds) {
        try {
          const { synced } = await syncRouterFromMikrotik(routerId);
          syncedCount += synced.length;
        } catch (err) {
          lastError = err;
          setConnectionStatus({ routerId, connected: false, reason: err.message });
          if (background) {
            console.warn(`Background PPPoE sync failed for router ${routerId}:`, err?.message || err);
          }
          if (!allRouters) throw err;
        }
      }
      renderTable();
      if (!silent) {
        const message = allRouters
          ? `Synced ${syncedCount} PPPoE entries from all MikroTik routers.`
          : `Synced ${syncedCount} PPPoE entries from MikroTik.`;
        showToast(message, 'success');
      }
      if (lastError && !syncedCount) throw lastError;
    } catch (err) {
      setConnectionStatus({ routerId: resolveActiveRouterId(), connected: false, reason: err.message });
      if (!silent) showToast(err.message || 'Sync failed', 'error');
    } finally {
      if (pppoeSyncBtn && !background && !allRouters) {
        pppoeSyncBtn.disabled = false;
        pppoeSyncBtn.innerHTML = originalLabel;
      }
    }
  };

  const handleGenerateSubmit = async (event) => {
    event.preventDefault();
    if (!mikrotikConnected || !hasConfirmedOnlineStatus) {
      showToast('Generate PPPoE is only available while OLT/MikroTik is online.', 'error');
      return;
    }
    syncGenerateCustomerFromSearch({ allowSingleMatch: true });
    const selectedAccount = String(generateCustomerSelect?.value || '').trim();
    if (!selectedAccount) {
      showToast('Select a customer first.', 'error');
      generateCustomerSearchInput?.focus();
      return;
    }
    const customer = findCustomerByAccount(selectedAccount);
    if (!customer) {
      showToast('Selected customer is no longer available.', 'error');
      return;
    }

    await loadCoverageAreaRouterMap().catch(() => {});
    const setupState = resolveGenerateSetupState(customer, resolveActiveRouterId());
    const routerId = setupState.targetRouterId;
    const generated = buildGeneratedCredentials(customer, routerId);
    if (!generated.username || !generated.password) {
      showToast('Unable to generate PPPoE credentials for this customer.', 'error');
      return;
    }

    if (generated.source === 'assigned' && generated.existingAssignment && generated.assignmentMatchesRouter) {
      const reuseEntry = generated.existingAssignment.row || {
        username: generated.existingAssignment.username,
        password: generated.existingAssignment.password,
        profile: generated.existingAssignment.profile || resolveSuggestedGenerateProfile(customer, generated.existingAssignment.routerId || resolveActiveRouterId()).profile,
        routerId: generated.existingAssignment.routerId || resolveActiveRouterId() || routerState.defaultId || '',
        customerAccount: selectedAccount,
        pairedCustomer: customerLabel(customer),
        pairedPppoe: '',
        status: 'offline'
      };
      const originalLabel = generateSaveBtn ? generateSaveBtn.innerHTML : '';
      if (generateSaveBtn) {
        generateSaveBtn.disabled = true;
        generateSaveBtn.innerHTML = '<i class="ti ti-loader-2 pppoe-spin" aria-hidden="true"></i> Reusing...';
      }

      try {
        await linkGeneratedToCustomer(selectedAccount, reuseEntry, customer);
        if (generated.existingAssignment?.row) {
          const nextAccounts = applyCustomerAssignmentToAccounts(state.accounts, selectedAccount, reuseEntry, customer);
          setStateAccounts(nextAccounts);
          renderTable();
          await persist();
        }
        syncGeneratePreview();
        showToast('Assigned PPPoE reused for this customer.', 'success');
        closeGenerateModal();
        loadCustomers();
      } catch (err) {
        showToast(err.message || 'Failed to reuse assigned PPPoE', 'error');
      } finally {
        if (generateSaveBtn) {
          generateSaveBtn.disabled = false;
          generateSaveBtn.innerHTML = originalLabel;
        }
      }
      return;
    }

    const existingUsername = state.accounts.find((entry) => {
      const sameRouter = resolveRowRouterId(entry) === routerId;
      return sameRouter && String(entry?.username || '').trim().toLowerCase() === generated.username.toLowerCase();
    });
    if (existingUsername) {
      const targetRouter = resolveRouterInfo(routerId);
      const targetRouterLabel = String(targetRouter?.label || targetRouter?.address || 'the selected router').trim() || 'the selected router';
      showToast(`Username ${generated.username} already exists on ${targetRouterLabel}.`, 'error');
      return;
    }

    const suggestedProfile = setupState.profileSuggestion;
    const fallbackProfile = String(generated.existingAssignment?.profile || '').trim();
    if (!suggestedProfile.profile && !fallbackProfile) {
      showToast(setupState.planSetupAction, 'error');
      return;
    }
    const profile = suggestedProfile.profile || fallbackProfile;
    const entry = {
      username: generated.username,
      password: generated.password,
      profile,
      pairedCustomer: '',
      pairedPppoe: '',
      status: 'offline',
      routerId
    };

    const originalLabel = generateSaveBtn ? generateSaveBtn.innerHTML : '';
    if (generateSaveBtn) {
      generateSaveBtn.disabled = true;
      generateSaveBtn.innerHTML = '<i class="ti ti-loader-2 pppoe-spin" aria-hidden="true"></i> Generating...';
    }

    try {
      const savedEntry = await saveToMikrotik(entry);
      const nextAccounts = [...state.accounts, savedEntry];
      setStateAccounts(nextAccounts);
      renderTable();
      await linkGeneratedToCustomer(selectedAccount, savedEntry, customer);
      const linkedEntry = {
        ...savedEntry,
        customerAccount: selectedAccount,
        pairedCustomer: customerLabel(customer),
        pairedPppoe: ''
      };
      const assignedAccounts = applyCustomerAssignmentToAccounts(nextAccounts, selectedAccount, linkedEntry, customer);
      setStateAccounts(assignedAccounts);
      if (routerId && normalizeRouterId(resolveActiveRouterId()) !== normalizeRouterId(routerId)) {
        const canSwitchRouter = !routerSelect
          || Array.from(routerSelect.options).some((option) => option.value === routerId);
        if (canSwitchRouter) {
          activeRouterId = routerId;
          if (routerSelect) {
            routerSelect.value = routerId;
            activeRouterId = routerSelect.value;
          }
          persistActiveRouterId(activeRouterId);
          renderActiveRouterSnapshot();
        }
      }
      renderTable();
      await persist();
      syncGeneratePreview();
      showToast('PPPoE generated and linked to customer.', 'success');
      closeGenerateModal();
      loadCustomers();
    } catch (err) {
      showToast(err.message || 'Failed to generate PPPoE', 'error');
    } finally {
      if (generateSaveBtn) {
        generateSaveBtn.disabled = false;
        generateSaveBtn.innerHTML = originalLabel;
      }
    }
  };

  pppoeAddBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    const formData = collectFormValues(pppoeForm);
    const validation = validate(formData);
    if (!validation.valid) {
      showToast(validation.message, 'error');
      return;
    }
    const entry = {
      username: formData.username || '',
      password: formData.password || '',
      profile: formData.profile || '',
      pairedCustomer: formData.pairedCustomer || '',
      pairedPppoe: formData.pairedPppoe || '',
      status: formData.status || 'active',
      routerId: resolveActiveRouterId()
    };
    try {
      const savedEntry = await saveToMikrotik(entry);
      setStateAccounts([...state.accounts, savedEntry]);
      renderTable();
      await persist();
      showToast('PPPoE entry added and saved to MikroTik.', 'success');
      pppoeForm?.reset();
    } catch (err) {
      showToast(err.message || 'Save failed', 'error');
    }
  });

  pppoeTableBody?.addEventListener('click', async (e) => {
    if (e.target.closest('[data-browser-player-ip]')) return;
    const row = e.target.closest('tr[data-index]');
    if (!row) return;
    const idxAttr = row ? Number(row.getAttribute('data-index')) : -1;
    const accountKeyAttr = row ? String(row.getAttribute('data-account-key') || '').trim() : '';
    const usernameAttr = row ? row.getAttribute('data-username') : '';
    const routerAttr = row ? row.getAttribute('data-router-id') : '';
    const secretIdAttr = row ? normalizeSecretId(row.getAttribute('data-secret-id')) : '';
    const idxFromKey = findAccountIndexByIdentityKey(accountKeyAttr);
    const idxFromAttributes = state.accounts.findIndex((acc) => {
      const accRouterId = resolveRowRouterId(acc);
      if (routerAttr && accRouterId !== routerAttr) return false;
      const accSecretId = normalizeSecretId(acc?.secretId || acc?.['.id']);
      if (secretIdAttr && accSecretId === secretIdAttr) return true;
      if (!usernameAttr) return false;
      return normalizePppoeUsernameKey(acc?.username || acc?.name || acc?.user) === normalizePppoeUsernameKey(usernameAttr);
    });
    const idx = idxFromKey >= 0
      ? idxFromKey
      : idxFromAttributes >= 0
        ? idxFromAttributes
        : (!accountKeyAttr && Number.isInteger(idxAttr) && idxAttr >= 0 ? idxAttr : -1);
    if (!Number.isInteger(idx) || idx < 0) return;
    const target = state.accounts[idx];
    if (!target) return;

    const btn = e.target.closest('[data-pppoe-action]');
    if (!btn) {
      if (target?.isLiveOnly) {
        showToast('This is a live session only. Run Sync from MikroTik to load the actual PPPoE secret.', 'info');
        return;
      }
      openAssignModal(idx);
      return;
    }
    const action = btn.getAttribute('data-pppoe-action');

    if (action === 'traffic') {
      openTrafficModal(idx);
      return;
    }

    if (action === 'sessions') {
      openSessionHistoryModal(idx);
      return;
    }

    if (target?.isLiveOnly) {
      showToast('This is a live session only. Run Sync from MikroTik to load the actual PPPoE secret.', 'info');
      return;
    }

    if (action === 'delete') {
      const confirmDelete = window.appConfirm
        ? await window.appConfirm('Delete this PPPoE entry from MikroTik?', { title: 'Delete PPPoE Entry' })
        : window.confirm('Delete this PPPoE entry from MikroTik?');
      if (!confirmDelete) return;
      const assignedAccount = getAssignedCustomerAccountForEntry(target);
      btn.disabled = true;
      try {
        const res = await fetch(`/api/mikrotik/pppoe`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secretId: target.secretId || '',
            username: target.username,
            password: target.password || '',
            profile: target.profile || '',
            delete: true,
            customerAccount: assignedAccount || '',
            routerId: resolveRowRouterId(target)
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Delete failed');
        state.accounts.splice(idx, 1);
        setStateAccounts(state.accounts);
        renderTable();
        await loadCustomers().catch(() => {});
        showToast('PPPoE entry removed.', 'success');
      } catch (err) {
        btn.disabled = false;
        showToast(err.message || 'Delete failed on MikroTik', 'error');
      }
      return;
    }

    if (action === 'edit') {
      openEditModal(idx);
      return;
    }
  });

  pppoeSyncBtn?.addEventListener('click', () => {
    syncFromMikrotik({ silent: false, background: false });
  });

  generateOpenBtn?.addEventListener('click', openGenerateModal);
  generateClose?.addEventListener('click', closeGenerateModal);
  generateCancel?.addEventListener('click', closeGenerateModal);
  generateModal?.addEventListener('click', (event) => {
    if (event.target === generateModal) closeGenerateModal();
  });
  generateCustomerSelect?.addEventListener('change', () => {
    const selectedAccount = String(generateCustomerSelect.value || '').trim();
    const selectedRow = generateCustomerSearchRows.find((row) => row.accountNumber === selectedAccount);
    if (generateCustomerSearchInput && selectedRow) {
      generateCustomerSearchInput.value = selectedRow.label;
    }
    if (generateCustomerSearchInput && !selectedAccount) {
      generateCustomerSearchInput.value = '';
    }
    syncGeneratePreview();
  });
  generateCustomerSearchInput?.addEventListener('input', () => {
    renderGenerateCustomerResults();
    syncGeneratePreview();
  });
  generateCustomerSearchInput?.addEventListener('focus', () => {
    renderGenerateCustomerResults();
  });
  generateCustomerSearchInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const query = String(generateCustomerSearchInput.value || '').trim().toLowerCase();
    const firstMatch = (query
      ? generateCustomerSearchRows.find((row) => row.searchText.includes(query))
      : generateCustomerSearchRows[0]
    );
    if (!firstMatch) return;
    event.preventDefault();
    selectGenerateCustomerRow(firstMatch);
  });
  generateCustomerSearchInput?.addEventListener('change', () => {
    syncGenerateCustomerFromSearch({ allowSingleMatch: true });
    hideGenerateCustomerResults();
    syncGeneratePreview();
  });
  generateCustomerResults?.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const option = event.target.closest('.pppoe-customer-search-option');
    if (!option) return;
    const row = generateCustomerSearchRows.find((item) => item.accountNumber === option.dataset.accountNumber);
    selectGenerateCustomerRow(row);
  });
  document.addEventListener('mousedown', (event) => {
    if (!generateModal?.classList.contains('active')) return;
    if (generateCustomerSearchInput?.contains(event.target) || generateCustomerResults?.contains(event.target)) return;
    hideGenerateCustomerResults();
  });
  generateForm?.addEventListener('submit', handleGenerateSubmit);

  routerSelect?.addEventListener('change', () => {
    activeRouterId = routerSelect.value;
    persistActiveRouterId(activeRouterId);
    page = 1;
    renderActiveRouterSnapshot();
    renderTable();
    populateGenerateCustomerOptions();
    syncGeneratePreview();
    const selectedRouterId = activeRouterId;
    loadRouterProfiles(selectedRouterId, { silent: true }).then(() => {
      if (selectedRouterId === resolveActiveRouterId()) {
        populateGenerateCustomerOptions();
        syncGeneratePreview();
      }
    }).catch(() => {});
    loadMikrotikInfo(true, activeRouterId);
    refreshLiveStatus();
  });

  searchInput?.addEventListener('input', (e) => {
    filters.search = e.target.value || '';
    page = 1;
    renderTable();
  });

  statusChips.forEach((chip) => {
    const value = chip.getAttribute('data-pppoe-status-chip') || 'all';
    const isActive = value === filters.status;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-checked', isActive ? 'true' : 'false');
    chip.addEventListener('click', () => {
      const val = chip.getAttribute('data-pppoe-status-chip') || 'all';
      filters.status = val;
      sessionStorage.setItem('pppoeStatus', val);
      statusChips.forEach((c) => {
        const active = c === chip;
        c.classList.toggle('active', active);
        c.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      page = 1;
      renderTable();
    });
  });

  assignmentChips.forEach((chip) => {
    const value = chip.getAttribute('data-pppoe-assignment-chip') || 'all';
    const isActive = value === filters.assignment;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-checked', isActive ? 'true' : 'false');
    chip.addEventListener('click', () => {
      const val = chip.getAttribute('data-pppoe-assignment-chip') || 'all';
      filters.assignment = val;
      sessionStorage.setItem('pppoeAssignment', val);
      assignmentChips.forEach((c) => {
        const active = c === chip;
        c.classList.toggle('active', active);
        c.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      page = 1;
      renderTable();
    });
  });

  if (pageSizeSelect) {
    // Ensure UI reflects current filter
    pageSizeSelect.value = String(filters.pageSize);
    pageSizeSelect.addEventListener('change', (e) => {
      const raw = e.target.value;
      const numeric = Number(raw);
      filters.pageSize = Number.isFinite(numeric) && numeric > 0 ? numeric : 'all';
      sessionStorage.setItem(pageSizeStorageKey, filters.pageSize);
      page = 1;
      renderTable();
    });
  }

  statusRefreshBtn?.addEventListener('click', () => {
    loadMikrotikInfo();
  });

  document.getElementById('pppoe-prev')?.addEventListener('click', () => {
    page = Math.max(page - 1, 1);
    renderTable();
  });

  document.getElementById('pppoe-next')?.addEventListener('click', () => {
    const numericLimit = Number(filters.pageSize);
    const applyLimit = Number.isFinite(numericLimit) && numericLimit > 0;
    if (!applyLimit) return;
    const total = getFilteredRows().length;
    const pageCount = Math.max(Math.ceil(total / numericLimit), 1);
    page = Math.min(page + 1, pageCount);
    renderTable();
  });

  editClose?.addEventListener('click', closeEditModal);
  editCancel?.addEventListener('click', closeEditModal);
  editPasswordToggle?.addEventListener('click', () => {
    const show = editPassword?.type === 'password';
    setEditPasswordVisibility(show);
  });
  editModal?.addEventListener('click', (e) => {
    if (e.target === editModal) closeEditModal();
  });
  editForm?.addEventListener('submit', handleEditSubmit);

  trafficClose?.addEventListener('click', closeTrafficModal);
  trafficModal?.addEventListener('click', (event) => {
    if (event.target === trafficModal) closeTrafficModal();
  });
  sessionHistoryClose?.addEventListener('click', closeSessionHistoryModal);
  sessionHistoryCancel?.addEventListener('click', closeSessionHistoryModal);
  sessionHistoryModal?.addEventListener('click', (event) => {
    if (event.target === sessionHistoryModal) closeSessionHistoryModal();
  });
  trafficRateCanvas?.addEventListener('click', (event) => {
    selectTrafficPoint('rate', event);
  });
  trafficRateCanvas?.addEventListener('pointermove', (event) => {
    selectTrafficPoint('rate', event, { persist: false });
  });
  trafficRateCanvas?.addEventListener('pointerleave', () => {
    hideTrafficTooltip('rate');
    renderTrafficModal();
  });
  trafficPacketCanvas?.addEventListener('click', (event) => {
    selectTrafficPoint('packet', event);
  });
  trafficPacketCanvas?.addEventListener('pointermove', (event) => {
    selectTrafficPoint('packet', event, { persist: false });
  });
  trafficPacketCanvas?.addEventListener('pointerleave', () => {
    hideTrafficTooltip('packet');
    renderTrafficModal();
  });

  assignClose?.addEventListener('click', closeAssignModal);
  assignUnassign?.addEventListener('click', handleUnassignSubmit);
  assignCancel?.addEventListener('click', closeAssignModal);
  assignUsernameCopyBtn?.addEventListener('click', () => {
    copyAssignFieldValue(assignUsernameInput, 'Username');
  });
  assignPasswordCopyBtn?.addEventListener('click', () => {
    copyAssignFieldValue(assignPasswordInput, 'Password');
  });
  assignModal?.addEventListener('click', (event) => {
    if (event.target === assignModal) closeAssignModal();
  });
  assignCustomerSearchInput?.addEventListener('input', () => {
    syncAssignCustomerFromSearch();
    renderAssignCustomerResults();
  });
  assignCustomerSearchInput?.addEventListener('focus', renderAssignCustomerResults);
  assignCustomerSearchInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const query = String(assignCustomerSearchInput.value || '').trim().toLowerCase();
    const firstMatch = (query
      ? assignCustomerSearchRows.find((row) => row.searchText.includes(query))
      : assignCustomerSearchRows[0]
    );
    if (!firstMatch) return;
    event.preventDefault();
    selectAssignCustomerRow(firstMatch);
  });
  assignCustomerSearchInput?.addEventListener('change', () => {
    syncAssignCustomerFromSearch({ allowSingleMatch: true });
    hideAssignCustomerResults();
  });
  assignCustomerResults?.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const option = event.target.closest('.pppoe-customer-search-option');
    if (!option) return;
    const row = assignCustomerSearchRows.find((item) => item.accountNumber === option.dataset.accountNumber);
    selectAssignCustomerRow(row);
  });
  document.addEventListener('mousedown', (event) => {
    if (!assignModal?.classList.contains('active')) return;
    if (assignCustomerSearchInput?.contains(event.target) || assignCustomerResults?.contains(event.target)) return;
    hideAssignCustomerResults();
  });
  assignCustomerSelect?.addEventListener('change', () => {
    const entry = getCurrentAssignEntry();
    if (!entry) return;
    const mappedAccount = getAssignedCustomerAccountForEntry(entry);
    if (assignUnassign) {
      assignUnassign.disabled = !mappedAccount;
      assignUnassign.title = mappedAccount ? '' : 'No assigned customer for this PPPoE entry';
    }
  });
  assignForm?.addEventListener('submit', handleAssignSubmit);

  window.addEventListener('resize', () => {
    refreshTrafficModalIfOpen();
  });

  const startPage = async () => {
    const settings = await load({ skipRender: true });
    const credentialsAvailable = hasValidMikrotikCredentials(settings);
    const integrationEnabled = Boolean(settings?.mikrotik?.enabled && credentialsAvailable);
    if (!integrationEnabled) {
      const message = settings
        ? 'MikroTik integration is disabled or missing credentials. Enable it under Control Center > Settings to open PPPoE management.'
        : 'Unable to verify MikroTik configuration. Please enable it from the Control Center > Settings page.';
      showIntegrationDisabled(message);
      return;
    }
    hideIntegrationDisabled();
    getAllRouterIds().forEach((routerId) => hydrateRouterRuntimeFromCache(routerId));
    renderActiveRouterSnapshot();
    markStatusPending();
    loadMikrotikInfo();
    startLiveStatus();
    startInfoRefresh();
    await syncFromMikrotik({ silent: true, background: true, allRouters: true });
    await Promise.all([
      loadCustomers(),
      loadCoverageAreaRouterMap(),
      loadPonState(),
      loadPlanProfiles(),
      loadRouterProfiles(resolveActiveRouterId(), { silent: true })
    ]);
    renderTable();
  };

  startPage();

  window.addEventListener('pagehide', () => {
    pageTransitioning = true;
    stopLiveStatus();
    stopAutoSync();
  });
  window.addEventListener('beforeunload', () => {
    pageTransitioning = true;
  });
})();
