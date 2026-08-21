(function () {
  const PON_API_BASE = '/api/pon';
  const LEGACY_OLT_STORAGE_KEY = 'pon.management.olts.v1';
  const LEGACY_NAP_STORAGE_KEY = 'pon.management.naps.v1';

  const oltForm = document.getElementById('oltForm');
  const napForm = document.getElementById('napForm');
  const napConfigForm = document.getElementById('napConfigForm');
  const ponPortNameForm = document.getElementById('ponPortNameForm');
  const openNapMapBtn = document.getElementById('openNapMapBtn');
  const applyNapMapBtn = document.getElementById('applyNapMapBtn');
  const napMapLayerButtons = Array.from(document.querySelectorAll('[data-nap-map-layer]'));
  const oltTableBody = document.getElementById('oltTableBody');
  const portNapTableBody = document.getElementById('portNapTableBody');
  const napSubscribersTableBody = document.getElementById('napSubscribersTableBody');
  const napPortAssignTableBody = document.getElementById('napPortAssignTableBody');
  const napOpticalForm = document.getElementById('napOpticalForm');
  const oltSearchInput = document.getElementById('oltSearch');
  const napCountInput = document.getElementById('napCount');
  const napCodePrefixInput = document.getElementById('napCodePrefix');
  const napArea = document.getElementById('napArea');
  const napPortAssignSearch = document.getElementById('napPortAssignSearch');
  const napOpticalValueInput = document.getElementById('napOpticalValue');
  const toast = document.getElementById('ponToast');

  const openOltModalBtn = document.getElementById('openOltModalBtn');
  const openNapModalBtn = document.getElementById('openNapModalBtn');
  const openNapFromPortBtn = document.getElementById('openNapFromPortBtn');

  const oltModal = document.getElementById('oltModal');
  const napModal = document.getElementById('napModal');
  const ponPortNameModal = document.getElementById('ponPortNameModal');
  const portNapModal = document.getElementById('portNapModal');
  const napSubscribersModal = document.getElementById('napSubscribersModal');
  const napPortAssignModal = document.getElementById('napPortAssignModal');
  const napOpticalModal = document.getElementById('napOpticalModal');
  const napConfigModal = document.getElementById('napConfigModal');
  const napMapModal = document.getElementById('napMapModal');
  const ponPortNameMeta = document.getElementById('ponPortNameMeta');
  const ponPortDisplayNameInput = document.getElementById('ponPortDisplayName');
  const ponPortRefValueInput = document.getElementById('ponPortRefValue');
  const portNapModalTitle = document.getElementById('portNapModalTitle');
  const portNapModalSubtitle = document.getElementById('portNapModalSubtitle');
  const napSubscribersModalTitle = document.getElementById('napSubscribersModalTitle');
  const napSubscribersMeta = document.getElementById('napSubscribersMeta');
  const napPortAssignTitle = document.getElementById('napPortAssignTitle');
  const napPortAssignMeta = document.getElementById('napPortAssignMeta');
  const napOpticalTitle = document.getElementById('napOpticalTitle');
  const napOpticalMeta = document.getElementById('napOpticalMeta');
  const napConfigModalTitle = document.getElementById('napConfigModalTitle');
  const napConfigCode = document.getElementById('napConfigCode');
  const napConfigSplitter = document.getElementById('napConfigSplitter');
  const napConfigArea = document.getElementById('napConfigArea');
  const napConfigOpticalPower = document.getElementById('napConfigOpticalPower');
  const napConfigCoordinate = document.getElementById('napConfigCoordinate');
  const napConfigMap = document.getElementById('napConfigMap');
  const oltModalTitle = document.getElementById('oltModalTitle');
  const oltNameInput = document.getElementById('oltName');
  const oltTechnologyInput = document.getElementById('oltTechnology');
  const oltSiteInput = document.getElementById('oltSite');
  const oltPonPortsInput = document.getElementById('oltPonPorts');
  const oltPonCodePrefixInput = document.getElementById('oltPonCodePrefix');
  const oltSubmitBtn = oltForm?.querySelector('button[type="submit"]');

  const state = {
    olts: [],
    naps: [],
    coverageAreas: [],
    customers: [],
    livePppoeLookupAvailable: false,
    activePppoeUsernamesLower: new Set(),
    oltSearch: '',
    customerAssignSearch: '',
    expandedOltIds: new Set(),
    reopenPortModalOnNapClose: false,
    selectedPort: null,
    selectedPonPortName: null,
    selectedNapId: '',
    selectedNapConfigId: '',
    selectedNapPortAssignment: null,
    selectedNapPortOptical: null
  };

  const syncState = {
    loadedFromBackend: false,
    revision: '',
    saveTimer: null,
    savePromise: null,
    saveInFlight: false,
    saveQueued: false,
    saveErrorNotified: false,
    backendUnavailableReason: ''
  };
  let eventsBound = false;

  const modalMap = {
    oltModal,
    napModal,
    ponPortNameModal,
    portNapModal,
    napSubscribersModal,
    napPortAssignModal,
    napOpticalModal,
    napConfigModal,
    napMapModal
  };

  const napMapState = {
    map: null,
    marker: null,
    napMarkersLayer: null,
    selected: null,
    tileLayers: null,
    activeLayer: 'satellite'
  };

  const showToast = (message, type = 'info') => {
    if (typeof window.appToast === 'function') {
      window.appToast(message, { type });
      return;
    }
    if (!toast) return;
    const variant = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
    toast.textContent = message;
    toast.className = `toast ${variant} show`;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2600);
  };

  const toText = (value) => String(value || '').trim();

  const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const toPositiveInt = (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed;
  };

  const toNonNegativeInt = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return fallback;
    return parsed;
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const clearLegacyPonLocalCache = () => {
    try {
      localStorage.removeItem(LEGACY_OLT_STORAGE_KEY);
      localStorage.removeItem(LEGACY_NAP_STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
  };

  const safePercent = (used, total) => {
    if (!Number.isFinite(total) || total <= 0) return 0;
    const pct = (used / total) * 100;
    return Number.isFinite(pct) ? pct : 0;
  };

  const normalizeOltStatus = (value) => {
    const raw = toText(value).toLowerCase();
    if (!raw) return 'maintenance';
    if (['online', 'up', 'active', 'connected'].includes(raw)) return 'online';
    if (['offline', 'down', 'inactive', 'disconnected'].includes(raw)) return 'offline';
    if (['maintenance', 'maint', 'maintenance-mode', 'repair'].includes(raw)) return 'maintenance';
    return 'maintenance';
  };

  const normalizeSubscriberStatus = (value) => {
    const raw = toText(value).toLowerCase();
    if (['online', 'up', 'active', 'connected'].includes(raw)) return 'online';
    if (['offline', 'down', 'inactive', 'disconnected'].includes(raw)) return 'offline';
    return '';
  };

  const normalizePonTechnology = (value) => {
    const raw = toText(value).toLowerCase();
    if (!raw) return 'epon';
    if (raw.includes('gpon')) return 'gpon';
    if (raw.includes('epon')) return 'epon';
    return 'epon';
  };

  const formatPonTechnology = (value) => (normalizePonTechnology(value) === 'gpon' ? 'GPON' : 'EPON');

  const getPonCapacityByTechnology = (value) => (normalizePonTechnology(value) === 'gpon' ? 128 : 64);
  const NAP_BATCH_LIMIT = 100;
  const ALLOWED_SPLITTERS = new Set(['1:8', '1:16', '1:24', '1:32']);
  const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  const LEAFLET_JS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  const DEFAULT_MAP_COORD = { lat: 14.5995, lng: 120.9842 };
  const NAP_MAP_LAYER_STORAGE_KEY = 'pon.nap.map.layer';
  const NAP_MAP_LAYER_MAX_ZOOM = {
    satellite: 22
  };

  const normalizePonRef = (value) => {
    const raw = toText(value);
    if (!raw) return '';

    const toPonLabel = (portValue) => {
      const parsed = Number(portValue);
      if (!Number.isInteger(parsed) || parsed <= 0) return '';
      return `PON-${parsed}`;
    };

    const compact = raw.replace(/\s+/g, '');
    const ponMatch = compact.match(/^pon-?(\d+)$/i);
    if (ponMatch) {
      return toPonLabel(ponMatch[1]) || raw;
    }

    if (/^\d+$/.test(compact)) {
      return toPonLabel(compact) || raw;
    }

    const slashParts = raw.split('/').map((part) => part.trim()).filter(Boolean);
    if (slashParts.length >= 2) {
      return toPonLabel(slashParts[slashParts.length - 1]) || raw;
    }

    return raw;
  };

  const normalizeNapCodePrefix = (value) => {
    const cleaned = toText(value)
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return cleaned;
  };
  const normalizePonCodePrefix = (value) => normalizeNapCodePrefix(value) || 'PON';

  const normalizePonPortNames = (value, totalPorts = 0) => {
    let source = value;
    if (typeof source === 'string') {
      try {
        source = JSON.parse(source);
      } catch {
        source = {};
      }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

    const maxPorts = clamp(toNonNegativeInt(totalPorts, 0), 0, 4096);
    const normalized = {};
    Object.entries(source).forEach(([key, label]) => {
      const ponRef = normalizePonRef(key);
      if (!ponRef) return;
      const orderMatch = ponRef.match(/^pon-(\d+)$/i);
      const order = orderMatch ? Number(orderMatch[1]) : null;
      if (maxPorts && Number.isInteger(order) && order > maxPorts) return;

      const displayName = toText(label).slice(0, 80);
      if (!displayName || displayName.toLowerCase() === ponRef.toLowerCase()) return;
      normalized[ponRef] = displayName;
    });
    return normalized;
  };

  const getPonPortDisplayName = (olt, ponRef) => {
    const normalizedRef = normalizePonRef(ponRef);
    if (!normalizedRef) return '';
    const names = normalizePonPortNames(olt?.ponPortNames, olt?.ponPorts);
    return toText(names[normalizedRef]) || normalizedRef;
  };

  const hasCustomPonPortName = (olt, ponRef) => {
    const normalizedRef = normalizePonRef(ponRef);
    if (!normalizedRef) return false;
    const names = normalizePonPortNames(olt?.ponPortNames, olt?.ponPorts);
    return Boolean(toText(names[normalizedRef]));
  };

  const normalizeNapSplitter = (value) => {
    const raw = toText(value).replace('/', ':');
    if (ALLOWED_SPLITTERS.has(raw)) return raw;
    return '1:16';
  };

  const getNapSplitPortCount = (splitter, fallback = 0) => {
    const normalized = normalizeNapSplitter(splitter);
    const parts = normalized.split(':');
    const count = Number(parts[1]);
    if (Number.isInteger(count) && count > 0) return count;
    const safeFallback = Number(fallback);
    if (Number.isInteger(safeFallback) && safeFallback > 0) return safeFallback;
    return 16;
  };

  const getOltPonCodePrefix = (linkedOlt) => {
    const oltKey = normalizeNameKey(linkedOlt);
    if (!oltKey) return 'PON';
    const matchedOlt = state.olts.find((item) => normalizeNameKey(item?.name) === oltKey);
    return normalizePonCodePrefix(matchedOlt?.ponCodePrefix);
  };

  const getPonCodeToken = (ponRef, linkedOlt = '') => {
    const normalized = normalizePonRef(ponRef);
    const prefix = normalizePonCodePrefix(getOltPonCodePrefix(linkedOlt));
    if (!normalized) return '';
    const match = normalized.match(/^PON-(\d+)$/i);
    if (match) {
      return `${prefix}-${String(Number(match[1])).padStart(2, '0')}`;
    }
    const cleaned = toText(normalized).toUpperCase().replace(/\s+/g, '-');
    if (!cleaned) return prefix;
    if (cleaned.startsWith('PON-')) {
      return `${prefix}-${cleaned.slice(4)}`;
    }
    return cleaned;
  };

  const parseCoordinatePair = (value) => {
    const raw = toText(value);
    if (!raw) return null;

    const normalized = raw.replace(/[，]/g, ',');
    let latText = '';
    let lngText = '';

    const commaParts = normalized.split(',').map((part) => part.trim()).filter(Boolean);
    if (commaParts.length >= 2) {
      latText = commaParts[0];
      lngText = commaParts[1];
    } else {
      const looseMatch = normalized.match(/(-?\d+(?:\.\d+)?)[^\d-]+(-?\d+(?:\.\d+)?)/);
      if (looseMatch) {
        latText = looseMatch[1];
        lngText = looseMatch[2];
      }
    }

    if (!latText || !lngText) return null;

    const lat = Number(latText);
    const lng = Number(lngText);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  };

  const parseFlexibleCoordinatePair = (value) => {
    const raw = toText(value);
    if (!raw) return null;

    const normalized = raw
      .replace(/[\uFF0C]/g, ',')
      .replace(/[\u00BA\u02DA]/g, '\u00B0')
      .replace(/[\u2032\u2019]/g, "'")
      .replace(/[\u2033\u201C\u201D]/g, '"')
      .trim();
    const normalizedDms = normalized
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const hasDmsMarkers = /[NSEW]/i.test(normalizedDms) && /[\u00B0'"]|\d+\s+[NSEW]|\b[NSEW]\s*\d/i.test(normalizedDms);
    if (hasDmsMarkers) {
      const parseDmsSegment = (segment) => {
        const text = toText(segment).toUpperCase();
        if (!text) return null;
        const hemisphereMatch = text.match(/[NSEW]/);
        const hemisphere = hemisphereMatch ? hemisphereMatch[0] : '';
        if (!hemisphere) return null;

        const numericParts = text.replace(/[NSEW]/g, ' ').match(/-?\d+(?:\.\d+)?/g) || [];
        if (!numericParts.length) return null;

        const degrees = Number(numericParts[0]);
        const minutes = Number(numericParts[1] || 0);
        const seconds = Number(numericParts[2] || 0);
        if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
        if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;

        let decimal = Math.abs(degrees) + (minutes / 60) + (seconds / 3600);
        if (String(numericParts[0] || '').trim().startsWith('-')) {
          decimal *= -1;
        }
        if (hemisphere === 'S' || hemisphere === 'W') {
          decimal = -Math.abs(decimal);
        } else {
          decimal = Math.abs(decimal);
        }

        return { value: decimal, hemisphere };
      };

      const dmsSegments = normalizedDms.match(/(?:[NSEW][^NSEW]+|[^NSEW]+[NSEW])/gi) || [];
      const parsedDmsSegments = dmsSegments.map(parseDmsSegment).filter(Boolean);
      const latEntry = parsedDmsSegments.find((entry) => entry.hemisphere === 'N' || entry.hemisphere === 'S');
      const lngEntry = parsedDmsSegments.find((entry) => entry.hemisphere === 'E' || entry.hemisphere === 'W');
      if (latEntry && lngEntry) {
        return { lat: latEntry.value, lng: lngEntry.value };
      }
      return null;
    }

    return parseCoordinatePair(normalized);
  };

  const formatCoordinatePair = (lat, lng) => `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;

  const normalizeNapMapLayer = (value) => {
    void value;
    return 'satellite';
  };

  const readNapMapLayerPreference = () => {
    try {
      return normalizeNapMapLayer(localStorage.getItem(NAP_MAP_LAYER_STORAGE_KEY));
    } catch {
      return 'satellite';
    }
  };

  const writeNapMapLayerPreference = (value) => {
    try {
      localStorage.setItem(NAP_MAP_LAYER_STORAGE_KEY, normalizeNapMapLayer(value));
    } catch {
      // Ignore storage failures.
    }
  };

  const updateNapMapLayerButtonState = () => {
    napMapLayerButtons.forEach((button) => {
      const key = normalizeNapMapLayer(button.getAttribute('data-nap-map-layer'));
      button.classList.toggle('is-active', key === napMapState.activeLayer);
    });
  };

  const normalizeAreaName = (value) => toText(value);
  const compareNapCodes = (left, right) => String(left || '').localeCompare(String(right || ''), undefined, {
    sensitivity: 'base',
    numeric: true
  });

  const getAreaFromCoverageRecord = (record) => {
    return normalizeAreaName(
      record?.name ||
      record?.areaName ||
      record?.area ||
      record?.label ||
      ''
    );
  };

  const collectAreaOptions = (selectedArea = '') => {
    const labels = [];
    const seen = new Set();
    const push = (value) => {
      const area = normalizeAreaName(value);
      if (!area) return;
      const key = normalizeNameKey(area);
      if (seen.has(key)) return;
      seen.add(key);
      labels.push(area);
    };

    state.coverageAreas.forEach(push);
    state.naps.forEach((nap) => push(nap?.location));
    push(selectedArea);
    return labels;
  };

  const renderAreaOptions = (selectEl, selectedArea = '') => {
    if (!selectEl) return;
    const options = collectAreaOptions(selectedArea);
    selectEl.innerHTML = `
      <option value="">Select area</option>
      ${options.map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join('')}
    `;

    const selectedKey = normalizeNameKey(selectedArea);
    const matched = options.find((area) => normalizeNameKey(area) === selectedKey);
    selectEl.value = matched || '';
  };

  const renderNapAreaOptions = (selectedArea = '') => {
    renderAreaOptions(napConfigArea, selectedArea);
  };

  const renderNapAddAreaOptions = (selectedArea = '') => {
    renderAreaOptions(napArea, selectedArea);
  };

  const loadCoverageAreas = async () => {
    try {
      const response = await fetch('/api/coverage', { credentials: 'same-origin' });
      if (!response.ok) return;
      const payload = await response.json();
      if (!Array.isArray(payload)) return;
      state.coverageAreas = payload
        .map((entry) => getAreaFromCoverageRecord(entry))
        .filter(Boolean);
    } catch {
      // Ignore coverage area loading errors; fallback options are still available.
    }
  };

  const toCustomerKey = (value) => normalizeNameKey(toText(value));

  const getConnectionCustomerKey = (entry) => {
    const idKey = toCustomerKey(entry?.customerId);
    if (idKey) return idKey;
    return toCustomerKey(entry?.customerRef);
  };

  const formatConnectionCustomerLabel = (entry) => {
    const account = toText(entry?.customerId);
    const fallbackRef = toText(entry?.customerRef);
    let name = toText(entry?.customerName);
    if (!name) {
      const lookupKey = toCustomerKey(account || fallbackRef);
      if (lookupKey) {
        const matchedCustomer = state.customers.find((customer) => customer.key === lookupKey);
        name = toText(matchedCustomer?.name);
      }
    }

    const accountDisplay = account || (name && normalizeNameKey(fallbackRef) === normalizeNameKey(name) ? '' : fallbackRef);
    if (name && accountDisplay && normalizeNameKey(name) !== normalizeNameKey(accountDisplay)) {
      return `${name} (${accountDisplay})`;
    }
    return name || accountDisplay || '-';
  };

  const getAssignedCustomerKeySet = () => {
    const assigned = new Set();
    state.naps.forEach((nap) => {
      getNapConnections(nap).forEach((entry) => {
        const key = getConnectionCustomerKey(entry);
        if (key) assigned.add(key);
      });
    });
    return assigned;
  };

  const normalizeCustomerRecord = (raw) => {
    const accountNumber = toText(raw?.accountNumber || raw?.account || raw?.id);
    const name = toText(raw?.name || `${toText(raw?.firstName)} ${toText(raw?.lastName)}`.trim());
    const area = toText(raw?.area || raw?.location || raw?.coverageArea);
    const pppoeUsername = toText(raw?.pppoeUsername || raw?.pppoe_username);
    const status = toText(raw?.status) || 'unknown';
    const key = toCustomerKey(accountNumber) || toCustomerKey(name);
    return { accountNumber, name, area, pppoeUsername, status, key };
  };

  const loadCustomers = async () => {
    try {
      const response = await fetch('/api/customers', { credentials: 'same-origin' });
      if (!response.ok) return false;
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.customers) ? payload.customers : [];
      state.customers = rows.map(normalizeCustomerRecord).filter((item) => item.key);
      return true;
    } catch {
      return false;
    }
  };

  const getNapLayerMaxZoom = (layerKey = napMapState.activeLayer) => {
    const normalized = normalizeNapMapLayer(layerKey);
    return NAP_MAP_LAYER_MAX_ZOOM[normalized] || NAP_MAP_LAYER_MAX_ZOOM.satellite;
  };

  const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const getNextNapCodeSequence = (prefix, context = {}) => {
    const normalizedPrefix = normalizeNapCodePrefix(prefix);
    if (!normalizedPrefix) return 1;
    const codePrefix = normalizedPrefix.endsWith('NAP') ? normalizedPrefix : `${normalizedPrefix}-NAP`;
    const contextLinkedOlt = normalizeNameKey(context?.linkedOlt);
    const contextPonRef = normalizeNameKey(normalizePonRef(context?.ponRef));
    const ponToken = getPonCodeToken(context?.ponRef, context?.linkedOlt);
    const pattern = ponToken
      ? new RegExp(`^(?:${escapeRegex(ponToken)}-)?${escapeRegex(codePrefix)}-(\\d+)$`, 'i')
      : new RegExp(`^${escapeRegex(codePrefix)}-(\\d+)$`, 'i');
    let highest = 0;
    state.naps.forEach((nap) => {
      if (contextLinkedOlt && normalizeNameKey(nap?.linkedOlt) !== contextLinkedOlt) return;
      if (contextPonRef && normalizeNameKey(normalizePonRef(nap?.ponRef)) !== contextPonRef) return;
      const code = toText(nap?.code);
      const match = code.match(pattern);
      if (!match) return;
      const value = Number(match[1]);
      if (Number.isInteger(value) && value > highest) highest = value;
    });
    return highest + 1;
  };

  const buildNapCodes = (prefix, count, startSequence = 1, context = {}) => {
    const safePrefix = normalizeNapCodePrefix(prefix);
    if (!safePrefix) return [];
    const codePrefix = safePrefix.endsWith('NAP') ? safePrefix : `${safePrefix}-NAP`;
    const ponToken = getPonCodeToken(context?.ponRef, context?.linkedOlt);
    const fullPrefix = ponToken ? `${ponToken}-${codePrefix}` : codePrefix;
    const safeCount = Math.max(1, Math.min(toNumber(count, 1), NAP_BATCH_LIMIT));
    const safeStart = Math.max(1, toNumber(startSequence, 1));
    const width = Math.max(2, String(safeStart + safeCount - 1).length);
    return Array.from({ length: safeCount }, (_, index) => {
      const seq = safeStart + index;
      return `${fullPrefix}-${String(seq).padStart(width, '0')}`;
    });
  };

  const updateNapCodePreview = () => {
    const countValue = Number(napCountInput?.value);
    const countRaw = Number.isInteger(countValue) ? countValue : 0;
    const count = clamp(countRaw, 0, NAP_BATCH_LIMIT);
    if (napCountInput && String(count) !== String(napCountInput.value)) {
      napCountInput.value = String(count);
    }

    const prefix = normalizeNapCodePrefix(napCodePrefixInput?.value);
    if (napCodePrefixInput && napCodePrefixInput.value !== prefix) {
      napCodePrefixInput.value = prefix;
    }

    if (!prefix || count <= 0) {
      updateNapCodePreview.lastGenerated = [];
      return;
    }

    const context = {
      linkedOlt: state.selectedPort?.linkedOlt,
      ponRef: state.selectedPort?.ponRef
    };
    const start = getNextNapCodeSequence(prefix, context);
    const codes = buildNapCodes(prefix, count, start, context);
    updateNapCodePreview.lastGenerated = codes;
  };

  const normalizeNameKey = (value) => toText(value).toLowerCase();

  const escapeHtml = (value) =>
    String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));

  const matchesText = (haystack, query) => {
    if (!query) return true;
    return toText(haystack).toLowerCase().includes(query);
  };

  const normalizeOltRecord = (rawOlt) => {
    const ponPorts = clamp(toNonNegativeInt(rawOlt?.ponPorts, 0), 0, 4096);
    const usedPorts = clamp(Math.max(toNumber(rawOlt?.usedPorts, 0), 0), 0, ponPorts);
    return {
      id: toText(rawOlt?.id) || `olt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: toText(rawOlt?.name),
      technology: normalizePonTechnology(rawOlt?.technology || rawOlt?.vendor),
      site: toText(rawOlt?.site),
      status: normalizeOltStatus(rawOlt?.status),
      ponCodePrefix: normalizePonCodePrefix(rawOlt?.ponCodePrefix || rawOlt?.pon_code_prefix),
      ponPorts,
      usedPorts,
      ponPortNames: normalizePonPortNames(rawOlt?.ponPortNames || rawOlt?.pon_port_names, ponPorts)
    };
  };

  const normalizeConnections = (rawNap) => {
    if (Array.isArray(rawNap?.connections)) {
      return rawNap.connections
        .map((entry) => {
          const customerId = toText(entry?.customerId || entry?.accountNumber || entry?.id);
          const customerName = toText(entry?.customerName || entry?.name || entry?.customer || entry?.customerRef);
          const customerRef = toText(entry?.customerRef || entry?.customer || entry?.name || customerId);
          const port = toPositiveInt(entry?.port || entry?.customerPort || entry?.slot);
          if (!customerRef || !port) return null;
          const opticalInfo = toText(
            entry?.opticalInfo ||
            entry?.optical ||
            entry?.signal ||
            entry?.rxPower ||
            ''
          );
          return {
            customerId,
            customerName,
            customerRef,
            port,
            opticalInfo,
            pppoeUsername: toText(entry?.pppoeUsername || entry?.pppoe_username),
            subscriberStatus: normalizeSubscriberStatus(entry?.subscriberStatus || entry?.status)
          };
        })
        .filter(Boolean);
    }

    const legacyCustomerId = toText(rawNap?.customerId || rawNap?.accountNumber);
    const legacyCustomer = toText(rawNap?.customerRef || rawNap?.customer || rawNap?.name);
    const legacyPort = toPositiveInt(rawNap?.customerPort || rawNap?.port);
    if (legacyCustomer && legacyPort) {
      const opticalInfo = toText(rawNap?.opticalInfo || rawNap?.signal || rawNap?.rxPower || '');
      return [{
        customerId: legacyCustomerId,
        customerName: toText(rawNap?.customerName || rawNap?.name),
        customerRef: legacyCustomer,
        port: legacyPort,
        opticalInfo,
        pppoeUsername: toText(rawNap?.pppoeUsername || rawNap?.pppoe_username),
        subscriberStatus: normalizeSubscriberStatus(rawNap?.subscriberStatus || rawNap?.status)
      }];
    }
    return [];
  };

  const normalizeNapRecord = (rawNap) => {
    const capacity = Math.max(toNumber(rawNap?.capacity, 0), 1);
    const ponCapacity = Math.max(toNumber(rawNap?.ponCapacity, 64), 1);
    const connections = normalizeConnections(rawNap);
    const opticalPower = toText(
      rawNap?.opticalPower ||
      rawNap?.opticalInfo ||
      rawNap?.signal ||
      rawNap?.rxPower ||
      ''
    );
    const locationRaw = toText(rawNap?.location);
    const location = normalizeNameKey(locationRaw) === 'unspecified' ? '' : locationRaw;
    let coordinate = toText(rawNap?.coordinate || rawNap?.coordinates || rawNap?.coords);
    if (!coordinate) {
      const latitude = toText(rawNap?.latitude || rawNap?.lat);
      const longitude = toText(rawNap?.longitude || rawNap?.lng || rawNap?.lon);
      if (latitude && longitude) {
        coordinate = `${latitude}, ${longitude}`;
      }
    }
    const used = clamp(
      Math.max(toNumber(rawNap?.used, 0), connections.length, 0),
      0,
      capacity
    );
    return {
      id: toText(rawNap?.id) || `nap-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      code: toText(rawNap?.code),
      location,
      coordinate,
      splitter: toText(rawNap?.splitter) || '1:16',
      linkedOlt: toText(rawNap?.linkedOlt),
      ponRef: normalizePonRef(rawNap?.ponRef),
      ponCapacity,
      capacity,
      used,
      opticalPower,
      connections
    };
  };

  const getNapConnections = (nap) => {
    if (!nap || !Array.isArray(nap.connections)) return [];
    return nap.connections
      .map((entry) => {
        const customerId = toText(entry?.customerId || entry?.accountNumber || entry?.id);
        const customerName = toText(entry?.customerName || entry?.name);
        const customerRef = toText(entry?.customerRef || customerId || customerName);
        const port = toPositiveInt(entry?.port);
        if (!customerRef || !port) return null;
        const opticalInfo = toText(entry?.opticalInfo || entry?.optical || entry?.signal || entry?.rxPower || '');
        return {
          customerId,
          customerName,
          customerRef,
          port,
          opticalInfo,
          pppoeUsername: toText(entry?.pppoeUsername || entry?.pppoe_username),
          subscriberStatus: resolveConnectionSubscriberStatus(entry)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.port - b.port);
  };

  const resolveConnectionSubscriberStatus = (entry) => {
    const directStatus = normalizeSubscriberStatus(entry?.subscriberStatus || entry?.status);
    if (directStatus) return directStatus;
    if (!state.livePppoeLookupAvailable) return '';

    const directUsername = toText(entry?.pppoeUsername || entry?.pppoe_username);
    if (directUsername) {
      return state.activePppoeUsernamesLower.has(directUsername.toLowerCase()) ? 'online' : 'offline';
    }

    const accountCandidates = [
      toText(entry?.customerId),
      toText(entry?.customerRef)
    ].filter(Boolean);

    for (const account of accountCandidates) {
      const customer = state.customers.find((item) => item.key === toCustomerKey(account));
      const username = toText(customer?.pppoeUsername);
      if (!username) continue;
      return state.activePppoeUsernamesLower.has(username.toLowerCase()) ? 'online' : 'offline';
    }

    return 'offline';
  };

  const resolvePortSubscriberStatus = (entries) => {
    const statuses = (Array.isArray(entries) ? entries : [])
      .map((entry) => resolveConnectionSubscriberStatus(entry))
      .filter(Boolean);
    if (statuses.includes('online')) return 'online';
    if (statuses.includes('offline')) return 'offline';
    return '';
  };

  const renderPortSubscriberStatus = (status) => {
    const normalized = normalizeSubscriberStatus(status);
    if (!normalized) return '';
    const label = normalized === 'online' ? 'Online' : 'Offline';
    return `<span class="pon-subscriber-status pon-subscriber-status--${normalized}" title="${label}" aria-label="${label}"></span>`;
  };

  const serializePonState = () => ({
    expectedRevision: syncState.revision,
    olts: state.olts.map((item) => ({
      id: toText(item.id),
      name: toText(item.name),
      technology: normalizePonTechnology(item.technology),
      site: toText(item.site),
      status: normalizeOltStatus(item.status),
      ponCodePrefix: normalizePonCodePrefix(item.ponCodePrefix),
      ponPorts: clamp(toNonNegativeInt(item.ponPorts, 0), 0, 4096),
      ponPortNames: normalizePonPortNames(item.ponPortNames, item.ponPorts)
    })),
    naps: state.naps.map((item) => ({
      id: toText(item.id),
      code: toText(item.code),
      location: toText(item.location),
      coordinate: toText(item.coordinate),
      splitter: normalizeNapSplitter(item.splitter),
      linkedOlt: toText(item.linkedOlt),
      ponRef: normalizePonRef(item.ponRef),
      ponCapacity: Math.max(toNumber(item.ponCapacity, 0), 1),
      capacity: Math.max(toNumber(item.capacity, 0), 1),
      used: Math.max(toNumber(item.used, 0), 0),
      opticalPower: toText(item.opticalPower),
      connections: getNapConnections(item).map((entry) => ({
        customerId: toText(entry.customerId),
        customerName: toText(entry.customerName),
        customerRef: toText(entry.customerRef),
        port: toPositiveInt(entry.port),
        opticalInfo: toText(entry.opticalInfo)
      })).filter((entry) => entry.port)
    }))
  });

  const requestPonApi = async (endpoint, options = {}) => {
    const response = await fetch(`${PON_API_BASE}${endpoint}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });

    if (response.status === 204) return null;
    const contentType = toText(response.headers.get('content-type')).toLowerCase();
    const isJsonResponse = contentType.includes('application/json');
    let payload = null;

    if (isJsonResponse) {
      payload = await response.json().catch(() => {
        throw new Error('PON backend returned invalid JSON.');
      });
    }

    if (!response.ok) {
      const message = toText(payload?.error?.message || payload?.error || payload?.message) || `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.code = toText(payload?.code);
      error.currentRevision = toText(payload?.currentRevision);
      throw error;
    }
    if (!isJsonResponse) {
      throw new Error('PON backend returned an unexpected response.');
    }
    return payload;
  };

  const notifyBackendSyncFailure = (message) => {
    if (syncState.saveErrorNotified) return;
    syncState.saveErrorNotified = true;
    showToast(message, 'error');
  };

  const renderPonWorkspace = () => {
    rerender();
    renderPortNapModal();
    renderNapSubscribersModal();
    renderNapPortAssignModal();
    renderNapOpticalModal();
    renderNapConfigModal();
  };

  const getPonReadOnlyMessage = () => {
    const reason = toText(syncState.backendUnavailableReason);
    return reason
      ? `PON changes are unavailable: ${reason}`
      : 'PON changes cannot be saved right now because backend sync is unavailable.';
  };

  const canPersistPonChanges = ({ notify = false } = {}) => {
    const available = Boolean(syncState.loadedFromBackend);
    if (!available && notify) {
      showToast(getPonReadOnlyMessage(), 'error');
    }
    return available;
  };

  const syncPonMutationUi = () => {
    const available = canPersistPonChanges();
    const disabledMessage = getPonReadOnlyMessage();
    [
      openOltModalBtn,
      openNapModalBtn,
      openNapFromPortBtn
    ].forEach((button) => {
      if (!button) return;
      button.disabled = !available;
      button.title = available ? '' : disabledMessage;
      button.setAttribute('aria-disabled', available ? 'false' : 'true');
    });
  };

  const applyBackendRevision = (payload) => {
    const revision = toText(payload?.revision);
    if (!revision) {
      throw new Error('PON backend response is missing its state revision.');
    }
    syncState.revision = revision;
    return revision;
  };

  const recoverFromPonRevisionConflict = async () => {
    syncState.saveQueued = false;
    if (syncState.saveTimer) {
      clearTimeout(syncState.saveTimer);
      syncState.saveTimer = null;
    }
    try {
      await hydratePonStateFromBackend();
      renderPonWorkspace();
      syncPonMutationUi();
      showToast('PON data changed on the server. Latest technician/admin changes were reloaded; review and retry.', 'error');
    } catch (reloadError) {
      syncState.loadedFromBackend = false;
      syncState.revision = '';
      syncState.backendUnavailableReason = `Conflict reload failed: ${reloadError.message}`;
      syncPonMutationUi();
      showToast('PON data changed on the server, but the latest state could not be reloaded. Editing is disabled.', 'error');
    }
  };

  const flushBackendPersist = async () => {
    if (!syncState.loadedFromBackend) return;
    if (syncState.saveInFlight) {
      syncState.saveQueued = true;
      return syncState.savePromise || Promise.resolve();
    }
    syncState.saveInFlight = true;
    const persistPromise = (async () => {
      const payload = serializePonState();
      try {
        const result = await requestPonApi('/state', {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        applyBackendRevision(result);
        syncState.saveErrorNotified = false;
      } catch (error) {
        if (error.status === 409 || error.code === 'PON_STATE_CONFLICT') {
          await recoverFromPonRevisionConflict();
        } else {
          notifyBackendSyncFailure(error.message || 'Failed to sync PON data.');
        }
        throw error;
      } finally {
        syncState.saveInFlight = false;
      }
      if (syncState.saveQueued) {
        syncState.saveQueued = false;
        await flushBackendPersist();
      }
    })();
    syncState.savePromise = persistPromise;
    try {
      await persistPromise;
    } finally {
      if (syncState.savePromise === persistPromise) {
        syncState.savePromise = null;
      }
    }
  };

  const queueBackendPersist = () => {
    if (!syncState.loadedFromBackend) return;
    clearTimeout(syncState.saveTimer);
    syncState.saveTimer = setTimeout(() => {
      syncState.saveTimer = null;
      flushBackendPersist().catch(() => {});
    }, 180);
  };

  const persistNow = async () => {
    if (!syncState.loadedFromBackend) return false;
    if (syncState.saveTimer) {
      clearTimeout(syncState.saveTimer);
      syncState.saveTimer = null;
    }
    await flushBackendPersist();
    return true;
  };

  const hydratePonStateFromBackend = async () => {
    const payload = await requestPonApi('/state');
    if (payload?.schemaReady === false) {
      syncState.revision = '';
      throw new Error(toText(payload?.message) || 'PON schema is not initialized. Run Schema Update first.');
    }
    applyBackendRevision(payload);
    const activePppoeUsernames = Array.isArray(payload?.activePppoeUsernames) ? payload.activePppoeUsernames : [];
    state.livePppoeLookupAvailable = Boolean(payload?.subscriberStatusAvailable);
    state.activePppoeUsernamesLower = new Set(
      activePppoeUsernames
        .map((item) => toText(item).toLowerCase())
        .filter(Boolean)
    );
    const rawOlts = Array.isArray(payload?.olts) ? payload.olts : [];
    const rawNaps = Array.isArray(payload?.naps) ? payload.naps : [];
    state.olts = rawOlts.map((item) => normalizeOltRecord(item));
    state.naps = rawNaps.map((item) => normalizeNapRecord(item));
    syncState.loadedFromBackend = true;
    syncState.backendUnavailableReason = '';
    syncState.saveErrorNotified = false;
    return true;
  };

  const hydratePonOverviewFromBackend = async () => {
    const payload = await requestPonApi('/overview');

    const coverageRows = Array.isArray(payload?.coverageAreas) ? payload.coverageAreas : [];
    state.coverageAreas = coverageRows
      .map((entry) => getAreaFromCoverageRecord(entry))
      .filter(Boolean);

    const customerRows = Array.isArray(payload?.customers) ? payload.customers : [];
    state.customers = customerRows
      .map(normalizeCustomerRecord)
      .filter((item) => item.key);

    if (payload?.schemaReady === false) {
      state.livePppoeLookupAvailable = false;
      state.activePppoeUsernamesLower = new Set();
      state.olts = [];
      state.naps = [];
      syncState.loadedFromBackend = false;
      syncState.revision = '';
      throw new Error(toText(payload?.message) || 'PON schema is not initialized. Run Schema Update first.');
    }
    applyBackendRevision(payload);

    const activePppoeUsernames = Array.isArray(payload?.activePppoeUsernames) ? payload.activePppoeUsernames : [];
    state.livePppoeLookupAvailable = Boolean(payload?.subscriberStatusAvailable);
    state.activePppoeUsernamesLower = new Set(
      activePppoeUsernames
        .map((item) => toText(item).toLowerCase())
        .filter(Boolean)
    );

    const rawOlts = Array.isArray(payload?.olts) ? payload.olts : [];
    const rawNaps = Array.isArray(payload?.naps) ? payload.naps : [];
    state.olts = rawOlts.map((item) => normalizeOltRecord(item));
    state.naps = rawNaps.map((item) => normalizeNapRecord(item));
    syncState.loadedFromBackend = true;
    syncState.backendUnavailableReason = '';
    syncState.saveErrorNotified = false;
    return true;
  };

  const hasPonInventory = () => state.olts.length > 0 || state.naps.length > 0;

  const hydrateInitialPonData = async () => {
    let overviewError = null;

    try {
      await hydratePonOverviewFromBackend();
      if (hasPonInventory()) {
        return 'overview';
      }
    } catch (error) {
      overviewError = error;
    }

    try {
      await hydratePonStateFromBackend();
      if (overviewError && hasPonInventory()) {
        showToast(`Loaded saved PON inventory. Extra page data unavailable: ${overviewError.message}`, 'info');
      } else if (hasPonInventory()) {
        showToast('Recovered saved PON inventory from core backend state.', 'info');
      }
      return 'state';
    } catch (stateError) {
      if (!overviewError) {
        throw stateError;
      }
      const overviewMessage = toText(overviewError.message);
      const stateMessage = toText(stateError.message);
      const combinedMessage = overviewMessage && stateMessage && overviewMessage !== stateMessage
        ? `${overviewMessage} / ${stateMessage}`
        : stateMessage || overviewMessage || 'Failed to load PON data.';
      throw new Error(combinedMessage);
    }
  };

  const hasPendingBackendPersist = () => Boolean(
    syncState.saveTimer ||
    syncState.savePromise ||
    syncState.saveInFlight ||
    syncState.saveQueued
  );

  const restorePonWorkspaceFromBackend = async () => {
    try {
      await hydratePonStateFromBackend();
    } catch {
      // Leave current optimistic state if backend restore also fails.
    }
    renderPonWorkspace();
  };

  const commitPonChanges = async () => {
    try {
      await persistNow();
      return true;
    } catch (error) {
      if (error?.status !== 409 && error?.code !== 'PON_STATE_CONFLICT') {
        await restorePonWorkspaceFromBackend();
      }
      return false;
    }
  };

  const refreshPonStateFromBackend = async ({ silent = false } = {}) => {
    if (!syncState.loadedFromBackend || hasPendingBackendPersist()) return false;
    try {
      await hydratePonStateFromBackend();
      renderPonWorkspace();
      return true;
    } catch (error) {
      if (!silent) {
        showToast(`Failed to refresh PON status: ${error.message}`, 'error');
      }
      return false;
    }
  };

  const persist = () => {
    pruneOrphanNaps();
    queueBackendPersist();
  };

  const getNapEffectiveUsed = (nap) => {
    const capacity = Math.max(toNumber(nap?.capacity, 0), 0);
    const storedUsed = clamp(Math.max(toNumber(nap?.used, 0), 0), 0, capacity || Number.MAX_SAFE_INTEGER);
    const connectedCount = getNapConnections(nap).length;
    return Math.max(storedUsed, connectedCount);
  };

  const findOltByName = (name) => {
    const key = normalizeNameKey(name);
    if (!key) return null;
    return state.olts.find((item) => normalizeNameKey(item.name) === key) || null;
  };

  const getOltClientUsage = (olt) => {
    const oltKey = normalizeNameKey(olt?.name);
    if (!oltKey) {
      return { usedClients: 0, clientCapacity: 0 };
    }
    const ponPorts = Math.max(toNumber(olt?.ponPorts, 0), 0);
    const perPortCapacity = getPonCapacityByTechnology(olt?.technology);
    const clientCapacity = ponPorts * perPortCapacity;
    const usedClients = state.naps.reduce((sum, nap) => {
      if (normalizeNameKey(nap.linkedOlt) !== oltKey) return sum;
      return sum + getNapConnections(nap).length;
    }, 0);
    return {
      usedClients,
      clientCapacity
    };
  };

  const syncNapPonCapacityWithTechnology = () => {
    let changed = false;
    state.naps = state.naps.map((nap) => {
      const linkedOlt = findOltByName(nap.linkedOlt);
      if (!linkedOlt) return nap;
      const autoCapacity = getPonCapacityByTechnology(linkedOlt.technology);
      const current = Math.max(toNumber(nap.ponCapacity, 0), 1);
      if (current === autoCapacity) return nap;
      changed = true;
      return { ...nap, ponCapacity: autoCapacity };
    });
    return changed;
  };

  const usageBarClass = (percent) => {
    if (percent >= 95) return 'pon-usage__bar is-critical';
    if (percent >= 80) return 'pon-usage__bar is-warning';
    return 'pon-usage__bar';
  };

  const getPonRefOrder = (value) => {
    const normalized = normalizePonRef(value);
    const match = normalized.match(/^pon-(\d+)$/i);
    if (!match) return Number.POSITIVE_INFINITY;
    return Number(match[1]);
  };

  const getPortGroupsForOlt = (olt) => {
    const map = new Map();
    const linkedOlt = toText(olt?.name);
    if (!linkedOlt) return [];
    const totalPorts = Math.max(toNumber(olt?.ponPorts, 0), 0);
    const defaultPonCapacity = getPonCapacityByTechnology(olt?.technology);
    for (let port = 1; port <= totalPorts; port += 1) {
      const ponRef = `PON-${port}`;
      const key = `${linkedOlt}||${ponRef}`;
      map.set(key, {
        key,
        linkedOlt,
        ponRef,
        portName: getPonPortDisplayName(olt, ponRef),
        naps: [],
        ponCapacity: defaultPonCapacity,
        totalCapacity: 0,
        totalUsed: 0,
        totalCustomers: 0
      });
    }

    state.naps.forEach((nap) => {
      if (normalizeNameKey(nap.linkedOlt) !== normalizeNameKey(linkedOlt)) return;
      const ponRef = normalizePonRef(nap.ponRef) || 'PON-?';
      const key = `${linkedOlt}||${ponRef}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          linkedOlt,
          ponRef,
          portName: getPonPortDisplayName(olt, ponRef),
          naps: [],
          ponCapacity: defaultPonCapacity,
          totalCapacity: 0,
          totalUsed: 0,
          totalCustomers: 0
        });
      }
      const group = map.get(key);
      const napConnections = getNapConnections(nap);
      group.naps.push(nap);
      group.ponCapacity = Math.max(group.ponCapacity, Math.max(toNumber(nap.ponCapacity, 0), 0));
      group.totalCapacity += Math.max(toNumber(nap.capacity, 0), 0);
      group.totalUsed += getNapEffectiveUsed(nap);
      group.totalCustomers += napConnections.length;
    });

    return [...map.values()].sort((a, b) => {
      const aOrder = getPonRefOrder(a.ponRef);
      const bOrder = getPonRefOrder(b.ponRef);
      if (Number.isFinite(aOrder) && Number.isFinite(bOrder) && aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      if (Number.isFinite(aOrder) !== Number.isFinite(bOrder)) {
        return Number.isFinite(aOrder) ? -1 : 1;
      }
      return a.ponRef.localeCompare(b.ponRef);
    });
  };

  const renderOlts = () => {
    if (!oltTableBody) return;
    const query = state.oltSearch;
    const rows = state.olts.filter((item) => {
      const matchesQuery =
        matchesText(item.name, query) ||
        matchesText(item.technology, query) ||
        matchesText(item.site, query) ||
        matchesText(item.ponCodePrefix, query);
      return matchesQuery;
    });

    if (!rows.length) {
      oltTableBody.innerHTML = '<tr><td colspan="5" class="pon-empty"><div class="pon-empty__center">No matching OLT records.</div></td></tr>';
      return;
    }

    oltTableBody.innerHTML = rows
      .map((item) => {
        const { usedClients, clientCapacity } = getOltClientUsage(item);
        const used = clamp(usedClients, 0, clientCapacity || Number.MAX_SAFE_INTEGER);
        const total = clientCapacity;
        const percent = safePercent(used, total);
        const isExpanded = state.expandedOltIds.has(item.id);
        const portGroups = getPortGroupsForOlt(item);
        const portRows = portGroups.length
          ? portGroups
            .map((group) => {
              const ponCapacity = Math.max(toNumber(group.ponCapacity, 0), 0);
              const assignedCustomers = Math.max(toNumber(group.totalCustomers, 0), 0);
              const effectiveUsed = Math.max(toNumber(group.totalUsed, 0), 0);
              const clientUsed = clamp(assignedCustomers, 0, ponCapacity || Number.MAX_SAFE_INTEGER);
              const usagePercent = safePercent(clientUsed, ponCapacity);
              const portName = toText(group.portName) || group.ponRef;
              const customPortName = normalizeNameKey(portName) !== normalizeNameKey(group.ponRef);
              return `
                <tr data-linked-olt="${escapeHtml(group.linkedOlt)}" data-pon-ref="${escapeHtml(group.ponRef)}">
                  <td>
                    <button type="button" class="pon-port-link" data-action="open-port-naps" data-linked-olt="${escapeHtml(group.linkedOlt)}" data-pon-ref="${escapeHtml(group.ponRef)}">
                      <span class="pon-port-name">${escapeHtml(portName)}</span>
                      <span class="pon-port-ref">${customPortName ? escapeHtml(group.ponRef) : 'Default label'}</span>
                    </button>
                  </td>
                  <td>${ponCapacity}</td>
                  <td>${group.naps.length}</td>
                  <td>${group.totalCapacity}</td>
                  <td>${effectiveUsed}</td>
                  <td>${assignedCustomers}</td>
                  <td>
                    <div class="pon-usage">
                      <span class="pon-usage__text">${clientUsed}/${ponCapacity} (${usagePercent.toFixed(1)}%)</span>
                      <div class="${usageBarClass(usagePercent)}"><span style="width:${clamp(usagePercent, 0, 100).toFixed(1)}%;"></span></div>
                    </div>
                  </td>
                  <td class="actions-col">
                    <span class="pon-action-group">
                      <button type="button" class="pon-icon-btn pon-icon-btn--set" data-action="edit-pon-port-name" data-linked-olt="${escapeHtml(group.linkedOlt)}" data-pon-ref="${escapeHtml(group.ponRef)}" title="Edit PON port name" aria-label="Edit PON port name">
                        <i class="ti ti-pencil" aria-hidden="true"></i>
                      </button>
                      <button type="button" class="pon-icon-btn pon-icon-btn--add" data-action="add-nap-for-port" data-linked-olt="${escapeHtml(group.linkedOlt)}" data-pon-ref="${escapeHtml(group.ponRef)}" title="Add NAP" aria-label="Add NAP">
                        <i class="ti ti-plus" aria-hidden="true"></i>
                      </button>
                    </span>
                  </td>
                </tr>
              `;
            })
            .join('')
          : '<tr><td colspan="8" class="pon-empty">No PON ports available for this OLT.</td></tr>';

        const expandedRow = isExpanded
          ? `
            <tr class="pon-expand-row" data-parent-olt-id="${escapeHtml(item.id)}">
              <td colspan="5">
                <div class="pon-expand-card">
                  <p class="pon-expand-title">PON Ports: ${escapeHtml(item.name || '-')}</p>
                  <div class="table-wrapper">
                    <table class="pon-table pon-subtable" aria-label="PON ports for ${escapeHtml(item.name || 'OLT')}">
                      <thead>
                        <tr>
                          <th>PON Port / Name</th>
                          <th>Customer Capacity</th>
                          <th>Total NAP</th>
                          <th>Total Capacity</th>
                          <th>Used Ports</th>
                          <th>Assigned Customers</th>
                          <th>PON Usage</th>
                          <th class="actions-col">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${portRows}
                      </tbody>
                    </table>
                  </div>
                </div>
              </td>
            </tr>
          `
          : '';

        return `
          <tr data-olt-id="${escapeHtml(item.id)}" class="${isExpanded ? 'is-expanded' : ''}">
            <td>
              <button type="button" class="pon-olt-toggle ${isExpanded ? 'is-expanded' : ''}" data-action="toggle-olt-ports" data-olt-id="${escapeHtml(item.id)}">
                <i class="ti ti-chevron-right" aria-hidden="true"></i>
                <span>${escapeHtml(item.name || '-')}</span>
              </button>
            </td>
            <td>${escapeHtml(formatPonTechnology(item.technology))}</td>
            <td>${escapeHtml(item.site || '-')}</td>
            <td>
              <div class="pon-usage">
                <span class="pon-usage__text">${used}/${total} (${percent.toFixed(1)}%)</span>
                <div class="${usageBarClass(percent)}"><span style="width:${clamp(percent, 0, 100).toFixed(1)}%;"></span></div>
              </div>
            </td>
            <td class="actions-col">
              <div class="pon-action-group">
                <button class="pon-icon-btn" type="button" data-action="edit-olt" title="Edit OLT" aria-label="Edit OLT">
                  <i class="ti ti-edit" aria-hidden="true"></i>
                </button>
                <button class="pon-delete" type="button" data-action="delete-olt" title="Delete OLT" aria-label="Delete OLT">
                  <i class="ti ti-trash" aria-hidden="true"></i>
                </button>
              </div>
            </td>
          </tr>
          ${expandedRow}
        `;
      })
      .join('');
  };

  const rerender = () => {
    renderOlts();
  };

  const syncModalBodyState = () => {
    const hasOpenModal = Array.from(document.querySelectorAll('.pon-modal')).some((modal) =>
      modal.classList.contains('is-open')
    );
    document.body.classList.toggle('pon-modal-open', hasOpenModal);
  };

  const openModal = (modal, focusSelector = '') => {
    if (!modal) return;
    modal.removeAttribute('hidden');
    modal.classList.add('is-open');
    syncModalBodyState();
    if (focusSelector) {
      const input = modal.querySelector(focusSelector);
      if (input) {
        setTimeout(() => input.focus(), 0);
      }
    }
  };

  const closeModal = (modal) => {
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('hidden', '');
    syncModalBodyState();
  };

  const closeModalById = (id) => {
    const key = toText(id);
    if (!key) return;
    if (key === 'napModal' && state.reopenPortModalOnNapClose) {
      closeModal(napModal);
      state.reopenPortModalOnNapClose = false;
      if (state.selectedPort) {
        renderPortNapModal();
        openModal(portNapModal);
      }
      return;
    }
    closeModal(modalMap[key]);
  };

  const closeAllModals = () => {
    closeModal(oltModal);
    closeModal(napModal);
    closeModal(ponPortNameModal);
    closeModal(portNapModal);
    closeModal(napSubscribersModal);
    closeModal(napPortAssignModal);
    closeModal(napOpticalModal);
    closeModal(napConfigModal);
    closeModal(napMapModal);
  };

  const ensureLeafletLoaded = () => {
    if (window.L && typeof window.L.map === 'function') {
      return Promise.resolve(window.L);
    }
    if (ensureLeafletLoaded._promise) {
      return ensureLeafletLoaded._promise;
    }

    ensureLeafletLoaded._promise = new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${LEAFLET_CSS_URL}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = LEAFLET_CSS_URL;
        document.head.appendChild(link);
      }

      const existingScript = document.querySelector(`script[src="${LEAFLET_JS_URL}"]`);
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(window.L), { once: true });
        existingScript.addEventListener('error', () => {
          ensureLeafletLoaded._promise = null;
          reject(new Error('Leaflet failed to load.'));
        }, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = LEAFLET_JS_URL;
      script.onload = () => resolve(window.L);
      script.onerror = () => {
        ensureLeafletLoaded._promise = null;
        reject(new Error('Leaflet failed to load.'));
      };
      document.body.appendChild(script);
    });

    return ensureLeafletLoaded._promise;
  };

  const setNapMapMarker = (lat, lng) => {
    if (!napMapState.map || !window.L) return;
    if (!napMapState.marker) {
      napMapState.marker = window.L.marker([lat, lng], { zIndexOffset: 1000 }).addTo(napMapState.map);
    } else {
      napMapState.marker.setLatLng([lat, lng]);
    }
  };

  const clearNapMapMarker = () => {
    if (!napMapState.map || !napMapState.marker) return;
    napMapState.map.removeLayer(napMapState.marker);
    napMapState.marker = null;
  };

  const getAllNapCoordinatePoints = (excludeNapId = '') => {
    const excludeKey = toText(excludeNapId);
    return state.naps
      .filter((nap) => !excludeKey || toText(nap?.id) !== excludeKey)
      .map((nap) => {
        const parsed = parseFlexibleCoordinatePair(nap?.coordinate || nap?.coordinates || nap?.coords);
        if (!parsed) return null;
        return {
          lat: parsed.lat,
          lng: parsed.lng,
          code: toText(nap?.code) || 'NAP',
          location: toText(nap?.location)
        };
      })
      .filter(Boolean);
  };

  const renderNapReferenceMarkers = () => {
    if (!napMapState.map || !window.L || !napMapState.napMarkersLayer) return [];
    napMapState.napMarkersLayer.clearLayers();
    const points = getAllNapCoordinatePoints(state.selectedNapConfigId);
    points.forEach((point) => {
      const marker = window.L.marker([point.lat, point.lng], { zIndexOffset: -120 });
      const locationLine = point.location ? `
        <div class="list-group-item">
          <span class="map-popup-card__list-label"><i class="ti ti-map-pin" aria-hidden="true"></i> Location</span>
          <span class="map-popup-card__list-value">${escapeHtml(point.location)}</span>
        </div>
      ` : '';
      marker.bindPopup(
        `<div class="card map-popup-card">
          <div class="card-header">
            <span class="avatar avatar-sm bg-purple-lt text-purple map-popup-card__avatar"><i class="ti ti-network" aria-hidden="true"></i></span>
            <div class="map-popup-card__heading">
              <span class="map-popup-card__kicker">NAP Reference</span>
              <div class="map-popup-card__title">${escapeHtml(point.code)}</div>
            </div>
          </div>
          <div class="card-body map-popup-card__body">
            <div class="list-group list-group-flush map-popup-card__list">
              <div class="list-group-item">
                <span class="map-popup-card__list-label"><i class="ti ti-current-location" aria-hidden="true"></i> Coordinate</span>
                <span class="map-popup-card__list-value">${escapeHtml(formatCoordinatePair(point.lat, point.lng))}</span>
              </div>
              ${locationLine}
            </div>
          </div>
        </div>`,
        {
          className: 'network-map-popup pon-reference-popup',
          maxWidth: 330
        }
      );
      marker.addTo(napMapState.napMarkersLayer);
    });
    return points;
  };

  const setNapMapLayer = (requestedLayer) => {
    const layerKey = normalizeNapMapLayer(requestedLayer);
    napMapState.activeLayer = layerKey;
    writeNapMapLayerPreference(layerKey);
    updateNapMapLayerButtonState();

    if (!napMapState.map || !napMapState.tileLayers) return;

    Object.values(napMapState.tileLayers).forEach((layer) => {
      if (napMapState.map.hasLayer(layer)) {
        napMapState.map.removeLayer(layer);
      }
    });

    const targetLayer = napMapState.tileLayers[layerKey] || napMapState.tileLayers.satellite;
    targetLayer.addTo(napMapState.map);

    const maxZoom = getNapLayerMaxZoom(layerKey);
    napMapState.map.setMaxZoom(maxZoom);
    if (napMapState.map.getZoom() > maxZoom) {
      napMapState.map.setZoom(maxZoom);
    }
  };

  const ensureNapMap = () => {
    if (!napConfigMap || !window.L || napMapState.map) return Boolean(napMapState.map);

    napMapState.map = window.L.map(napConfigMap, { scrollWheelZoom: true }).setView(
      [DEFAULT_MAP_COORD.lat, DEFAULT_MAP_COORD.lng],
      13
    );
    napMapState.map.attributionControl?.setPrefix(false);
    napMapState.napMarkersLayer = window.L.layerGroup().addTo(napMapState.map);

    napMapState.tileLayers = {
      satellite: window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 22,
        maxNativeZoom: 18,
        detectRetina: true,
        keepBuffer: 4,
        attribution: '&copy; Esri',
        referrerPolicy: 'strict-origin-when-cross-origin'
      })
    };
    setNapMapLayer(napMapState.activeLayer);

    napMapState.map.on('click', (event) => {
      const lat = Number(event?.latlng?.lat);
      const lng = Number(event?.latlng?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      napMapState.selected = { lat, lng };
      setNapMapMarker(lat, lng);
      if (napConfigCoordinate) {
        napConfigCoordinate.value = formatCoordinatePair(lat, lng);
      }
    });

    return true;
  };

  const seedNapMapFromCoordinateInput = () => {
    if (!napMapState.map) return;
    const parsed = parseFlexibleCoordinatePair(napConfigCoordinate?.value);
    const target = parsed || DEFAULT_MAP_COORD;
    const zoomCap = getNapLayerMaxZoom();
    const zoom = parsed ? Math.min(16, zoomCap) : Math.min(13, zoomCap);
    const referencePoints = renderNapReferenceMarkers();

    napMapState.selected = parsed ? { ...parsed } : null;
    if (parsed) {
      setNapMapMarker(parsed.lat, parsed.lng);
    } else {
      clearNapMapMarker();
    }

    const boundsPoints = referencePoints.map((point) => [point.lat, point.lng]);
    if (parsed) boundsPoints.push([parsed.lat, parsed.lng]);

    if (boundsPoints.length) {
      napMapState.map.fitBounds(boundsPoints, {
        padding: [28, 28],
        maxZoom: Math.min(16, zoomCap)
      });
    } else {
      napMapState.map.setView([target.lat, target.lng], zoom);
    }

    setTimeout(() => {
      napMapState.map?.invalidateSize();
    }, 60);
  };

  const openNapMapPicker = () => {
    if (!napMapModal) return;
    ensureLeafletLoaded()
      .then(() => {
        const ready = ensureNapMap();
        if (!ready) {
          showToast('Map is not available right now.', 'error');
          return;
        }
        openModal(napMapModal);
        seedNapMapFromCoordinateInput();
      })
      .catch(() => {
        showToast('Failed to load map.', 'error');
      });
  };

  const applyNapMapSelection = () => {
    if (!napMapState.selected || !napConfigCoordinate) {
      showToast('Click on map to select a coordinate first.', 'error');
      return;
    }
    napConfigCoordinate.value = formatCoordinatePair(napMapState.selected.lat, napMapState.selected.lng);
    closeModal(napMapModal);
    napConfigCoordinate.focus();
  };

  const findNapById = (napId) => state.naps.find((item) => item.id === napId);

  const getSelectedPortNaps = () => {
    if (!state.selectedPort) return [];
    return state.naps
      .filter((nap) => {
        return normalizeNameKey(nap.linkedOlt) === normalizeNameKey(state.selectedPort.linkedOlt) &&
          normalizeNameKey(normalizePonRef(nap.ponRef)) === normalizeNameKey(normalizePonRef(state.selectedPort.ponRef));
      })
      .sort((left, right) => {
        const codeCompare = compareNapCodes(left?.code, right?.code);
        if (codeCompare !== 0) return codeCompare;
        const locationCompare = String(left?.location || '').localeCompare(String(right?.location || ''), undefined, {
          sensitivity: 'base',
          numeric: true
        });
        if (locationCompare !== 0) return locationCompare;
        return String(left?.id || '').localeCompare(String(right?.id || ''), undefined, {
          sensitivity: 'base',
          numeric: true
        });
      });
  };

  const renderPortNapModal = () => {
    if (!portNapTableBody || !portNapModalTitle || !portNapModalSubtitle) return;
    const selected = state.selectedPort;
    if (!selected) {
      portNapModalTitle.textContent = 'NAP List on Port';
      portNapModalSubtitle.textContent = 'Select a port from OLT Inventory.';
      portNapTableBody.innerHTML = '<tr><td colspan="7" class="pon-empty"><div class="pon-empty__center">No NAP records for this port.</div></td></tr>';
      return;
    }

    const naps = getSelectedPortNaps();
    const selectedOlt = findOltByName(selected.linkedOlt);
    const portDisplayName = getPonPortDisplayName(selectedOlt, selected.ponRef) || selected.ponRef;
    const ponCapacity = naps.reduce((max, nap) => Math.max(max, Math.max(toNumber(nap.ponCapacity, 0), 0)), 0);
    const assignedCustomers = naps.reduce((sum, nap) => sum + getNapConnections(nap).length, 0);
    portNapModalTitle.textContent = `NAP List: ${portDisplayName}`;
    portNapModalSubtitle.textContent = `OLT: ${selected.linkedOlt} | PON: ${selected.ponRef} | NAP Count: ${naps.length} | Customer Capacity: ${ponCapacity} | Assigned: ${assignedCustomers}`;

    if (!naps.length) {
      portNapTableBody.innerHTML = '<tr><td colspan="7" class="pon-empty"><div class="pon-empty__center">No NAP records for this port.</div></td></tr>';
      return;
    }

    portNapTableBody.innerHTML = naps
      .map((nap) => {
        const capacity = Math.max(toNumber(nap.capacity, 0), 0);
        const used = clamp(getNapEffectiveUsed(nap), 0, capacity || Number.MAX_SAFE_INTEGER);
        const percent = safePercent(used, capacity);
        const customerCount = getNapConnections(nap).length;
        const parsedCoordinate = parseFlexibleCoordinatePair(nap.coordinate);
        const coordinateDisplay = parsedCoordinate
          ? formatCoordinatePair(parsedCoordinate.lat, parsedCoordinate.lng)
          : toText(nap.coordinate) || '-';
        return `
          <tr data-nap-id="${escapeHtml(nap.id)}">
            <td>${escapeHtml(nap.code || '-')}</td>
            <td>${escapeHtml(nap.location || '-')}</td>
            <td class="pon-cell-coordinate">${escapeHtml(coordinateDisplay)}</td>
            <td>${escapeHtml(nap.splitter || '-')}</td>
            <td>
              <div class="pon-usage">
                <span class="pon-usage__text">${used}/${capacity} (${percent.toFixed(1)}%)</span>
                <div class="${usageBarClass(percent)}"><span style="width:${clamp(percent, 0, 100).toFixed(1)}%;"></span></div>
              </div>
            </td>
            <td>${customerCount}</td>
            <td class="actions-col">
              <span class="pon-action-group">
                <button type="button" class="pon-icon-btn pon-icon-btn--config" data-action="open-nap-config" data-nap-id="${escapeHtml(nap.id)}" title="Edit NAP" aria-label="Edit NAP">
                  <i class="ti ti-edit" aria-hidden="true"></i>
                </button>
                <button type="button" class="pon-delete" data-action="delete-nap-from-port" data-nap-id="${escapeHtml(nap.id)}" title="Delete NAP" aria-label="Delete NAP">
                  <i class="ti ti-trash" aria-hidden="true"></i>
                </button>
              </span>
            </td>
          </tr>
        `;
      })
      .join('');
  };

  const renderNapSubscribersModal = () => {
    if (!napSubscribersTableBody || !napSubscribersMeta || !napSubscribersModalTitle) return;
    const nap = findNapById(state.selectedNapId);
    if (!nap) {
      napSubscribersModalTitle.textContent = 'NAP Subscribers';
      napSubscribersMeta.textContent = 'No NAP selected.';
      napSubscribersTableBody.innerHTML = '<tr><td colspan="5" class="pon-empty">No port assignments yet.</td></tr>';
      return;
    }

    const connections = getNapConnections(nap);
    const splitPorts = getNapSplitPortCount(nap.splitter, nap.capacity);
    const maxConnectionPort = connections.reduce((max, entry) => Math.max(max, entry.port), 0);
    const totalPorts = Math.max(splitPorts, maxConnectionPort);
    const portMap = new Map();
    connections.forEach((entry) => {
      if (!portMap.has(entry.port)) {
        portMap.set(entry.port, []);
      }
      portMap.get(entry.port).push(entry);
    });

    napSubscribersModalTitle.textContent = `Subscribers: ${nap.code || 'NAP'}`;
    napSubscribersMeta.textContent = `OLT: ${nap.linkedOlt || '-'} | PON: ${nap.ponRef || '-'} | Split Ratio: ${nap.splitter || '-'} | Ports: ${totalPorts}`;

    if (totalPorts <= 0) {
      napSubscribersTableBody.innerHTML = '<tr><td colspan="5" class="pon-empty">No port assignments yet.</td></tr>';
      return;
    }

    napSubscribersTableBody.innerHTML = Array.from({ length: totalPorts }, (_, index) => index + 1)
      .map((portNo) => {
        const entries = portMap.get(portNo) || [];
        const subscriberStatus = resolvePortSubscriberStatus(entries);
        const customerText = entries.length
          ? entries.map((entry) => formatConnectionCustomerLabel(entry)).filter(Boolean).join(', ')
          : '-';
        const opticalText = entries.length
          ? entries.map((entry) => toText(entry.opticalInfo)).filter(Boolean).join(' | ')
          : '';
        const portLabel = String(portNo).padStart(2, '0');
        const portCodeBase = toText(nap.code) || 'NAP';
        const portCode = `${portCodeBase}-PORT-${portLabel}`;
        const useTitle = entries.length ? 'Replace customer' : 'Assign customer';
        const canSetOptical = entries.length > 0;
        const canRemoveAssignment = entries.length > 0;
        const setOpticalTitle = canSetOptical ? 'Set optical power' : 'Assign customer first';
        const removeTitle = canRemoveAssignment ? 'Remove customer from this port' : 'No customer assigned';
        return `
          <tr>
            <td><div class="pon-subs-cell-center"><span class="pon-port-pill">PORT ${portLabel}</span></div></td>
            <td><div class="pon-subs-cell-center"><span class="pon-subs-cell-text">${escapeHtml(portCode)}</span></div></td>
            <td class="pon-subscriber-status-cell"><div class="pon-subs-cell-center">${renderPortSubscriberStatus(subscriberStatus)}</div></td>
            <td>
              <div class="pon-cell-with-action">
                <span>${escapeHtml(customerText)}</span>
                <span class="pon-action-group">
                  <button
                    type="button"
                    class="pon-icon-btn pon-icon-btn--use"
                    data-action="assign-customer-to-port"
                    data-nap-id="${escapeHtml(nap.id)}"
                    data-port-no="${portNo}"
                    title="${escapeHtml(useTitle)}"
                    aria-label="${escapeHtml(useTitle)}"
                  >
                    <i class="ti ti-user-plus" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    class="pon-icon-btn pon-icon-btn--remove"
                    data-action="remove-customer-from-port"
                    data-nap-id="${escapeHtml(nap.id)}"
                    data-port-no="${portNo}"
                    title="${escapeHtml(removeTitle)}"
                    aria-label="${escapeHtml(removeTitle)}"
                    ${canRemoveAssignment ? '' : 'disabled'}
                  >
                    <i class="ti ti-user-minus" aria-hidden="true"></i>
                  </button>
                </span>
              </div>
            </td>
            <td>
              <div class="pon-cell-with-action">
                <span>${escapeHtml(opticalText)}</span>
                <button
                  type="button"
                  class="pon-icon-btn pon-icon-btn--set"
                  data-action="set-port-optical"
                  data-nap-id="${escapeHtml(nap.id)}"
                  data-port-no="${portNo}"
                  title="${escapeHtml(setOpticalTitle)}"
                  aria-label="${escapeHtml(setOpticalTitle)}"
                  ${canSetOptical ? '' : 'disabled'}
                >
                  <i class="ti ti-adjustments-horizontal" aria-hidden="true"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  };

  const renderNapPortAssignModal = () => {
    if (!napPortAssignTableBody || !napPortAssignTitle || !napPortAssignMeta) return;
    const selected = state.selectedNapPortAssignment;
    const nap = findNapById(selected?.napId);
    const portNo = toPositiveInt(selected?.portNo);
    if (!nap || !portNo) {
      napPortAssignTitle.textContent = 'Assign Customer';
      napPortAssignMeta.textContent = 'Select unassigned customer.';
      napPortAssignTableBody.innerHTML = '<tr><td colspan="5" class="pon-empty">No target port selected.</td></tr>';
      return;
    }

    const portLabel = String(portNo).padStart(2, '0');
    napPortAssignTitle.textContent = `Assign Customer: PORT ${portLabel}`;
    napPortAssignMeta.textContent = `NAP: ${nap.code || '-'} | OLT: ${nap.linkedOlt || '-'} | PON: ${nap.ponRef || '-'}`;

    const assignedKeys = getAssignedCustomerKeySet();
    const query = toText(state.customerAssignSearch).toLowerCase();
    const rows = state.customers.filter((customer) => {
      if (!customer?.key) return false;
      if (assignedKeys.has(customer.key)) return false;
      if (!query) return true;
      return (
        toText(customer.accountNumber).toLowerCase().includes(query) ||
        toText(customer.name).toLowerCase().includes(query) ||
        toText(customer.area).toLowerCase().includes(query)
      );
    });

    if (!rows.length) {
      napPortAssignTableBody.innerHTML = '<tr><td colspan="5" class="pon-empty">No unassigned customers found.</td></tr>';
      return;
    }

    napPortAssignTableBody.innerHTML = rows
      .map((customer) => {
        return `
          <tr data-customer-key="${escapeHtml(customer.key)}">
            <td>${escapeHtml(customer.accountNumber || '-')}</td>
            <td>${escapeHtml(customer.name || '-')}</td>
            <td>${escapeHtml(customer.area || '-')}</td>
            <td>${escapeHtml(customer.status || '-')}</td>
            <td class="actions-col">
              <button
                type="button"
                class="pon-icon-btn pon-icon-btn--use"
                data-action="confirm-assign-customer"
                data-customer-key="${escapeHtml(customer.key)}"
                title="Use customer"
                aria-label="Use customer"
              >
                <i class="ti ti-check" aria-hidden="true"></i>
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  };

  const openNapPortAssignModal = async (napId, portNo) => {
    const nap = findNapById(napId);
    const safePort = toPositiveInt(portNo);
    if (!nap || !safePort) return;

    state.selectedNapPortAssignment = { napId: toText(napId), portNo: safePort };
    state.customerAssignSearch = '';
    if (napPortAssignSearch) {
      napPortAssignSearch.value = '';
    }
    renderNapPortAssignModal();
    openModal(napPortAssignModal, '#napPortAssignSearch');

    const ok = await loadCustomers();
    if (!ok) {
      napPortAssignTableBody.innerHTML = '<tr><td colspan="5" class="pon-empty">Failed to load customers.</td></tr>';
      return;
    }
    renderNapPortAssignModal();
  };

  const assignCustomerToSelectedNapPort = async (customerKey) => {
    if (!canPersistPonChanges({ notify: true })) {
      return false;
    }
    const selected = state.selectedNapPortAssignment;
    const napId = toText(selected?.napId);
    const portNo = toPositiveInt(selected?.portNo);
    if (!napId || !portNo) {
      showToast('Select a target port first.', 'error');
      return false;
    }

    const customer = state.customers.find((item) => item.key === toCustomerKey(customerKey));
    if (!customer) {
      showToast('Customer not found.', 'error');
      return false;
    }

    const assignedKeys = getAssignedCustomerKeySet();
    if (assignedKeys.has(customer.key)) {
      showToast('Customer is already assigned to another port.', 'error');
      return false;
    }

    const index = state.naps.findIndex((item) => item.id === napId);
    if (index < 0) {
      showToast('NAP record not found.', 'error');
      return false;
    }

    const nap = state.naps[index];
    const existingConnections = getNapConnections(nap);
    const hasExistingPort = existingConnections.some((entry) => entry.port === portNo);
    if (hasExistingPort) {
      const confirmed = window.appConfirm
        ? await window.appConfirm(`PORT ${String(portNo).padStart(2, '0')} already has a customer. Replace it?`, { title: 'Replace Existing Customer' })
        : window.confirm(`PORT ${String(portNo).padStart(2, '0')} already has a customer. Replace it?`);
      if (!confirmed) return false;
    }

    const existingPortConnection = existingConnections.find((entry) => entry.port === portNo) || null;
    const opticalInfo = toText(existingPortConnection?.opticalInfo || nap.opticalPower);
    const nextConnections = existingConnections.filter((entry) => entry.port !== portNo);
    nextConnections.push({
      customerId: toText(customer.accountNumber),
      customerName: toText(customer.name),
      customerRef: toText(customer.accountNumber) || toText(customer.name) || 'CUSTOMER',
      port: portNo,
      opticalInfo,
      pppoeUsername: toText(customer.pppoeUsername)
    });
    nextConnections.sort((a, b) => a.port - b.port);

    const finalizedConnections = nextConnections.map((entry) => (
      entry.port === portNo
        ? { ...entry, subscriberStatus: resolveConnectionSubscriberStatus(entry) }
        : entry
    ));

    const capacity = Math.max(toNumber(nap.capacity, 0), 0);
    state.naps[index] = {
      ...nap,
      connections: finalizedConnections,
      used: clamp(finalizedConnections.length, 0, capacity || Number.MAX_SAFE_INTEGER)
    };

    persist();
    rerender();
    renderPortNapModal();
    renderNapSubscribersModal();
    renderNapPortAssignModal();
    showToast('Customer assigned to port.', 'success');
    closeModal(napPortAssignModal);
    return true;
  };

  const removeCustomerFromNapPort = async (napId, portNo) => {
    if (!canPersistPonChanges({ notify: true })) {
      return false;
    }
    const safeNapId = toText(napId);
    const safePort = toPositiveInt(portNo);
    if (!safeNapId || !safePort) {
      showToast('Select a valid port first.', 'error');
      return false;
    }

    const index = state.naps.findIndex((item) => item.id === safeNapId);
    if (index < 0) {
      showToast('NAP record not found.', 'error');
      return false;
    }

    const nap = state.naps[index];
    const connections = getNapConnections(nap);
    const targetConnection = connections.find((entry) => entry.port === safePort);
    if (!targetConnection) {
      showToast('No customer assigned on this port.', 'info');
      return false;
    }

    const portLabel = String(safePort).padStart(2, '0');
    const customerLabel = formatConnectionCustomerLabel(targetConnection);
    const confirmed = window.appConfirm
      ? await window.appConfirm(`Remove ${customerLabel || 'customer'} from PORT ${portLabel}?`, { title: 'Remove Assigned Customer' })
      : window.confirm(`Remove ${customerLabel || 'customer'} from PORT ${portLabel}?`);
    if (!confirmed) return false;

    const nextConnections = connections.filter((entry) => entry.port !== safePort);
    const capacity = Math.max(toNumber(nap.capacity, 0), 0);
    state.naps[index] = {
      ...nap,
      connections: nextConnections,
      used: clamp(nextConnections.length, 0, capacity || Number.MAX_SAFE_INTEGER)
    };

    const selectedOptical = state.selectedNapPortOptical;
    if (
      toText(selectedOptical?.napId) === safeNapId &&
      toPositiveInt(selectedOptical?.portNo) === safePort
    ) {
      state.selectedNapPortOptical = null;
      closeModal(napOpticalModal);
    }

    persist();
    rerender();
    renderPortNapModal();
    renderNapSubscribersModal();
    renderNapPortAssignModal();
    renderNapOpticalModal();
    showToast('Port assignment removed.', 'success');
    return true;
  };

  const renderNapOpticalModal = () => {
    if (!napOpticalTitle || !napOpticalMeta || !napOpticalValueInput) return;
    const selected = state.selectedNapPortOptical;
    const nap = findNapById(selected?.napId);
    const safePort = toPositiveInt(selected?.portNo);
    if (!nap || !safePort) {
      napOpticalTitle.textContent = 'Set Optical Power';
      napOpticalMeta.textContent = 'No target port selected.';
      napOpticalValueInput.value = '';
      return;
    }

    const connection = getNapConnections(nap).find((entry) => entry.port === safePort) || null;
    const portLabel = String(safePort).padStart(2, '0');
    napOpticalTitle.textContent = `Set Optical Power: PORT ${portLabel}`;
    napOpticalMeta.textContent = `NAP: ${nap.code || '-'} | Customer: ${formatConnectionCustomerLabel(connection)}`;
    napOpticalValueInput.value = toText(connection?.opticalInfo);
  };

  const openNapPortOpticalModal = (napId, portNo) => {
    const safeNapId = toText(napId);
    const safePort = toPositiveInt(portNo);
    if (!safeNapId || !safePort) return false;

    const nap = findNapById(safeNapId);
    if (!nap) {
      showToast('NAP record not found.', 'error');
      return false;
    }

    const targetConnection = getNapConnections(nap).find((entry) => entry.port === safePort);
    if (!targetConnection) {
      showToast('Assign customer first before setting optical power.', 'error');
      return false;
    }

    state.selectedNapPortOptical = { napId: safeNapId, portNo: safePort };
    renderNapOpticalModal();
    openModal(napOpticalModal, '#napOpticalValue');
    return true;
  };

  const saveNapPortOpticalInfo = (formData) => {
    if (!canPersistPonChanges({ notify: true })) {
      return false;
    }
    const selected = state.selectedNapPortOptical;
    const safeNapId = toText(selected?.napId);
    const safePort = toPositiveInt(selected?.portNo);
    if (!safeNapId || !safePort) {
      showToast('Select a target port first.', 'error');
      return false;
    }

    const index = state.naps.findIndex((item) => item.id === safeNapId);
    if (index < 0) {
      showToast('NAP record not found.', 'error');
      return false;
    }

    const nap = state.naps[index];
    const connections = getNapConnections(nap);
    const targetConnection = connections.find((entry) => entry.port === safePort);
    if (!targetConnection) {
      showToast('Assign customer first before setting optical power.', 'error');
      return false;
    }

    const nextOptical = toText(formData?.get('napOpticalValue') || napOpticalValueInput?.value);
    const nextConnections = connections.map((entry) =>
      entry.port === safePort ? { ...entry, opticalInfo: nextOptical } : entry
    );
    const capacity = Math.max(toNumber(nap.capacity, 0), 0);
    state.naps[index] = {
      ...nap,
      connections: nextConnections,
      used: clamp(nextConnections.length, 0, capacity || Number.MAX_SAFE_INTEGER)
    };

    persist();
    rerender();
    renderPortNapModal();
    renderNapSubscribersModal();
    renderNapPortAssignModal();
    renderNapOpticalModal();
    showToast('Optical power updated.', 'success');
    closeModal(napOpticalModal);
    return true;
  };

  const renderNapConfigModal = () => {
    if (!napConfigCode || !napConfigSplitter || !napConfigArea || !napConfigOpticalPower || !napConfigCoordinate) return;
    const nap = findNapById(state.selectedNapConfigId);

    if (!nap) {
      if (napConfigModalTitle) napConfigModalTitle.textContent = 'NAP Config';
      napConfigCode.value = '';
      napConfigSplitter.value = '1:16';
      renderNapAreaOptions('');
      napConfigOpticalPower.value = '';
      napConfigCoordinate.value = '';
      return;
    }

    if (napConfigModalTitle) {
      napConfigModalTitle.textContent = `NAP Config: ${nap.code || 'NAP'}`;
    }
    napConfigCode.value = toText(nap.code);
    napConfigSplitter.value = normalizeNapSplitter(nap.splitter);
    renderNapAreaOptions(toText(nap.location));
    napConfigOpticalPower.value = toText(nap.opticalPower);
    napConfigCoordinate.value = toText(nap.coordinate);
  };

  const openPortNapModal = (linkedOlt, ponRef) => {
    state.selectedPort = {
      linkedOlt: toText(linkedOlt),
      ponRef: normalizePonRef(ponRef)
    };
    renderPortNapModal();
    openModal(portNapModal);
  };

  const openPonPortNameForm = (linkedOlt, ponRef) => {
    if (!canPersistPonChanges({ notify: true })) return;
    const olt = findOltByName(linkedOlt);
    const normalizedRef = normalizePonRef(ponRef);
    if (!olt || !normalizedRef) {
      showToast('PON port not found.', 'error');
      return;
    }

    state.selectedPonPortName = {
      linkedOlt: toText(olt.name),
      ponRef: normalizedRef
    };
    const displayName = getPonPortDisplayName(olt, normalizedRef);
    if (ponPortRefValueInput) ponPortRefValueInput.value = normalizedRef;
    if (ponPortDisplayNameInput) {
      ponPortDisplayNameInput.value = hasCustomPonPortName(olt, normalizedRef) ? displayName : '';
      ponPortDisplayNameInput.placeholder = `Default: ${normalizedRef}`;
    }
    if (ponPortNameMeta) {
      ponPortNameMeta.textContent = `${toText(olt.name) || 'OLT'} • ${normalizedRef}`;
    }
    openModal(ponPortNameModal, '#ponPortDisplayName');
  };

  const savePonPortName = async (formData) => {
    if (!canPersistPonChanges({ notify: true })) {
      return false;
    }
    const selected = state.selectedPonPortName;
    const normalizedRef = normalizePonRef(selected?.ponRef || formData.get('ponPortRefValue'));
    const olt = findOltByName(selected?.linkedOlt);
    if (!olt || !normalizedRef) {
      showToast('PON port not found.', 'error');
      return false;
    }

    const displayName = toText(formData.get('ponPortDisplayName')).slice(0, 80);
    const names = normalizePonPortNames(olt.ponPortNames, olt.ponPorts);
    if (displayName && displayName.toLowerCase() !== normalizedRef.toLowerCase()) {
      names[normalizedRef] = displayName;
    } else {
      delete names[normalizedRef];
    }
    olt.ponPortNames = normalizePonPortNames(names, olt.ponPorts);

    renderPonWorkspace();
    const committed = await commitPonChanges();
    if (!committed) return false;
    showToast(displayName ? 'PON port name updated.' : 'PON port name reset to default.', 'success');
    return true;
  };

  const openNapSubscribers = (napId) => {
    state.selectedNapId = toText(napId);
    renderNapSubscribersModal();
    openModal(napSubscribersModal);
    refreshPonStateFromBackend({ silent: true }).catch(() => {});
  };

  const openNapConfig = (napId) => {
    state.selectedNapConfigId = toText(napId);
    renderNapConfigModal();
    openModal(napConfigModal, '#napConfigCode');
    loadCoverageAreas().then(() => {
      renderNapConfigModal();
    });
  };

  const openNapFormForPort = (linkedOlt, ponRef, options = {}) => {
    if (!napForm || !napModal) return;
    const safeLinkedOlt = toText(linkedOlt);
    const safePonRef = normalizePonRef(ponRef);
    if (!safeLinkedOlt || !safePonRef) {
      showToast('Select a valid OLT port first.', 'error');
      return;
    }

    state.selectedPort = { linkedOlt: safeLinkedOlt, ponRef: safePonRef };
    const reopenPortModal = Boolean(options.reopenPortModal);
    napForm.reset();
    renderNapAddAreaOptions('');
    state.reopenPortModalOnNapClose = reopenPortModal;
    updateNapCodePreview();
    if (reopenPortModal) {
      closeModal(portNapModal);
    }
    openModal(napModal, '#napCount');
    loadCoverageAreas().then(() => {
      renderNapAddAreaOptions(toText(napArea?.value));
    });
  };

  const openNapFormForSelectedPort = () => {
    if (!state.selectedPort) return;
    openNapFormForPort(state.selectedPort.linkedOlt, state.selectedPort.ponRef, { reopenPortModal: true });
  };

  const setOltFormMode = (mode = 'add', olt = null) => {
    const normalizedMode = mode === 'edit' ? 'edit' : 'add';
    const editingId = normalizedMode === 'edit' ? toText(olt?.id) : '';
    if (oltForm) {
      oltForm.dataset.mode = normalizedMode;
      oltForm.dataset.editingId = editingId;
    }
    if (oltModalTitle) {
      oltModalTitle.innerHTML = normalizedMode === 'edit'
        ? '<i class="ti ti-edit" aria-hidden="true"></i> Edit OLT'
        : '<i class="ti ti-server" aria-hidden="true"></i> Add OLT';
    }
    if (oltSubmitBtn) {
      oltSubmitBtn.innerHTML = normalizedMode === 'edit'
        ? '<i class="ti ti-device-floppy" aria-hidden="true"></i> Save changes'
        : '<i class="ti ti-plus" aria-hidden="true"></i> Add OLT';
    }
  };

  const resetOltForm = () => {
    oltForm?.reset();
    setOltFormMode('add');
  };

  const openOltFormForCreate = () => {
    if (!oltModal) return;
    resetOltForm();
    openModal(oltModal, '#oltName');
  };

  const openOltFormForEdit = (id) => {
    if (!oltModal || !oltForm) return;
    const target = state.olts.find((item) => item.id === toText(id));
    if (!target) {
      showToast('OLT record not found.', 'error');
      return;
    }
    oltForm.reset();
    setOltFormMode('edit', target);
    if (oltNameInput) oltNameInput.value = toText(target.name);
    if (oltTechnologyInput) oltTechnologyInput.value = normalizePonTechnology(target.technology);
    if (oltSiteInput) oltSiteInput.value = toText(target.site);
    if (oltPonPortsInput) oltPonPortsInput.value = String(clamp(toNonNegativeInt(target.ponPorts, 0), 0, 4096));
    if (oltPonCodePrefixInput) oltPonCodePrefixInput.value = normalizePonCodePrefix(target.ponCodePrefix);
    openModal(oltModal, '#oltName');
  };

  const saveOlt = async (formData) => {
    if (!canPersistPonChanges({ notify: true })) {
      return false;
    }
    const editingId = toText(oltForm?.dataset.editingId);
    const targetIndex = editingId ? state.olts.findIndex((item) => item.id === editingId) : -1;
    const target = targetIndex >= 0 ? state.olts[targetIndex] : null;
    const name = toText(formData.get('oltName'));
    const technology = normalizePonTechnology(formData.get('oltTechnology'));
    const site = toText(formData.get('oltSite'));
    const status = 'online';
    const ponCodePrefix = normalizePonCodePrefix(formData.get('oltPonCodePrefix'));
    const ponPorts = clamp(toNonNegativeInt(formData.get('oltPonPorts'), 0), 0, 4096);

    if (!name || !site) {
      showToast('OLT name and site are required.', 'error');
      return false;
    }

    const duplicate = state.olts.some((item) => (
      item.id !== editingId &&
      normalizeNameKey(item.name) === normalizeNameKey(name)
    ));
    if (duplicate) {
      showToast('OLT name already exists.', 'error');
      return false;
    }

    if (target) {
      const previousOltKey = normalizeNameKey(target.name);
      const nextOltKey = normalizeNameKey(name);
      state.olts[targetIndex] = {
        ...target,
        name,
        technology,
        site,
        status,
        ponCodePrefix,
        ponPorts,
        ponPortNames: normalizePonPortNames(target.ponPortNames, ponPorts)
      };

      if (previousOltKey && previousOltKey !== nextOltKey) {
        state.naps = state.naps.map((item) => {
          if (normalizeNameKey(item.linkedOlt) !== previousOltKey) return item;
          return {
            ...item,
            linkedOlt: name
          };
        });
        if (state.selectedPort && normalizeNameKey(state.selectedPort.linkedOlt) === previousOltKey) {
          state.selectedPort = {
            ...state.selectedPort,
            linkedOlt: name
          };
        }
        if (state.selectedPonPortName && normalizeNameKey(state.selectedPonPortName.linkedOlt) === previousOltKey) {
          state.selectedPonPortName = {
            ...state.selectedPonPortName,
            linkedOlt: name
          };
        }
      }
    } else {
      state.olts.push({
        id: `olt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name,
        technology,
        site,
        status,
        ponCodePrefix,
        ponPorts,
        ponPortNames: {}
      });
    }
    syncNapPonCapacityWithTechnology();
    renderPonWorkspace();
    const committed = await commitPonChanges();
    if (!committed) return false;
    showToast(target ? 'OLT record updated.' : 'OLT record added.', 'success');
    return true;
  };

  const addNap = async (formData) => {
    if (!canPersistPonChanges({ notify: true })) {
      return false;
    }
    const napCountValue = Number(formData.get('napCount'));
    const napCountRaw = Number.isInteger(napCountValue) ? napCountValue : 0;
    const napCount = clamp(napCountRaw, 0, NAP_BATCH_LIMIT);
    const codePrefix = normalizeNapCodePrefix(formData.get('napCodePrefix'));
    const linkedOlt = toText(state.selectedPort?.linkedOlt);
    const ponRef = normalizePonRef(state.selectedPort?.ponRef);
    const location = normalizeAreaName(formData.get('napArea'));
    const splitter = normalizeNapSplitter(formData.get('napSplitter'));
    const capacity = getNapSplitPortCount(splitter, 16);
    const used = 0;
    const connections = [];

    if (!codePrefix) {
      showToast('NAP code prefix is required.', 'error');
      return false;
    }
    if (napCount <= 0) {
      showToast('Total NAP must be at least 1.', 'error');
      return false;
    }
    if (!location) {
      showToast('Area is required.', 'error');
      return false;
    }

    if (!linkedOlt || !ponRef) {
      showToast('Select an OLT port first before adding NAP.', 'error');
      return false;
    }

    const oltRecord = findOltByName(linkedOlt);
    if (!oltRecord) {
      showToast('Select a valid linked OLT.', 'error');
      return false;
    }
    const ponCapacity = getPonCapacityByTechnology(oltRecord.technology);

    const samePortExisting = state.naps.find((item) => {
      return normalizeNameKey(item.linkedOlt) === normalizeNameKey(linkedOlt) &&
        normalizeNameKey(normalizePonRef(item.ponRef)) === normalizeNameKey(ponRef);
    });
    if (samePortExisting && Math.max(toNumber(samePortExisting.ponCapacity, 0), 0) !== ponCapacity) {
      showToast(`This OLT type requires ${ponCapacity} max customers per PON port.`, 'error');
      return false;
    }
    const codeContext = { linkedOlt, ponRef };
    const startSequence = getNextNapCodeSequence(codePrefix, codeContext);
    const generatedCodes = buildNapCodes(codePrefix, napCount, startSequence, codeContext);

    const existingCodes = new Set(
      state.naps.map((item) => normalizeNameKey(item.code))
    );
    const conflictingCode = generatedCodes.find((code) => existingCodes.has(normalizeNameKey(code)));
    if (conflictingCode) {
      showToast(`NAP code already exists: ${conflictingCode}.`, 'error');
      return false;
    }

    const newRecords = generatedCodes.map((code) => ({
      id: `nap-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      code,
      location,
      coordinate: '',
      splitter,
      linkedOlt,
      ponRef,
      ponCapacity,
      capacity,
      used,
      opticalPower: '',
      connections
    }));

    state.naps = [...newRecords, ...state.naps];
    renderPonWorkspace();
    const committed = await commitPonChanges();
    if (!committed) return false;
    updateNapCodePreview();
    showToast(napCount === 1 ? 'NAP record added.' : `${napCount} NAP records added.`, 'success');
    return true;
  };

  const updateNapConfig = async (formData) => {
    if (!canPersistPonChanges({ notify: true })) {
      return false;
    }
    const napId = toText(state.selectedNapConfigId);
    if (!napId) {
      showToast('No NAP selected.', 'error');
      return false;
    }

    const index = state.naps.findIndex((item) => item.id === napId);
    if (index < 0) {
      showToast('NAP record not found.', 'error');
      return false;
    }

    const code = toText(formData.get('napConfigCode')).toUpperCase();
    const splitter = normalizeNapSplitter(formData.get('napConfigSplitter'));
    const locationRaw = toText(formData.get('napConfigArea'));
    const location = normalizeNameKey(locationRaw) === 'unspecified' ? '' : locationRaw;
    const opticalPower = toText(formData.get('napConfigOpticalPower'));
    const coordinate = toText(formData.get('napConfigCoordinate'));

    if (!code) {
      showToast('NAP code is required.', 'error');
      return false;
    }
    if (!location) {
      showToast('Area is required.', 'error');
      return false;
    }

    const duplicate = state.naps.some((item) => {
      return item.id !== napId && normalizeNameKey(item.code) === normalizeNameKey(code);
    });
    if (duplicate) {
      showToast('NAP code already exists.', 'error');
      return false;
    }

    const current = state.naps[index];
    const nextCapacity = getNapSplitPortCount(splitter, current?.capacity);
    state.naps[index] = {
      ...current,
      code,
      splitter,
      location,
      opticalPower,
      capacity: nextCapacity,
      used: clamp(Math.max(toNumber(current?.used, 0), 0), 0, nextCapacity),
      coordinate
    };

    renderPonWorkspace();
    const committed = await commitPonChanges();
    if (!committed) return false;
    showToast('NAP config updated.', 'success');
    return true;
  };

  const clearNapSelectionState = (removedNapIds) => {
    const removedSet = removedNapIds instanceof Set ? removedNapIds : new Set(removedNapIds || []);
    if (!removedSet.size) return;

    const hasRemoved = (value) => removedSet.has(toText(value));
    let needsSubscribersRender = false;
    let needsConfigRender = false;
    let needsAssignRender = false;
    let needsOpticalRender = false;

    if (hasRemoved(state.selectedNapId)) {
      state.selectedNapId = '';
      closeModal(napSubscribersModal);
      needsSubscribersRender = true;
    }
    if (hasRemoved(state.selectedNapConfigId)) {
      state.selectedNapConfigId = '';
      closeModal(napConfigModal);
      needsConfigRender = true;
    }
    if (hasRemoved(state.selectedNapPortAssignment?.napId)) {
      state.selectedNapPortAssignment = null;
      closeModal(napPortAssignModal);
      needsAssignRender = true;
    }
    if (hasRemoved(state.selectedNapPortOptical?.napId)) {
      state.selectedNapPortOptical = null;
      closeModal(napOpticalModal);
      needsOpticalRender = true;
    }

    if (needsSubscribersRender) renderNapSubscribersModal();
    if (needsConfigRender) renderNapConfigModal();
    if (needsAssignRender) renderNapPortAssignModal();
    if (needsOpticalRender) renderNapOpticalModal();
  };

  const pruneOrphanNaps = () => {
    if (!state.naps.length) return 0;
    const validOltNames = new Set(
      state.olts
        .map((item) => normalizeNameKey(item.name))
        .filter(Boolean)
    );
    if (!validOltNames.size) {
      const removedNapIds = new Set(
        state.naps
          .map((item) => toText(item.id))
          .filter(Boolean)
      );
      state.naps = [];
      clearNapSelectionState(removedNapIds);
      if (state.selectedPort) {
        state.selectedPort = null;
        state.reopenPortModalOnNapClose = false;
        closeModal(portNapModal);
      }
      return removedNapIds.size;
    }

    const removedNapIds = new Set();
    state.naps = state.naps.filter((item) => {
      const linkedKey = normalizeNameKey(item.linkedOlt);
      if (linkedKey && validOltNames.has(linkedKey)) return true;
      const napId = toText(item.id);
      if (napId) removedNapIds.add(napId);
      return false;
    });

    if (removedNapIds.size > 0) {
      clearNapSelectionState(removedNapIds);
      if (
        state.selectedPort &&
        !validOltNames.has(normalizeNameKey(state.selectedPort.linkedOlt))
      ) {
        state.selectedPort = null;
        state.reopenPortModalOnNapClose = false;
        closeModal(portNapModal);
      }
    }

    return removedNapIds.size;
  };

  const deleteOlt = async (id) => {
    if (!canPersistPonChanges({ notify: true })) {
      return false;
    }
    const target = state.olts.find((item) => item.id === id);
    if (!target) return false;
    const oltNameKey = normalizeNameKey(target.name);

    state.olts = state.olts.filter((item) => item.id !== id);
    state.expandedOltIds.delete(id);

    const removedNapIds = new Set();
    state.naps = state.naps.filter((item) => {
      if (normalizeNameKey(item.linkedOlt) !== oltNameKey) return true;
      const napId = toText(item.id);
      if (napId) removedNapIds.add(napId);
      return false;
    });

    if (state.selectedPort && normalizeNameKey(state.selectedPort.linkedOlt) === oltNameKey) {
      state.selectedPort = null;
      state.reopenPortModalOnNapClose = false;
      closeModal(portNapModal);
    }
    if (state.selectedPonPortName && normalizeNameKey(state.selectedPonPortName.linkedOlt) === oltNameKey) {
      state.selectedPonPortName = null;
      closeModal(ponPortNameModal);
    }

    clearNapSelectionState(removedNapIds);
    renderPonWorkspace();
    const committed = await commitPonChanges();
    if (!committed) return false;
    const removedCount = removedNapIds.size;
    if (removedCount > 0) {
      showToast(`OLT removed with ${removedCount} linked NAP ${removedCount === 1 ? 'record' : 'records'}.`, 'success');
      return true;
    }
    showToast('OLT record removed.', 'success');
    return true;
  };

  const deleteNap = async (id) => {
    if (!canPersistPonChanges({ notify: true })) {
      return false;
    }
    const before = state.naps.length;
    state.naps = state.naps.filter((item) => item.id !== id);
    if (state.naps.length === before) return false;

    clearNapSelectionState(new Set([toText(id)]));

    renderPonWorkspace();
    const committed = await commitPonChanges();
    if (!committed) return false;
    showToast('NAP record removed.', 'success');
    return true;
  };

  const toggleOltExpansion = (id) => {
    const key = toText(id);
    if (!key) return;
    if (state.expandedOltIds.has(key)) {
      state.expandedOltIds.clear();
    } else {
      state.expandedOltIds.clear();
      state.expandedOltIds.add(key);
    }
    renderOlts();
  };

  const bindEvents = () => {
    if (eventsBound) return;
    eventsBound = true;
    openOltModalBtn?.addEventListener('click', () => {
      if (!canPersistPonChanges({ notify: true })) return;
      closeAllModals();
      state.reopenPortModalOnNapClose = false;
      openOltFormForCreate();
    });
    openNapModalBtn?.addEventListener('click', () => {
      if (!canPersistPonChanges({ notify: true })) return;
      closeAllModals();
      state.reopenPortModalOnNapClose = false;
      state.selectedPort = null;
      updateNapCodePreview();
      openModal(napModal, '#napCount');
    });
    openNapFromPortBtn?.addEventListener('click', () => {
      if (!canPersistPonChanges({ notify: true })) return;
      openNapFormForSelectedPort();
    });
    openNapMapBtn?.addEventListener('click', () => {
      openNapMapPicker();
    });
    applyNapMapBtn?.addEventListener('click', () => {
      applyNapMapSelection();
    });
    napMapLayerButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const layer = button.getAttribute('data-nap-map-layer');
        setNapMapLayer(layer);
      });
    });

    document.querySelectorAll('[data-pon-modal-close]').forEach((button) => {
      button.addEventListener('click', () => {
        closeModalById(button.getAttribute('data-pon-modal-close'));
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (napModal?.classList.contains('is-open') && state.reopenPortModalOnNapClose) {
          closeModalById('napModal');
          return;
        }
        closeAllModals();
      }
    });

    window.addEventListener('beforeunload', (event) => {
      if (!hasPendingBackendPersist()) return;
      event.preventDefault();
      event.returnValue = '';
    });

    oltForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = await saveOlt(new FormData(oltForm));
      if (ok) {
        resetOltForm();
        closeModal(oltModal);
      }
    });

    napForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = await addNap(new FormData(napForm));
      if (ok) {
        napForm.reset();
        state.reopenPortModalOnNapClose = false;
        closeModal(napModal);
      }
    });
    napConfigForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = await updateNapConfig(new FormData(napConfigForm));
      if (ok) {
        closeModal(napConfigModal);
      }
    });
    ponPortNameForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = await savePonPortName(new FormData(ponPortNameForm));
      if (ok) {
        ponPortNameForm.reset();
        state.selectedPonPortName = null;
        closeModal(ponPortNameModal);
      }
    });
    napOpticalForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = await saveNapPortOpticalInfo(new FormData(napOpticalForm));
      if (!ok) return;
      napOpticalForm.reset();
    });
    napCountInput?.addEventListener('input', () => {
      updateNapCodePreview();
    });
    napCodePrefixInput?.addEventListener('input', () => {
      updateNapCodePreview();
    });
    napPortAssignSearch?.addEventListener('input', (event) => {
      state.customerAssignSearch = toText(event.target?.value);
      renderNapPortAssignModal();
    });

    oltSearchInput?.addEventListener('input', (event) => {
      state.oltSearch = toText(event.target.value).toLowerCase();
      renderOlts();
    });

    oltTableBody?.addEventListener('click', async (event) => {
      const trigger = event.target.closest('[data-action="open-port-naps"]');
      if (trigger) {
        const linkedOlt = trigger.getAttribute('data-linked-olt');
        const ponRef = trigger.getAttribute('data-pon-ref');
        if (!linkedOlt || !ponRef) return;
        openPortNapModal(linkedOlt, ponRef);
        return;
      }

      const addNapBtn = event.target.closest('[data-action="add-nap-for-port"]');
      if (addNapBtn) {
        const linkedOlt = addNapBtn.getAttribute('data-linked-olt');
        const ponRef = addNapBtn.getAttribute('data-pon-ref');
        if (!linkedOlt || !ponRef) return;
        state.reopenPortModalOnNapClose = false;
        openNapFormForPort(linkedOlt, ponRef);
        return;
      }

      const editPonPortNameBtn = event.target.closest('[data-action="edit-pon-port-name"]');
      if (editPonPortNameBtn) {
        const linkedOlt = editPonPortNameBtn.getAttribute('data-linked-olt');
        const ponRef = editPonPortNameBtn.getAttribute('data-pon-ref');
        if (!linkedOlt || !ponRef) return;
        state.reopenPortModalOnNapClose = false;
        openPonPortNameForm(linkedOlt, ponRef);
        return;
      }

      const ponRow = event.target.closest('tr[data-linked-olt][data-pon-ref]');
      if (ponRow && oltTableBody.contains(ponRow)) {
        const linkedOlt = ponRow.getAttribute('data-linked-olt');
        const ponRef = ponRow.getAttribute('data-pon-ref');
        if (!linkedOlt || !ponRef) return;
        openPortNapModal(linkedOlt, ponRef);
        return;
      }

      const deleteBtn = event.target.closest('[data-action="delete-olt"]');
      if (deleteBtn) {
        const row = deleteBtn.closest('tr');
        const id = row ? row.getAttribute('data-olt-id') : '';
        if (!id) return;
        const target = state.olts.find((item) => item.id === id);
        const linkedNapCount = state.naps.filter((item) => (
          normalizeNameKey(item.linkedOlt) === normalizeNameKey(target?.name)
        )).length;
        const prompt = linkedNapCount > 0
          ? `Delete this OLT and ${linkedNapCount} linked NAP ${linkedNapCount === 1 ? 'record' : 'records'}?`
          : 'Delete this OLT record?';
        const confirmed = window.appConfirm
          ? await window.appConfirm(prompt, { title: 'Delete OLT' })
          : window.confirm(prompt);
        if (!confirmed) return;
        await deleteOlt(id);
        return;
      }

      const editBtn = event.target.closest('[data-action="edit-olt"]');
      if (editBtn) {
        const row = editBtn.closest('tr[data-olt-id]');
        const id = row ? row.getAttribute('data-olt-id') : '';
        if (!id) return;
        closeAllModals();
        state.reopenPortModalOnNapClose = false;
        openOltFormForEdit(id);
        return;
      }

      const oltRow = event.target.closest('tr[data-olt-id]');
      if (!oltRow) return;
      toggleOltExpansion(oltRow.getAttribute('data-olt-id'));
    });

    portNapTableBody?.addEventListener('click', async (event) => {
      const configBtn = event.target.closest('[data-action="open-nap-config"]');
      if (configBtn) {
        const napId = configBtn.getAttribute('data-nap-id');
        if (napId) openNapConfig(napId);
        return;
      }

      const deleteBtn = event.target.closest('[data-action="delete-nap-from-port"]');
      if (deleteBtn) {
        const napId = deleteBtn.getAttribute('data-nap-id');
        if (!napId) return;
        const confirmed = window.appConfirm
          ? await window.appConfirm('Delete this NAP record?', { title: 'Delete NAP' })
          : window.confirm('Delete this NAP record?');
        if (!confirmed) return;
        await deleteNap(napId);
        return;
      }

      const napRow = event.target.closest('tr[data-nap-id]');
      if (!napRow || !portNapTableBody.contains(napRow)) return;
      const napId = napRow.getAttribute('data-nap-id');
      if (!napId) return;
      openNapSubscribers(napId);
    });

    napSubscribersTableBody?.addEventListener('click', (event) => {
      const useBtn = event.target.closest('[data-action="assign-customer-to-port"]');
      if (!useBtn) return;
      const napId = useBtn.getAttribute('data-nap-id');
      const portNo = useBtn.getAttribute('data-port-no');
      if (!napId || !portNo) return;
      openNapPortAssignModal(napId, portNo);
    });

    napSubscribersTableBody?.addEventListener('click', (event) => {
      const setBtn = event.target.closest('[data-action="set-port-optical"]');
      if (!setBtn) return;
      const napId = setBtn.getAttribute('data-nap-id');
      const portNo = setBtn.getAttribute('data-port-no');
      if (!napId || !portNo) return;
      openNapPortOpticalModal(napId, portNo);
    });

    napSubscribersTableBody?.addEventListener('click', async (event) => {
      const removeBtn = event.target.closest('[data-action="remove-customer-from-port"]');
      if (!removeBtn) return;
      const napId = removeBtn.getAttribute('data-nap-id');
      const portNo = removeBtn.getAttribute('data-port-no');
      if (!napId || !portNo) return;
      await removeCustomerFromNapPort(napId, portNo);
    });

    napPortAssignTableBody?.addEventListener('click', async (event) => {
      const assignBtn = event.target.closest('[data-action="confirm-assign-customer"]');
      if (!assignBtn) return;
      const customerKey = assignBtn.getAttribute('data-customer-key');
      if (!customerKey) return;
      await assignCustomerToSelectedNapPort(customerKey);
    });
  };

  const init = async () => {
    bindEvents();
    syncPonMutationUi();
    napMapState.activeLayer = readNapMapLayerPreference();
    updateNapMapLayerButtonState();
    clearLegacyPonLocalCache();

    let loadedFromBackend = false;
    try {
      const loadMode = await hydrateInitialPonData();
      loadedFromBackend = Boolean(loadMode);
    } catch (error) {
      loadedFromBackend = false;
      state.olts = [];
      state.naps = [];
      syncState.revision = '';
      syncState.backendUnavailableReason = error.message || 'Failed to load PON data.';
      showToast(`PON backend unavailable: ${error.message}`, 'error');
    }
    syncPonMutationUi();

    const orphanNapCount = pruneOrphanNaps();
    const didNormalizeCapacity = syncNapPonCapacityWithTechnology();
    updateNapCodePreview();
    rerender();
    renderPortNapModal();
    renderNapSubscribersModal();
    renderNapOpticalModal();
    renderNapConfigModal();

    if (loadedFromBackend && (didNormalizeCapacity || orphanNapCount > 0)) {
      queueBackendPersist();
      if (orphanNapCount > 0) {
        showToast('Removed NAP records linked to missing OLTs.', 'info');
      }
    }
  };

  init().catch((error) => {
    showToast(`Failed to initialize PON management: ${error.message}`, 'error');
  });
})();
