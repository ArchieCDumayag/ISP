(function () {
  const disabledNotice = document.getElementById('genieacs-disabled-notice');
  const statusDot = document.getElementById('genieacs-status-dot');
  const statusTitle = document.getElementById('genieacs-status-title');
  const statusSub = document.getElementById('genieacs-status-sub');
  const hostEl = document.getElementById('genieacs-host');
  const uiUrlEl = document.getElementById('genieacs-ui-url');
  const nbiUrlEl = document.getElementById('genieacs-nbi-url');
  const usernameEl = document.getElementById('genieacs-username');
  const enabledEl = document.getElementById('genieacs-enabled');
  const devicesSearchInput = document.getElementById('genieacs-devices-search');
  const devicesBody = document.getElementById('genieacs-devices-body');
  const devicesCount = document.getElementById('genieacs-devices-count');
  const devicesSubtitle = document.getElementById('genieacs-devices-subtitle');
  const refreshBtn = document.getElementById('genieacs-refresh-btn');
  const summonAllBtn = document.getElementById('genieacs-summon-all-btn');
  const exportBtn = document.getElementById('genieacs-export-btn');
  const clearFiltersBtn = document.getElementById('genieacs-clear-filters');
  const statusFilter = document.getElementById('genieacs-status-filter');
  const modelFilter = document.getElementById('genieacs-model-filter');
  const areaFilter = document.getElementById('genieacs-area-filter');
  const pageSizeSelect = document.getElementById('genieacs-page-size');
  const prevPageBtn = document.getElementById('genieacs-prev-page');
  const nextPageBtn = document.getElementById('genieacs-next-page');
  const pageIndicator = document.getElementById('genieacs-page-indicator');
  const lastSyncEl = document.getElementById('genieacs-last-sync');
  const syncStateEl = document.getElementById('genieacs-sync-state');
  const summaryTotal = document.getElementById('genieacs-summary-total');
  const summaryOnline = document.getElementById('genieacs-summary-online');
  const summaryOnlineRate = document.getElementById('genieacs-summary-online-rate');
  const summaryNoContact = document.getElementById('genieacs-summary-nocontact');
  const summaryNoContactRate = document.getElementById('genieacs-summary-nocontact-rate');
  const summaryBadOptical = document.getElementById('genieacs-summary-bad-optical');
  const summaryBadOpticalRate = document.getElementById('genieacs-summary-bad-optical-rate');
  const clientModal = document.getElementById('genieacs-client-modal');
  const clientModalClose = document.getElementById('genieacs-client-modal-close');
  const clientModalTitle = document.getElementById('genieacs-client-modal-title');
  const clientModalSubtitle = document.getElementById('genieacs-client-modal-subtitle');
  const clientAllSection = document.getElementById('genieacs-client-all-section');
  const clientAllHead = document.getElementById('genieacs-client-all-head');
  const clientAllBody = document.getElementById('genieacs-client-all-body');
  const clientAllCount = document.getElementById('genieacs-client-all-count');
  const wifiModal = document.getElementById('genieacs-wifi-modal');
  const wifiModalClose = document.getElementById('genieacs-wifi-modal-close');
  const wifiModalSubtitle = document.getElementById('genieacs-wifi-modal-subtitle');
  const wifiForm = document.getElementById('genieacs-wifi-form');
  const wifiCancel = document.getElementById('genieacs-wifi-cancel');
  const wifiSaveBtn = document.getElementById('genieacs-wifi-save');
  const wifi24SsidInput = document.getElementById('genieacs-wifi-24-ssid');
  const wifi24PasswordInput = document.getElementById('genieacs-wifi-24-password');
  const wifi5SsidInput = document.getElementById('genieacs-wifi-5-ssid');
  const wifi5PasswordInput = document.getElementById('genieacs-wifi-5-password');
  const bindModal = document.getElementById('genieacs-bind-modal');
  const bindModalClose = document.getElementById('genieacs-bind-modal-close');
  const bindModalSubtitle = document.getElementById('genieacs-bind-modal-subtitle');
  const bindCurrentEl = document.getElementById('genieacs-bind-current');
  const bindSearchInput = document.getElementById('genieacs-bind-customer-search');
  const bindUnbindBtn = document.getElementById('genieacs-bind-unbind');
  const bindCancelBtn = document.getElementById('genieacs-bind-cancel');
  const bindSaveBtn = document.getElementById('genieacs-bind-save');
  const toast = document.getElementById('toast');

  const showToast = (message, type = 'info') => {
    if (typeof window.appToast === 'function') {
      window.appToast(message, { type });
      return;
    }
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'} show`;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('show'), 2600);
  };

  const sanitizeHost = (value) => String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .trim();

  const normalizePort = (value, fallback) => {
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? String(parsed) : fallback;
  };

  const buildUrl = (host, port) => {
    const cleanHost = sanitizeHost(host);
    if (!cleanHost) return '';
    const cleanPort = normalizePort(port, '');
    const protocol = String(buildUrl.protocol || 'http').toLowerCase() === 'https' ? 'https' : 'http';
    return `${protocol}://${cleanHost}${cleanPort ? `:${cleanPort}` : ''}`;
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

  let canLoadDevices = false;
  let autoRefreshTimer = null;
  let liveRefreshInFlight = false;
  let loadDevicesInFlight = false;
  let reloadGeneration = 0;
  let initialLiveRefreshQueued = false;
  const deviceState = {
    items: [],
    customers: [],
    search: '',
    statusFilter: 'all',
    modelFilter: 'all',
    areaFilter: 'all',
    page: 1,
    pageSize: Number(pageSizeSelect?.value || 25) || 25,
    lastSyncAt: '',
    wifiDevice: null,
    bindDevice: null,
    bindSelectedAccount: '',
    openClientDeviceId: '',
    openClientMode: ''
  };

  const AUTO_REFRESH_INTERVAL_MS = 3 * 60 * 1000;

  const setText = (element, value, fallback = '-') => {
    if (!element) return;
    element.textContent = String(value || '').trim() || fallback;
  };

  const stopAutoRefresh = () => {
    if (!autoRefreshTimer) return;
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  };

  const startAutoRefresh = () => {
    if (autoRefreshTimer) return;
    autoRefreshTimer = setInterval(() => {
      liveRefreshLoadedDevices({ silent: true });
    }, AUTO_REFRESH_INTERVAL_MS);
  };

  const setStatus = ({ configured, enabled, host, uiUrl, nbiUrl, username, password, usernameSet, passwordSet }) => {
    const hasCredentials = Boolean(
      (String(username || '').trim() || usernameSet) &&
      (String(password || '').trim() || passwordSet)
    );
    const ready = Boolean(configured && hasCredentials && enabled);
    if (statusDot) {
      statusDot.classList.toggle('connected', ready);
      statusDot.classList.toggle('offline', !ready);
    }
    setText(statusTitle, ready ? 'GenieACS configured' : 'GenieACS not ready');
    setText(
      statusSub,
      ready ? uiUrl : 'Set the GenieACS IP address, username, and password under Accounts.',
      'Set the GenieACS IP address, username, and password under Accounts.'
    );
    setText(hostEl, host);
    setText(uiUrlEl, uiUrl);
    setText(nbiUrlEl, nbiUrl);
    setText(usernameEl, String(username || '').trim() || (usernameSet ? 'Saved' : ''));
    setText(enabledEl, ready ? 'Enabled' : 'Disabled');
    if (disabledNotice) disabledNotice.style.display = ready ? 'none' : '';
    canLoadDevices = ready;
    if (ready) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const formatDateTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '-';
    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) return raw;
    return parsed.toLocaleString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatTimeOnly = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '--';
    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) return raw;
    return parsed.toLocaleTimeString('en-PH', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatRelativeTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '-';
    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) return raw;
    const diffMs = Date.now() - parsed.getTime();
    if (diffMs < 0) return 'just now';
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return `${Math.max(seconds, 1)} sec ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  };

  const parseOpticalDbm = (value) => {
    const match = String(value || '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const isBadOptical = (device) => {
    const value = parseOpticalDbm(device?.opticalPower);
    return Number.isFinite(value) && value < -27;
  };

  const isDeviceOnline = (device) => {
    const parsed = new Date(String(device?.lastInform || '').trim());
    if (!Number.isFinite(parsed.getTime())) return false;
    return Date.now() - parsed.getTime() <= 5 * 60 * 1000;
  };

  const getDeviceStatusKey = (device) => {
    const rawStatus = String(device?.status || device?.deviceStatus || device?.adminStatus || '').trim().toLowerCase();
    const disabled = device?.disabled === true || ['disabled', 'inactive', 'deactivated'].includes(rawStatus);
    if (disabled) return 'disabled';
    return isDeviceOnline(device) ? 'online' : 'offline';
  };

  const getCustomerAreaLabel = (device) => {
    const customer = getCustomerByAccount(device?.customerAccountNumber);
    return String(
      customer?.napAssignment?.napCode ||
      customer?.napCode ||
      customer?.area ||
      customer?.coverageArea ||
      customer?.barangay ||
      ''
    ).trim();
  };

  const getDeviceCustomerLabel = (device) => {
    const account = String(device?.customerAccountNumber || '').trim();
    const customer = getCustomerByAccount(account);
    if (!account) return 'N/A';
    const name = customer
      ? String(customer?.name || `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim()).trim()
      : '';
    return [account, name].filter(Boolean).join(' - ') || account;
  };

  const setSyncState = (state = 'waiting', label = '') => {
    if (!syncStateEl) return;
    const normalized = String(state || 'waiting').trim().toLowerCase();
    syncStateEl.className = `genieacs-sync-state is-${normalized}`;
    const text = label || (normalized === 'success' ? 'Success' : normalized === 'error' ? 'Failed' : 'Waiting');
    syncStateEl.innerHTML = `<i class="fa-solid fa-circle"></i> ${escapeHtml(text)}`;
  };

  const updateLastSync = (state = 'success') => {
    deviceState.lastSyncAt = new Date().toISOString();
    if (lastSyncEl) lastSyncEl.textContent = formatTimeOnly(deviceState.lastSyncAt);
    setSyncState(state);
  };

  const getDeviceSearchText = (device) => [
    device.id,
    device.serialNumber,
    device.manufacturer,
    device.model,
    device.hostname,
    device.ipAddress,
    device.macAddress,
    device.ssid24,
    device.ssid5,
    device.pppoeUsername,
    device.customerAccountNumber,
    getDeviceCustomerLabel(device),
    getCustomerAreaLabel(device),
    device.bindingStatus,
    device.mikrotikStatus,
    device.opticalPower,
    ...(Array.isArray(device.wifiLanClients) ? device.wifiLanClients.map((client) => [
      client.hostname,
      client.macAddress,
      client.ipAddress,
      client.online ? 'online' : 'offline'
    ].join(' ')) : []),
    device.softwareVersion,
    device.connectionRequestUrl
  ].join(' ').toLowerCase();

  const getDisplayedDevices = () => {
    const query = String(deviceState.search || '').trim().toLowerCase();
    const searched = query
      ? deviceState.items.filter((device) => getDeviceSearchText(device).includes(query))
      : deviceState.items;
    return searched.filter((device) => {
      if (deviceState.statusFilter === 'online' && !isDeviceOnline(device)) return false;
      if (deviceState.statusFilter === 'nocontact' && isDeviceOnline(device)) return false;

      const model = String(device?.model || '').trim();
      if (deviceState.modelFilter !== 'all' && model !== deviceState.modelFilter) return false;

      const area = getCustomerAreaLabel(device);
      if (deviceState.areaFilter !== 'all' && area !== deviceState.areaFilter) return false;
      return true;
    });
  };

  const getCustomerDisplayName = (customer) => {
    const accountNumber = String(customer?.accountNumber || '').trim();
    const name = String(customer?.name || `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim()).trim();
    return [accountNumber, name].filter(Boolean).join(' - ') || accountNumber || 'Unnamed customer';
  };

  const getCustomerByAccount = (accountNumber) => {
    const target = String(accountNumber || '').trim();
    if (!target) return null;
    return deviceState.customers.find((customer) => String(customer?.accountNumber || '').trim() === target) || null;
  };

  const getCustomerInputValue = (accountNumber = '') => {
    const selected = String(accountNumber || '').trim();
    if (!selected) return '';
    return getCustomerDisplayName(getCustomerByAccount(selected) || { accountNumber: selected, name: 'Missing customer' });
  };

  const getCustomerDisplayValue = (device = {}) => {
    const accountNumber = String(device?.customerAccountNumber || '').trim();
    if (!accountNumber) return 'N/A';
    return getCustomerInputValue(accountNumber) || accountNumber;
  };

  const getCustomerNameValue = (device = {}) => {
    const accountNumber = String(device?.customerAccountNumber || '').trim();
    const customer = getCustomerByAccount(accountNumber);
    return String(
      customer?.name ||
      `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim() ||
      ''
    ).trim();
  };

  const resolveCustomerAccountFromInput = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const lowerRaw = raw.toLowerCase();
    const direct = deviceState.customers.find((customer) => String(customer?.accountNumber || '').trim().toLowerCase() === lowerRaw);
    if (direct) return String(direct.accountNumber || '').trim();
    const byLabel = deviceState.customers.find((customer) => getCustomerDisplayName(customer).toLowerCase() === lowerRaw);
    if (byLabel) return String(byLabel.accountNumber || '').trim();
    const accountPrefix = raw.split(' - ')[0]?.trim();
    const byPrefix = deviceState.customers.find((customer) => String(customer?.accountNumber || '').trim() === accountPrefix);
    return byPrefix ? String(byPrefix.accountNumber || '').trim() : null;
  };

  const renderCustomerSearchList = () => {
    let list = document.getElementById('genieacs-customer-options');
    if (!list) {
      list = document.createElement('datalist');
      list.id = 'genieacs-customer-options';
      document.body.appendChild(list);
    }
    list.innerHTML = deviceState.customers
      .map((customer) => `<option value="${escapeHtml(getCustomerDisplayName(customer))}"></option>`)
      .join('');
  };

  const getGenieacsBindingStatus = (device) => {
    if (!String(device?.customerAccountNumber || '').trim()) {
      return { key: 'unbound', label: 'Not yet bind' };
    }
    const status = String(device?.mikrotikStatus || device?.bindingStatus || '').trim().toLowerCase();
    return status === 'online'
      ? { key: 'online', label: 'Online' }
      : { key: 'offline', label: 'Offline' };
  };

  const renderGenieacsBindingStatus = (device) => {
    const status = getGenieacsBindingStatus(device);
    return `
      <span class="genieacs-bind-status genieacs-bind-status--${escapeHtml(status.key)}" title="${escapeHtml(status.label)}" aria-label="${escapeHtml(status.label)}">
        <span class="genieacs-bind-status__dot" aria-hidden="true"></span>
        <span class="genieacs-bind-status__text">${escapeHtml(status.label)}</span>
      </span>
    `;
  };

  const scheduleDeviceReloadsAfterSummon = (silent = true) => {
    reloadGeneration += 1;
    const generation = reloadGeneration;
    [1500, 3000, 5000, 10000, 20000, 30000].forEach((delay) => {
      setTimeout(() => {
        if (generation !== reloadGeneration) return;
        loadDevices({ silent, force: true });
      }, delay);
    });
  };

  const clientIdentity = (client) => {
    const mac = String(client?.macAddress || '').trim().toLowerCase();
    if (mac) return `mac:${mac}`;
    const ip = String(client?.ipAddress || '').trim().toLowerCase();
    if (ip) return `ip:${ip}`;
    const host = String(client?.hostname || '').trim().toLowerCase();
    return host ? `host:${host}` : '';
  };

  const normalizeModelKey = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  const getWifiBandByIndex = (model, index) => {
    const modelKey = normalizeModelKey(model);
    const idx = String(index || '').trim();
    if (modelKey.includes('m2-2050-g40')) {
      if (idx === '6') return '2.4G';
      if (idx === '1') return '5G';
      return '';
    }
    if (modelKey.includes('eg8145v5')) {
      if (idx === '1') return '2.4G';
      if (idx === '5') return '5G';
      return '';
    }
    if (idx === '6') return '2.4G';
    if (['1', '2', '5'].includes(idx)) return '5G';
    return '';
  };

  const mergeClient = (target, source) => ({
    ...target,
    hostname: target.hostname || source.hostname || '',
    macAddress: target.macAddress || source.macAddress || '',
    ipAddress: target.ipAddress || source.ipAddress || '',
    signal: target.signal || source.signal || '',
    band: target.band || source.band || '',
    source: [target.source, source.source].filter(Boolean).join(', '),
    online: Boolean(target.online || source.online)
  });

  const isTrustedLiveClient = (client) => {
    if (!client || typeof client !== 'object') return false;
    return Boolean(client.online);
  };

  const buildUnifiedClients = (device, options = {}) => {
    const liveOnly = options.liveOnly !== false;
    const entries = [];
    const pushClients = (clients, band, source) => {
      if (!Array.isArray(clients)) return;
      clients.forEach((client) => entries.push({ ...client, band, source }));
    };

    pushClients(device?.wifi24Clients, '2.4G', 'WiFi');
    pushClients(device?.wifi5Clients, '5G', 'WiFi');
    pushClients(device?.wifiLanClients, 'LAN/Host', 'Hosts');

    const byKey = new Map();
    entries.forEach((client, index) => {
      const key = clientIdentity(client) || `row:${index}`;
      const existing = byKey.get(key);
      byKey.set(key, existing ? mergeClient(existing, client) : client);
    });

    return Array.from(byKey.values())
      .filter((client) => !liveOnly || isTrustedLiveClient(client))
      .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return String(a.hostname || a.macAddress || a.ipAddress || '')
        .localeCompare(String(b.hostname || b.macAddress || b.ipAddress || ''));
    });
  };

  const getModemLabel = (device) => [
    device?.manufacturer,
    device?.model,
    device?.ipAddress || device?.serialNumber || device?.id
  ].filter(Boolean).join(' | ') || 'Modem';

  const buildAllConnectedClients = () => {
    const results = [];
    deviceState.items.forEach((device) => {
      const modemLabel = getModemLabel(device);
      buildUnifiedClients(device)
        .filter((client) => client.online)
        .forEach((client) => results.push({ ...client, modemLabel }));
    });
    return results.sort((a, b) => {
      const modemCompare = String(a.modemLabel || '').localeCompare(String(b.modemLabel || ''));
      if (modemCompare) return modemCompare;
      return String(a.hostname || a.macAddress || a.ipAddress || '')
        .localeCompare(String(b.hostname || b.macAddress || b.ipAddress || ''));
    });
  };

  const buildRegisteredClientRows = (device) => {
    const rows = [];
    const wifiBandByIdentity = new Map();
    const rememberWifiBand = (clients, band) => {
      if (!Array.isArray(clients)) return;
      clients.forEach((client) => {
        const key = clientIdentity(client);
        if (key && !wifiBandByIdentity.has(key)) wifiBandByIdentity.set(key, band);
      });
    };
    rememberWifiBand(device?.wifi24Clients, '2.4G');
    rememberWifiBand(device?.wifi5Clients, '5G');

    const pushRows = (clients, band, source) => {
      if (!Array.isArray(clients)) return;
      clients.forEach((client, index) => {
        const identity = clientIdentity(client);
        const hostBand = band === 'LAN/Host'
          ? (wifiBandByIdentity.get(identity) || getClientBandFromHost(client, device?.model))
          : '';
        rows.push({
          ...client,
          band: band === 'LAN/Host' ? hostBand : band,
          source,
          _order: rows.length + index
        });
      });
    };
    pushRows(device?.wifi24Clients, '2.4G', 'WiFi');
    pushRows(device?.wifi5Clients, '5G', 'WiFi');
    pushRows(device?.wifiLanClients, 'LAN/Host', 'Hosts');
    const merged = new Map();
    rows.forEach((row, index) => {
      const mac = String(row?.macAddress || '').trim().toLowerCase();
      const ip = String(row?.ipAddress || '').trim().toLowerCase();
      const key = mac ? `mac:${mac}` : (ip ? `ip:${ip}` : `row:${index}`);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, row);
        return;
      }
      const existingBand = String(existing.band || '');
      const nextBand = String(row.band || '');
      const shouldUseNextBand = (!existingBand || existingBand === 'LAN/Host') && nextBand && nextBand !== 'LAN/Host';
      merged.set(key, {
        ...existing,
        hostname: existing.hostname || row.hostname || '',
        macAddress: existing.macAddress || row.macAddress || '',
        ipAddress: existing.ipAddress || row.ipAddress || '',
        signal: existing.signal || row.signal || '',
        band: shouldUseNextBand ? nextBand : (existing.band || row.band || ''),
        source: Array.from(new Set([existing.source, row.source].filter(Boolean).join(', ').split(/\s*,\s*/).filter(Boolean))).join(', '),
        online: Boolean(existing.online || row.online)
      });
    });
    return Array.from(merged.values()).sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      const bandCompare = String(a.band || '').localeCompare(String(b.band || ''));
      if (bandCompare) return bandCompare;
      return Number(a._order || 0) - Number(b._order || 0);
    });
  };

  const toClientCount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
  };

  const getConnectedClientCount = (device) => {
    const bandCounts = getBandOnlineCounts(device);
    const bandTotal = Number(bandCounts.online24 || 0) + Number(bandCounts.online5 || 0);
    const clients = buildUnifiedClients(device);
    const onlineRowCount = clients.filter((client) => client.online).length;
    const directTotal = toClientCount(device?.wifiTotalOnlineCount);
    const directBandTotal = [toClientCount(device?.wifi24OnlineCount), toClientCount(device?.wifi5OnlineCount)]
      .filter((value) => value != null)
      .reduce((sum, value) => sum + value, 0);
    return Math.max(directTotal || 0, directBandTotal || 0, bandTotal, onlineRowCount);
  };

  const getOnlineClientCount = (clients = []) => (Array.isArray(clients) ? clients : [])
    .filter((client) => client.online)
    .length;

  const addMissingOnlinePlaceholders = (clients, expectedCount, band) => {
    const parsed = toClientCount(expectedCount);
    if (parsed == null || parsed <= clients.length) return clients;
    const next = [...clients];
    for (let index = next.length; index < parsed; index += 1) {
      next.push({
        hostname: `Unknown ${band} device ${index + 1}`,
        macAddress: '',
        ipAddress: '',
        signal: '',
        band,
        source: 'Online count only',
        online: true
      });
    }
    return next;
  };

  const addMissingTotalPlaceholders = (clients, expectedCount) => {
    const parsed = toClientCount(expectedCount);
    if (parsed == null || parsed <= clients.length) return clients;
    const next = [...clients];
    for (let index = next.length; index < parsed; index += 1) {
      next.push({
        hostname: `Unknown device ${index + 1}`,
        macAddress: '',
        ipAddress: '',
        signal: '',
        band: 'Unknown',
        source: 'Count only',
        online: true
      });
    }
    return next;
  };

  const getClientBandFromHost = (client, model = '') => {
    const layer2 = String(client?.layer2Interface || '').trim().toLowerCase();
    if (layer2) {
      const match = layer2.match(/wlanconfiguration\.(\d+)/);
      if (match) return getWifiBandByIndex(model, match[1]);
      return '';
    }
    const text = [
      client?.band,
      client?.interfaceType,
      client?.interfacePath,
      client?.source
    ].join(' ').toLowerCase();
    const match = text.match(/(?:wlanconfiguration|wifi\.ssid|accesspoint)\.(\d+)/);
    if (match) return getWifiBandByIndex(model, match[1]);
    if (text.includes('5g') || text.includes('5ghz')) return '5G';
    if (text.includes('2.4') || text.includes('2g') || text.includes('2ghz')) return '2.4G';
    return '';
  };

  const enrichClientsFromHosts = (clients = [], hostClients = []) => {
    if (!Array.isArray(clients) || !Array.isArray(hostClients) || !hostClients.length) return clients;
    const byMac = new Map();
    const byIp = new Map();
    hostClients.forEach((host) => {
      const mac = String(host?.macAddress || '').trim().toLowerCase();
      const ip = String(host?.ipAddress || '').trim().toLowerCase();
      if (mac) byMac.set(mac, host);
      if (ip) byIp.set(ip, host);
    });
    return clients.map((client) => {
      const mac = String(client?.macAddress || '').trim().toLowerCase();
      const ip = String(client?.ipAddress || '').trim().toLowerCase();
      const host = (mac && byMac.get(mac)) || (ip && byIp.get(ip)) || null;
      return host ? mergeClient(client, { ...host, source: 'Hosts' }) : client;
    });
  };

  const buildBandClients = (device) => {
    const hostClients = Array.isArray(device?.wifiLanClients) ? device.wifiLanClients : [];
    let direct24 = buildUnifiedClients({ wifi24Clients: device?.wifi24Clients })
      .filter((client) => client.band === '2.4G');
    let direct5 = buildUnifiedClients({ wifi5Clients: device?.wifi5Clients })
      .filter((client) => client.band === '5G');
    direct24 = enrichClientsFromHosts(direct24, hostClients);
    direct5 = enrichClientsFromHosts(direct5, hostClients);

    if (direct24.length || direct5.length) {
      return { clients24: direct24, clients5: direct5 };
    }

    const clients24 = [];
    const clients5 = [];
    hostClients.forEach((client) => {
      const band = getClientBandFromHost(client, device?.model);
      if (!client?.online) return;
      const entry = { ...client, band: band || 'LAN/Host' };
      if (band === '5G') {
        clients5.push(entry);
      } else {
        clients24.push(entry);
      }
    });
    return {
      clients24,
      clients5
    };
  };

  const getBandOnlineCounts = (device) => {
    const { clients24, clients5 } = buildBandClients(device);
    return {
      online24: getOnlineClientCount(clients24),
      online5: getOnlineClientCount(clients5)
    };
  };

  const renderUnifiedClientRows = (tbody, clients = [], options = {}) => {
    if (!tbody) return;
    const showModem = Boolean(options.showModem);
    const showBand = options.showBand !== false;
    const columnCount = 5 + (showModem ? 1 : 0) + (showBand ? 1 : 0);
    if (clientAllHead) {
      clientAllHead.innerHTML = `
        <th>Status</th>
        ${showModem ? '<th>Modem</th>' : ''}
        ${showBand ? '<th>Band</th>' : ''}
        <th>Host</th>
        <th>MAC</th>
        <th>IP</th>
        <th>Signal</th>
      `;
    }
    if (!Array.isArray(clients) || !clients.length) {
      tbody.innerHTML = `<tr><td colspan="${columnCount}" class="genieacs-table-empty">${options.emptyText || 'No client devices reported.'}</td></tr>`;
      return;
    }
    tbody.innerHTML = clients.map((client) => `
      <tr>
        <td><span class="genieacs-client-status ${client.online ? 'is-online' : 'is-offline'}">${client.online ? 'Online' : 'Offline'}</span></td>
        ${showModem ? `<td>${escapeHtml(client.modemLabel || '-')}</td>` : ''}
        ${showBand ? `<td>${escapeHtml(client.band || '-')}</td>` : ''}
        <td>${escapeHtml(client.hostname || '-')}</td>
        <td>${escapeHtml(client.macAddress || '-')}</td>
        <td>${escapeHtml(client.ipAddress || '-')}</td>
        <td>${escapeHtml(client.signal || '-')}</td>
      </tr>
    `).join('');
  };

  const openBandClientModal = (device, band) => {
    if (!clientModal || !device) return;
    const normalizedBand = String(band || '').trim() === '5G' ? '5G' : '2.4G';
    const label = [device.manufacturer, device.model, device.ipAddress].filter(Boolean).join(' | ') || device.id || 'Modem';
    const { clients24, clients5 } = buildBandClients(device);
    const expectedCount = normalizedBand === '5G' ? device.wifi5OnlineCount : device.wifi24OnlineCount;
    const bandRows = normalizedBand === '5G' ? clients5 : clients24;
    const clients = addMissingOnlinePlaceholders(
      bandRows.filter((client) => client.online),
      bandRows.length ? null : expectedCount,
      normalizedBand
    );
    if (clientModalTitle) clientModalTitle.textContent = `${normalizedBand} Devices`;
    if (clientModalSubtitle) clientModalSubtitle.textContent = label;
    if (clientAllCount) clientAllCount.textContent = `${clients.length.toLocaleString()} devices`;
    if (clientAllSection) clientAllSection.hidden = false;
    renderUnifiedClientRows(clientAllBody, clients, {
      showBand: false,
      emptyText: `No online ${normalizedBand} devices reported.`
    });
    clientModal.classList.add('active');
    clientModal.setAttribute('aria-hidden', 'false');
  };

  const openTotalClientModal = (device) => {
    if (!clientModal || !device) return;
    deviceState.openClientDeviceId = String(device.id || '');
    deviceState.openClientMode = 'total';
    const label = [device.manufacturer, device.model, device.ipAddress].filter(Boolean).join(' | ') || device.id || 'Modem';
    const clients = buildRegisteredClientRows(device);
    if (clientModalTitle) clientModalTitle.textContent = 'Registered Modem Devices';
    if (clientModalSubtitle) clientModalSubtitle.textContent = label;
    if (clientAllCount) clientAllCount.textContent = `${clients.length.toLocaleString()} registered`;
    if (clientAllSection) clientAllSection.hidden = false;
    renderUnifiedClientRows(clientAllBody, clients, {
      emptyText: 'No registered devices reported for this modem.'
    });
    clientModal.classList.add('active');
    clientModal.setAttribute('aria-hidden', 'false');
  };

  const closeClientModal = () => {
    if (!clientModal) return;
    clientModal.classList.remove('active');
    clientModal.setAttribute('aria-hidden', 'true');
    deviceState.openClientDeviceId = '';
    deviceState.openClientMode = '';
  };

  const openWifiModal = (device) => {
    if (!wifiModal || !device) return;
    deviceState.wifiDevice = device;
    const label = [device.manufacturer, device.model, device.ipAddress].filter(Boolean).join(' | ') || device.id || 'Modem';
    if (wifiModalSubtitle) wifiModalSubtitle.textContent = label;
    if (wifi24SsidInput) wifi24SsidInput.value = device.ssid24 || '';
    if (wifi24PasswordInput) wifi24PasswordInput.value = device.ssid24Password || '';
    if (wifi5SsidInput) wifi5SsidInput.value = device.ssid5 || '';
    if (wifi5PasswordInput) wifi5PasswordInput.value = device.ssid5Password || '';
    wifiModal.classList.add('active');
    wifiModal.setAttribute('aria-hidden', 'false');
  };

  const closeWifiModal = () => {
    if (!wifiModal) return;
    wifiModal.classList.remove('active');
    wifiModal.setAttribute('aria-hidden', 'true');
    deviceState.wifiDevice = null;
  };

  const openBindModal = (device) => {
    if (!bindModal || !device) return;
    deviceState.bindDevice = device;
    deviceState.bindSelectedAccount = String(device.customerAccountNumber || '').trim();
    if (bindModalSubtitle) bindModalSubtitle.textContent = [device.ipAddress, device.model].filter(Boolean).join(' | ') || 'Selected modem';
    if (bindCurrentEl) bindCurrentEl.textContent = `Current: ${getCustomerDisplayValue(device)}`;
    if (bindSearchInput) bindSearchInput.value = getCustomerInputValue(deviceState.bindSelectedAccount);
    if (bindUnbindBtn) bindUnbindBtn.disabled = !deviceState.bindSelectedAccount;
    bindModal.classList.add('active');
    bindModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      bindSearchInput?.focus();
      bindSearchInput?.select();
    }, 50);
  };

  const closeBindModal = () => {
    if (!bindModal) return;
    bindModal.classList.remove('active');
    bindModal.setAttribute('aria-hidden', 'true');
    deviceState.bindDevice = null;
    deviceState.bindSelectedAccount = '';
  };

  const saveWifiSettings = async () => {
    const device = deviceState.wifiDevice;
    if (!device?.id) {
      showToast('Device ID is missing.', 'error');
      return;
    }
    const wifi24 = {
      currentSsid: device.ssid24 || '',
      ssid: String(wifi24SsidInput?.value || '').trim(),
      password: String(wifi24PasswordInput?.value || '').trim()
    };
    const wifi5 = {
      currentSsid: device.ssid5 || '',
      ssid: String(wifi5SsidInput?.value || '').trim(),
      password: String(wifi5PasswordInput?.value || '').trim()
    };
    const changed24 = wifi24.ssid !== String(device.ssid24 || '').trim() || wifi24.password !== String(device.ssid24Password || '').trim();
    const changed5 = wifi5.ssid !== String(device.ssid5 || '').trim() || wifi5.password !== String(device.ssid5Password || '').trim();
    if (!changed24 && !changed5) {
      showToast('No WiFi changes to save.', 'info');
      return;
    }
    const invalidPassword = [wifi24, wifi5].find((entry) => entry.password && entry.password.length < 8);
    if (invalidPassword) {
      showToast('WiFi password must be at least 8 characters.', 'error');
      return;
    }
    const originalHtml = wifiSaveBtn?.innerHTML || '';
    if (wifiSaveBtn) {
      wifiSaveBtn.disabled = true;
      wifiSaveBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Saving';
    }
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
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Failed to change WiFi settings.');
      }
      showToast('WiFi change queued. Offline modems apply it on next inform.', 'success');
      closeWifiModal();
      setTimeout(loadDevices, 2500);
    } catch (error) {
      showToast(error?.name === 'AbortError' ? 'WiFi change is taking too long. The modem may be offline.' : (error.message || 'Failed to change WiFi settings.'), 'error');
    } finally {
      clearTimeout(timeoutId);
      if (wifiSaveBtn) {
        wifiSaveBtn.disabled = false;
        wifiSaveBtn.innerHTML = originalHtml;
      }
    }
  };

  const percent = (count, total) => {
    if (!total) return '0%';
    return `${((count / total) * 100).toFixed(1)}%`;
  };

  const renderSummary = () => {
    const total = deviceState.items.length;
    const online = deviceState.items.filter(isDeviceOnline).length;
    const noContact = Math.max(total - online, 0);
    const badOptical = deviceState.items.filter(isBadOptical).length;
    if (summaryTotal) summaryTotal.textContent = total.toLocaleString();
    if (summaryOnline) summaryOnline.textContent = online.toLocaleString();
    if (summaryOnlineRate) summaryOnlineRate.textContent = percent(online, total);
    if (summaryNoContact) summaryNoContact.textContent = noContact.toLocaleString();
    if (summaryNoContactRate) summaryNoContactRate.textContent = percent(noContact, total);
    if (summaryBadOptical) summaryBadOptical.textContent = badOptical.toLocaleString();
    if (summaryBadOpticalRate) summaryBadOpticalRate.textContent = percent(badOptical, total);
  };

  const syncSelectOptions = (select, values, currentValue) => {
    if (!select) return;
    const safeValue = String(currentValue || 'all');
    select.innerHTML = '<option value="all">All</option>' + values
      .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
      .join('');
    select.value = values.includes(safeValue) ? safeValue : 'all';
  };

  const renderDynamicFilters = () => {
    const models = [...new Set(deviceState.items.map((device) => String(device?.model || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    const areas = [...new Set(deviceState.items.map(getCustomerAreaLabel).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    syncSelectOptions(modelFilter, models, deviceState.modelFilter);
    syncSelectOptions(areaFilter, areas, deviceState.areaFilter);
    deviceState.modelFilter = modelFilter?.value || 'all';
    deviceState.areaFilter = areaFilter?.value || 'all';
  };

  const getPagedDevices = (filtered) => {
    const pageSize = Math.max(Number(deviceState.pageSize || 25), 1);
    const pageCount = Math.max(Math.ceil(filtered.length / pageSize), 1);
    deviceState.page = Math.min(Math.max(Number(deviceState.page || 1), 1), pageCount);
    const start = (deviceState.page - 1) * pageSize;
    return {
      rows: filtered.slice(start, start + pageSize),
      start,
      end: Math.min(start + pageSize, filtered.length),
      pageCount
    };
  };

  const updatePagination = ({ total, start, end, pageCount }) => {
    if (devicesCount) {
      devicesCount.textContent = total
        ? `Showing ${start + 1} to ${end} of ${total.toLocaleString()} modems`
        : `Showing 0 of ${deviceState.items.length.toLocaleString()} modems`;
    }
    if (pageIndicator) pageIndicator.textContent = `Page ${deviceState.page} of ${pageCount}`;
    if (prevPageBtn) prevPageBtn.disabled = deviceState.page <= 1;
    if (nextPageBtn) nextPageBtn.disabled = deviceState.page >= pageCount;
  };

  const renderModemStatus = (device) => {
    const statusKey = getDeviceStatusKey(device);
    const label = statusKey === 'disabled' ? 'Disabled' : statusKey === 'online' ? 'Online' : 'Offline';
    return `<span class="genieacs-status-chip is-${statusKey}"><i class="fa-solid fa-circle"></i>${label}</span>`;
  };

  const renderOpticalPower = (device) => {
    const value = String(device?.opticalPower || '').trim();
    if (!value) return '-';
    return `<span class="genieacs-opm ${isBadOptical(device) ? 'is-bad' : 'is-good'}">${escapeHtml(value)}</span>`;
  };

  const renderDevices = () => {
    if (!devicesBody) return;
    renderSummary();
    renderDynamicFilters();
    const filtered = getDisplayedDevices();
    const { rows, start, end, pageCount } = getPagedDevices(filtered);
    renderCustomerSearchList();
    updatePagination({ total: filtered.length, start, end, pageCount });

    if (!filtered.length) {
      devicesBody.innerHTML = `<tr><td colspan="11" class="genieacs-table-empty">${deviceState.items.length ? 'No modems match the filters.' : 'No modems loaded.'}</td></tr>`;
      return;
    }

    devicesBody.innerHTML = rows.map((device, index) => {
      const pppoeUsername = String(device.pppoeUsername || device.pppoeBoundUsername || '').trim();
      const ssid24 = String(device.ssid24 || '').trim();
      const ssid5 = String(device.ssid5 || '').trim();
      const serial = String(device.serialNumber || device.id || '').trim();
      const mac = String(device.macAddress || '').trim();
      return `
        <tr class="genieacs-device-row is-${escapeHtml(getDeviceStatusKey(device))}" data-device-id="${escapeHtml(device.id || '')}">
          <td>${start + index + 1}</td>
          <td>${renderModemStatus(device)}</td>
          <td>
            <div class="genieacs-cell-main">${escapeHtml(getCustomerNameValue(device) || 'N/A')}</div>
            <div class="genieacs-cell-sub">${escapeHtml(String(device.customerAccountNumber || '').trim() || 'N/A')}</div>
          </td>
          <td>
            <div class="genieacs-cell-main">${escapeHtml(device.ipAddress || '-')}</div>
            <div class="genieacs-cell-sub">${escapeHtml(device.model || '-')}</div>
          </td>
          <td>
            <div class="genieacs-cell-main">${escapeHtml(mac || '-')}</div>
            <div class="genieacs-cell-sub">${escapeHtml(serial || '')}</div>
          </td>
          <td>
            <div class="genieacs-cell-main">${escapeHtml(ssid24 || '-')}</div>
            <div class="genieacs-cell-sub">${escapeHtml(ssid5 || '-')}</div>
          </td>
          <td>${escapeHtml(pppoeUsername || 'N/A')}</td>
          <td>${renderOpticalPower(device)}</td>
          <td>${escapeHtml(formatRelativeTime(device.lastInform))}</td>
          <td>
            <button class="genieacs-count-link" type="button" data-genieacs-action="total-clients" aria-label="View all devices">
              ${escapeHtml(getConnectedClientCount(device))}
            </button>
          </td>
          <td>
            <div class="genieacs-actions">
              <button class="icon-btn ghost genieacs-wifi-btn" type="button" data-genieacs-action="wifi" aria-label="Change WiFi name and password" title="Change WiFi name and password" ${device.id ? '' : 'disabled'}>
                <i class="fa-solid fa-wifi" aria-hidden="true"></i>
              </button>
              <button class="icon-btn ghost genieacs-summon-btn" type="button" data-genieacs-action="summon" aria-label="Summon modem" title="Summon modem" ${device.id ? '' : 'disabled'}>
                <i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>
              </button>
              <button class="icon-btn ghost" type="button" data-genieacs-action="bind" aria-label="Bind customer" title="Bind customer" ${device.id ? '' : 'disabled'}>
                <i class="fa-solid fa-link" aria-hidden="true"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  };

  const summonDevice = async (deviceId, button = null) => {
    const normalizedId = String(deviceId || '').trim();
    if (!normalizedId) {
      showToast('Device ID is missing.', 'error');
      return;
    }
    const originalHtml = button?.innerHTML || '';
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>';
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`/api/genieacs/devices/${encodeURIComponent(normalizeDeviceId(normalizedId))}/summon`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Failed to summon modem.');
      }
      showToast('Summon task queued. Refreshing modem info...', 'success');
      scheduleDeviceReloadsAfterSummon(false);
    } catch (error) {
      if (error?.name === 'AbortError') {
        showToast('Summon is taking too long. The modem may be offline.', 'error');
        return;
      }
      showToast(error.message || 'Failed to summon modem.', 'error');
    } finally {
      clearTimeout(timeoutId);
      if (button) {
        button.disabled = false;
        button.innerHTML = originalHtml;
      }
    }
  };

  const bindCustomerToDevice = async (deviceId, accountNumber, input = null) => {
    const normalizedId = String(deviceId || '').trim();
    if (!normalizedId) {
      showToast('Device ID is missing.', 'error');
      return;
    }
    const selectedAccount = String(accountNumber || '').trim();
    const device = deviceState.items.find((item) => String(item.id || '') === normalizedId);
    const previousAccount = String(device?.customerAccountNumber || '').trim();
    if (input) input.disabled = true;

    try {
      const response = await fetch(`/api/genieacs/devices/${encodeURIComponent(normalizeDeviceId(normalizedId))}/customer`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountNumber: selectedAccount })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Failed to bind customer account.');
      }
      if (device) device.customerAccountNumber = selectedAccount;
      if (device) {
        device.bindingStatus = payload?.bindingStatus || (selectedAccount ? 'offline' : 'unbound');
        device.mikrotikStatus = payload?.mikrotikStatus || (selectedAccount ? 'offline' : '');
        device.pppoeBoundUsername = payload?.pppoeBoundUsername || '';
      }
      if (input) input.value = getCustomerInputValue(selectedAccount);
      renderDevices();
      showToast(selectedAccount ? 'Customer account linked to modem.' : 'Customer link removed from modem.', 'success');
    } catch (error) {
      if (input) input.value = getCustomerInputValue(previousAccount);
      showToast(error.message || 'Failed to bind customer account.', 'error');
    } finally {
      if (input) input.disabled = false;
    }
  };

  const promptBindCustomer = async (deviceId) => {
    const normalizedId = String(deviceId || '').trim();
    const device = deviceState.items.find((item) => String(item.id || '') === normalizedId);
    if (!device) {
      showToast('Device was not found.', 'error');
      return;
    }
    openBindModal(device);
  };

  const saveBindSelection = async (accountNumber = deviceState.bindSelectedAccount) => {
    const device = deviceState.bindDevice;
    if (!device?.id) {
      showToast('Device ID is missing.', 'error');
      return;
    }
    let selectedAccount = String(accountNumber || '').trim();
    if (!selectedAccount && bindSearchInput) {
      const resolved = resolveCustomerAccountFromInput(bindSearchInput.value);
      if (resolved === null) {
        showToast('Select a customer from the results.', 'error');
        return;
      }
      selectedAccount = resolved;
    }
    if (!selectedAccount) {
      showToast('Select a customer first.', 'error');
      return;
    }
    const originalHtml = bindSaveBtn?.innerHTML || '';
    if (bindSaveBtn) {
      bindSaveBtn.disabled = true;
      bindSaveBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Binding...';
    }
    try {
      await bindCustomerToDevice(device.id, selectedAccount, null);
      closeBindModal();
    } finally {
      if (bindSaveBtn) {
        bindSaveBtn.disabled = false;
        bindSaveBtn.innerHTML = originalHtml;
      }
    }
  };

  const unbindCurrentDevice = async () => {
    const device = deviceState.bindDevice;
    if (!device?.id) return;
    const originalHtml = bindUnbindBtn?.innerHTML || '';
    if (bindUnbindBtn) {
      bindUnbindBtn.disabled = true;
      bindUnbindBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Unbinding...';
    }
    try {
      await bindCustomerToDevice(device.id, '', null);
      closeBindModal();
    } finally {
      if (bindUnbindBtn) {
        bindUnbindBtn.disabled = false;
        bindUnbindBtn.innerHTML = originalHtml;
      }
    }
  };

  const liveRefreshLoadedDevices = async (options = {}) => {
    const silent = Boolean(options.silent);
    if (!canLoadDevices || liveRefreshInFlight || loadDevicesInFlight) return;
    if (document.hidden && silent) return;
    const ids = getDisplayedDevices()
      .map((device) => String(device?.id || '').trim())
      .filter(Boolean);
    if (!ids.length) {
      if (!silent) await loadDevices();
      return;
    }
    liveRefreshInFlight = true;
    setSyncState('waiting', 'Summoning');
    if (summonAllBtn && !silent) summonAllBtn.disabled = true;
    if (devicesSubtitle) {
      devicesSubtitle.textContent = `Auto-refreshing ${ids.length.toLocaleString()} displayed modem${ids.length === 1 ? '' : 's'}...`;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch('/api/genieacs/devices/summon', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ deviceIds: ids })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Failed to request live modem updates.');
      }
      if (!silent) {
        showToast(`Live refresh queued for ${Number(payload.queued || 0).toLocaleString()} modem${Number(payload.queued || 0) === 1 ? '' : 's'}.`, 'success');
      }
      if (devicesSubtitle) devicesSubtitle.textContent = 'Waiting for GenieACS to receive fresh modem values...';
      scheduleDeviceReloadsAfterSummon(silent);
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'Live refresh is taking too long. Some modems may be offline.'
        : (error.message || 'Failed to request live modem updates.');
      if (devicesSubtitle) devicesSubtitle.textContent = message;
      if (!silent) showToast(message, 'error');
    } finally {
      clearTimeout(timeoutId);
      liveRefreshInFlight = false;
      if (summonAllBtn) summonAllBtn.disabled = false;
    }
  };

  const loadDevices = async (options = {}) => {
    const silent = Boolean(options.silent);
    const force = Boolean(options.force);
    const liveAfterLoad = Boolean(options.liveAfterLoad);
    if (!canLoadDevices) {
      deviceState.items = [];
      renderDevices();
      return;
    }
    if (loadDevicesInFlight && !force) return;
    loadDevicesInFlight = true;
    setSyncState('waiting', 'Syncing');
    if (devicesSubtitle && !silent) devicesSubtitle.textContent = 'Loading modems from GenieACS...';
    try {
      const response = await fetch('/api/genieacs/devices', { credentials: 'include', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Failed to load GenieACS modems.');
      }
      deviceState.items = Array.isArray(payload.devices) ? payload.devices : [];
      updateLastSync('success');
      renderDevices();
      if (liveAfterLoad && !initialLiveRefreshQueued && deviceState.items.length) {
        initialLiveRefreshQueued = true;
        setTimeout(() => liveRefreshLoadedDevices({ silent: true }), 100);
      }
      if (clientModal?.classList.contains('active')) {
        if (deviceState.openClientMode === 'total' && deviceState.openClientDeviceId) {
          const nextDevice = deviceState.items.find((item) => String(item.id || '') === deviceState.openClientDeviceId);
          if (nextDevice) openTotalClientModal(nextDevice);
        }
      }
      if (devicesSubtitle) {
        devicesSubtitle.textContent = `${silent ? 'Auto-refreshed' : 'Loaded'} ${deviceState.items.length.toLocaleString()} modem${deviceState.items.length === 1 ? '' : 's'} from GenieACS.`;
      }
    } catch (error) {
      deviceState.items = [];
      setSyncState('error', 'Failed');
      renderDevices();
      if (devicesSubtitle) devicesSubtitle.textContent = error.message || 'Failed to load GenieACS modems.';
      if (!silent) showToast(error.message || 'Failed to load GenieACS modems.', 'error');
    } finally {
      loadDevicesInFlight = false;
    }
  };

  const loadCustomersForBinding = async () => {
    try {
      const response = await fetch('/api/customers', { credentials: 'include', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load customers.');
      }
      deviceState.customers = Array.isArray(payload.customers) ? payload.customers : [];
      deviceState.customers.sort((left, right) => getCustomerDisplayName(left).localeCompare(getCustomerDisplayName(right)));
    } catch (error) {
      deviceState.customers = [];
      showToast(error.message || 'Failed to load customers for binding.', 'error');
    }
  };

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/integrations', { credentials: 'include', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Failed to load GenieACS settings.');
      const settings = payload?.settings?.genieacs || {};
      const host = sanitizeHost(settings.host);
      buildUrl.protocol = settings.protocol || 'http';
      const uiUrl = buildUrl(host, settings.uiPort || '3000');
      const nbiUrl = buildUrl(host, settings.nbiPort || '7557');
      const username = String(settings.username || '').trim();
      const password = String(settings.password || '');
      const enabled = Boolean(settings.enabled);
      const configured = Boolean(host);
      const usernameSet = Boolean(settings.usernameSet || username);
      const passwordSet = Boolean(settings.passwordSet || password);
      const hasCredentials = Boolean(usernameSet && passwordSet);
      setStatus({ configured, enabled, host, uiUrl, nbiUrl, username, password, usernameSet, passwordSet });
      await loadCustomersForBinding();
      if (configured && hasCredentials && enabled) {
        checkNbiStatus();
        loadDevices({ liveAfterLoad: true });
      } else {
        loadDevices();
      }
    } catch (error) {
      setStatus({ configured: false, enabled: false, host: '', uiUrl: '', nbiUrl: '', username: '', password: '' });
      showToast(error.message || 'Failed to load GenieACS settings.', 'error');
    }
  };

  const checkNbiStatus = async () => {
    setText(statusTitle, 'Checking GenieACS NBI...');
    try {
      const response = await fetch('/api/genieacs/status', { credentials: 'include', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'GenieACS NBI is not reachable.');
      }
      setText(statusTitle, 'GenieACS connected');
      setText(statusSub, 'Billing system authenticated to the GenieACS NBI.');
      if (statusDot) {
        statusDot.classList.add('connected');
        statusDot.classList.remove('offline');
      }
    } catch (error) {
      setText(statusTitle, 'GenieACS authentication failed');
      setText(statusSub, error.message || 'Billing system could not reach the GenieACS NBI.');
      if (statusDot) {
        statusDot.classList.remove('connected');
        statusDot.classList.add('offline');
      }
    }
  };

  const exportDisplayedDevicesCsv = () => {
    const rows = getDisplayedDevices();
    const headers = [
      '#',
      'Status',
      'Customer',
      'IP / Model',
      'MAC',
      'Serial',
      'SSID 2.4G',
      'SSID 5G',
      'Customer',
      'PPPoE Username',
      'RX Power',
      'Last Inform',
      'Connected Devices'
    ];
    const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.map(escapeCsv).join(','),
      ...rows.map((device, index) => [
        index + 1,
        isDeviceOnline(device) ? 'Online' : 'No Contact',
        getDeviceCustomerLabel(device),
        [device.ipAddress || '', device.model || ''].filter(Boolean).join(' / '),
        device.macAddress || '',
        device.serialNumber || device.id || '',
        device.ssid24 || '',
        device.ssid5 || '',
        device.pppoeUsername || device.pppoeBoundUsername || '',
        device.opticalPower || '',
        device.lastInform || '',
        getConnectedClientCount(device)
      ].map(escapeCsv).join(','))
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `genieacs-modems-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  if (devicesSearchInput) {
    devicesSearchInput.addEventListener('input', () => {
      deviceState.search = devicesSearchInput.value || '';
      deviceState.page = 1;
      renderDevices();
    });
  }

  [
    [statusFilter, 'statusFilter'],
    [modelFilter, 'modelFilter'],
    [areaFilter, 'areaFilter']
  ].forEach(([element, key]) => {
    if (!element) return;
    element.addEventListener('change', () => {
      deviceState[key] = element.value || 'all';
      deviceState.page = 1;
      renderDevices();
    });
  });

  pageSizeSelect?.addEventListener('change', () => {
    deviceState.pageSize = Number(pageSizeSelect.value || 25) || 25;
    deviceState.page = 1;
    renderDevices();
  });

  prevPageBtn?.addEventListener('click', () => {
    deviceState.page = Math.max(1, Number(deviceState.page || 1) - 1);
    renderDevices();
  });

  nextPageBtn?.addEventListener('click', () => {
    deviceState.page = Number(deviceState.page || 1) + 1;
    renderDevices();
  });

  clearFiltersBtn?.addEventListener('click', () => {
    deviceState.search = '';
    deviceState.statusFilter = 'all';
    deviceState.modelFilter = 'all';
    deviceState.areaFilter = 'all';
    deviceState.page = 1;
    if (devicesSearchInput) devicesSearchInput.value = '';
    if (statusFilter) statusFilter.value = 'all';
    if (modelFilter) modelFilter.value = 'all';
    if (areaFilter) areaFilter.value = 'all';
    renderDevices();
  });

  refreshBtn?.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    try {
      await loadDevices({ force: true });
    } finally {
      refreshBtn.disabled = false;
    }
  });

  summonAllBtn?.addEventListener('click', () => {
    liveRefreshLoadedDevices({ silent: false });
  });

  exportBtn?.addEventListener('click', exportDisplayedDevicesCsv);

  if (devicesBody) {
    devicesBody.addEventListener('click', (event) => {
      const bandButton = event.target.closest('[data-genieacs-action="band-clients"]');
      if (bandButton) {
        event.stopPropagation();
        const row = bandButton.closest('tr[data-device-id]');
        const device = deviceState.items.find((item) => String(item.id || '') === String(row?.dataset?.deviceId || ''));
        openBandClientModal(device, bandButton.dataset.band || '');
        return;
      }

      const totalButton = event.target.closest('[data-genieacs-action="total-clients"]');
      if (totalButton) {
        event.stopPropagation();
        const row = totalButton.closest('tr[data-device-id]');
        const device = deviceState.items.find((item) => String(item.id || '') === String(row?.dataset?.deviceId || ''));
        openTotalClientModal(device);
        return;
      }

      const wifiButton = event.target.closest('[data-genieacs-action="wifi"]');
      if (wifiButton) {
        event.stopPropagation();
        const row = wifiButton.closest('tr[data-device-id]');
        const device = deviceState.items.find((item) => String(item.id || '') === String(row?.dataset?.deviceId || ''));
        openWifiModal(device);
        return;
      }

      const bindButton = event.target.closest('[data-genieacs-action="bind"]');
      if (bindButton) {
        event.stopPropagation();
        const row = bindButton.closest('tr[data-device-id]');
        promptBindCustomer(row?.dataset?.deviceId || '');
        return;
      }

      const button = event.target.closest('[data-genieacs-action="summon"]');
      if (button) {
        event.stopPropagation();
        const row = button.closest('tr');
        summonDevice(row?.dataset?.deviceId || '', button);
        return;
      }
    });
  }

  if (clientModalClose) {
    clientModalClose.addEventListener('click', closeClientModal);
  }

  if (wifiModalClose) {
    wifiModalClose.addEventListener('click', closeWifiModal);
  }

  if (wifiCancel) {
    wifiCancel.addEventListener('click', closeWifiModal);
  }

  if (wifiForm) {
    wifiForm.addEventListener('submit', (event) => {
      event.preventDefault();
      saveWifiSettings();
    });
  }

  bindModalClose?.addEventListener('click', closeBindModal);
  bindCancelBtn?.addEventListener('click', closeBindModal);
  bindUnbindBtn?.addEventListener('click', unbindCurrentDevice);
  bindSaveBtn?.addEventListener('click', () => saveBindSelection());

  bindSearchInput?.addEventListener('input', () => {
    deviceState.bindSelectedAccount = resolveCustomerAccountFromInput(bindSearchInput.value) || '';
  });

  bindSearchInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    saveBindSelection();
  });

  if (clientModal) {
    clientModal.addEventListener('click', (event) => {
      if (event.target === clientModal) closeClientModal();
    });
  }

  if (wifiModal) {
    wifiModal.addEventListener('click', (event) => {
      if (event.target === wifiModal) closeWifiModal();
    });
  }

  if (bindModal) {
    bindModal.addEventListener('click', (event) => {
      if (event.target === bindModal) closeBindModal();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && clientModal?.classList.contains('active')) {
      closeClientModal();
    }
    if (event.key === 'Escape' && wifiModal?.classList.contains('active')) {
      closeWifiModal();
    }
    if (event.key === 'Escape' && bindModal?.classList.contains('active')) {
      closeBindModal();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    liveRefreshLoadedDevices({ silent: true });
  });

  window.addEventListener('beforeunload', stopAutoRefresh);

  loadSettings();
})();
