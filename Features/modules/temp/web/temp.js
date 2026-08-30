(() => {
    'use strict';

    const API_ROOT = '/api/temp';
    const TEMP_PLAN_RATES = Object.freeze({
        'Old plan': 700,
        Basic: 800,
        Standard: 1000,
        Premium: 1200
    });
    const TEMP_SERVICE_ADDRESSES = Object.freeze(['Poblacion', 'Masical']);
    const TEMP_PLAN_TYPES = Object.freeze(['prepaid', 'postpaid', 'prorate']);
    const TEMP_BILLING_SCHEDULE_MODES = Object.freeze(['date', 'day']);
    const MANILA_TIME_ZONE = 'Asia/Manila';
    const GCASH_MAX_ALLOCATIONS = 3;
    const TABLE_SORT_OPTIONS = Object.freeze({
        customer: Object.freeze({
            account: Object.freeze(['account-asc', 'account-desc']),
            name: Object.freeze(['name-asc', 'name-desc']),
            address: Object.freeze(['address-poblacion', 'address-masical']),
            plan: Object.freeze(['plan-asc', 'plan-desc']),
            'plan-type': Object.freeze(['plan-type-asc', 'plan-type-desc']),
            billing: Object.freeze(['billing-asc', 'billing-desc']),
            balance: Object.freeze(['balance-desc', 'balance-asc']),
            status: Object.freeze(['status-active', 'status-inactive'])
        }),
        payment: Object.freeze({
            date: Object.freeze(['date-desc', 'date-asc']),
            receipt: Object.freeze(['receipt-desc', 'receipt-asc']),
            customer: Object.freeze(['customer-asc', 'customer-desc']),
            amount: Object.freeze(['amount-desc', 'amount-asc'])
        })
    });
    const SORT_DESCRIPTIONS = Object.freeze({
        'account-asc': 'account number ascending',
        'account-desc': 'account number descending',
        'name-asc': 'customer name A to Z',
        'name-desc': 'customer name Z to A',
        'address-poblacion': 'Poblacion first',
        'address-masical': 'Masical first',
        'plan-asc': 'lowest plan rate first',
        'plan-desc': 'highest plan rate first',
        'plan-type-asc': 'plan type A to Z',
        'plan-type-desc': 'plan type Z to A',
        'billing-asc': 'earliest billing day first',
        'billing-desc': 'latest billing day first',
        'balance-desc': 'highest balance first',
        'balance-asc': 'lowest balance first',
        'status-active': 'active customers first',
        'status-inactive': 'inactive customers first',
        'date-desc': 'newest date first',
        'date-asc': 'oldest date first',
        'receipt-desc': 'newest receipt first',
        'receipt-asc': 'oldest receipt first',
        'customer-asc': 'customer name A to Z',
        'customer-desc': 'customer name Z to A',
        'amount-desc': 'highest amount first',
        'amount-asc': 'lowest amount first'
    });
    const tableSortState = { customer: 'name-asc', payment: 'date-desc' };
    const pageState = {
        customer: { page: 1, pageSize: 25 },
        payment: { page: 1, pageSize: 25 },
        history: { page: 1, pageSize: 25 }
    };
    const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
    const dateFormatter = new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    const state = {
        workspace: { locationName: 'Secondary Location', updatedAt: null },
        customers: [],
        payments: [],
        summary: {},
        gcash: {
            selectedMonth: '',
            availableMonths: [],
            summary: {},
            transactions: [],
            loaded: false
        },
        network: {
            branchId: null,
            naps: [],
            loaded: false
        }
    };
    let gcashAllocationRows = [];
    let gcashAllocationTransaction = null;
    let toastTimer = null;
    let coordinateMap = null;
    let coordinateCustomerMarker = null;
    let coordinateNapLayer = null;
    let coordinateDraftPin = '';
    let napMap = null;
    let napMapCustomerMarker = null;
    let napMapNapLayer = null;
    let napMapDraftNapId = '';
    let napMapDraftPort = '';

    const byId = (id) => document.getElementById(id);
    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    const formatMoney = (value) => currency.format(Number(value) || 0);
    const formatDate = (value) => {
        const parsed = new Date(`${value}T00:00:00`);
        return Number.isNaN(parsed.getTime()) ? String(value || '') : dateFormatter.format(parsed);
    };
    const manilaDateParts = (date = new Date()) => Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone: MANILA_TIME_ZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
    );
    const today = () => {
        const parts = manilaDateParts();
        return `${parts.year}-${parts.month}-${parts.day}`;
    };
    const currentMonth = () => today().slice(0, 7);
    const defaultNextBillingDate = () => {
        const current = new Date(`${today()}T00:00:00Z`);
        const targetYear = current.getUTCFullYear() + (current.getUTCMonth() === 11 ? 1 : 0);
        const targetMonth = (current.getUTCMonth() + 1) % 12;
        const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
        return [
            targetYear,
            String(targetMonth + 1).padStart(2, '0'),
            String(Math.min(current.getUTCDate(), lastDay)).padStart(2, '0')
        ].join('-');
    };
    const filenameFromDisposition = (disposition, fallback) => {
        const encoded = String(disposition || '').match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        if (encoded) {
            try {
                return decodeURIComponent(encoded.replace(/^"|"$/g, ''));
            } catch (_error) {
                // Fall through to the regular filename form.
            }
        }
        return String(disposition || '').match(/filename="?([^";]+)"?/i)?.[1] || fallback;
    };
    const titleCase = (value) => String(value || '').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
    const compareText = (left, right) => String(left || '').localeCompare(String(right || ''), undefined, {
        numeric: true,
        sensitivity: 'base'
    });
    const normalizedPaymentMethod = (value) => String(value || '').trim().toLowerCase();
    const paymentIsImmutable = (payment) => Boolean(
        payment?.immutable || payment?.systemGenerated || payment?.officialGcash
    );
    const paymentIsOfficialGcash = (payment) => Boolean(payment?.officialGcash)
        || (normalizedPaymentMethod(payment?.paymentMethod) === 'gcash' && paymentIsImmutable(payment));
    const roundMoney = (value) => Number((Number(value) || 0).toFixed(2));

    function sortCustomerRows(customers, sortKey) {
        const addressOrder = sortKey === 'address-masical'
            ? { Masical: 0, Poblacion: 1 }
            : { Poblacion: 0, Masical: 1 };
        const statusOrder = sortKey === 'status-inactive'
            ? { inactive: 0, active: 1 }
            : { active: 0, inactive: 1 };
        const comparators = {
            'name-asc': (left, right) => compareText(left.fullName, right.fullName),
            'name-desc': (left, right) => compareText(right.fullName, left.fullName),
            'account-asc': (left, right) => compareText(left.accountNumber, right.accountNumber),
            'account-desc': (left, right) => compareText(right.accountNumber, left.accountNumber),
            'address-poblacion': (left, right) => (addressOrder[left.address] ?? 2) - (addressOrder[right.address] ?? 2),
            'address-masical': (left, right) => (addressOrder[left.address] ?? 2) - (addressOrder[right.address] ?? 2),
            'plan-asc': (left, right) => Number(left.monthlyRate || 0) - Number(right.monthlyRate || 0),
            'plan-desc': (left, right) => Number(right.monthlyRate || 0) - Number(left.monthlyRate || 0),
            'plan-type-asc': (left, right) => compareText(left.planType || 'postpaid', right.planType || 'postpaid'),
            'plan-type-desc': (left, right) => compareText(right.planType || 'postpaid', left.planType || 'postpaid'),
            'billing-asc': (left, right) => Number(left.billingDay || 1) - Number(right.billingDay || 1),
            'billing-desc': (left, right) => Number(right.billingDay || 1) - Number(left.billingDay || 1),
            'balance-desc': (left, right) => Number(right.balance || 0) - Number(left.balance || 0),
            'balance-asc': (left, right) => Number(left.balance || 0) - Number(right.balance || 0),
            'status-active': (left, right) => (statusOrder[left.status] ?? 2) - (statusOrder[right.status] ?? 2),
            'status-inactive': (left, right) => (statusOrder[left.status] ?? 2) - (statusOrder[right.status] ?? 2)
        };
        const comparator = comparators[sortKey] || comparators['name-asc'];
        return [...customers].sort((left, right) => comparator(left, right) || compareText(left.accountNumber, right.accountNumber));
    }

    function sortPaymentRows(payments, sortKey) {
        const compareDatesNewest = (left, right) => compareText(right.date, left.date)
            || compareText(right.createdAt, left.createdAt);
        const comparators = {
            'date-desc': compareDatesNewest,
            'date-asc': (left, right) => compareText(left.date, right.date) || compareText(left.createdAt, right.createdAt),
            'amount-desc': (left, right) => Number(right.amount || 0) - Number(left.amount || 0),
            'amount-asc': (left, right) => Number(left.amount || 0) - Number(right.amount || 0),
            'receipt-desc': (left, right) => compareText(right.receiptNumber, left.receiptNumber),
            'receipt-asc': (left, right) => compareText(left.receiptNumber, right.receiptNumber),
            'customer-asc': (left, right) => compareText(left.customerName, right.customerName),
            'customer-desc': (left, right) => compareText(right.customerName, left.customerName)
        };
        const comparator = comparators[sortKey] || comparators['date-desc'];
        return [...payments].sort((left, right) => comparator(left, right) || compareDatesNewest(left, right));
    }

    function sortDirection(sortKey) {
        return sortKey.endsWith('-desc') || sortKey === 'address-masical' || sortKey === 'status-inactive'
            ? 'descending'
            : 'ascending';
    }

    function paginateRows(rows, group) {
        const settings = pageState[group];
        const pageCount = Math.max(1, Math.ceil(rows.length / settings.pageSize));
        settings.page = Math.min(Math.max(1, settings.page), pageCount);
        const startIndex = (settings.page - 1) * settings.pageSize;
        return {
            rows: rows.slice(startIndex, startIndex + settings.pageSize),
            page: settings.page,
            pageCount,
            start: rows.length ? startIndex + 1 : 0,
            end: Math.min(startIndex + settings.pageSize, rows.length),
            total: rows.length
        };
    }

    function renderPager(group, pagination) {
        const pager = byId(`${group}Pager`);
        if (!pager) return;
        pager.innerHTML = `
            <button class="btn btn-sm btn-outline-secondary" type="button" data-page-group="${group}" data-page-action="previous"${pagination.page <= 1 ? ' disabled' : ''} aria-label="Previous page"><i class="ti ti-chevron-left"></i></button>
            <label class="pager__selector"><span class="visually-hidden">${titleCase(group)} page</span><select class="form-select form-select-sm" data-page-select="${group}" aria-label="${titleCase(group)} page">${Array.from({ length: pagination.pageCount }, (_item, index) => `<option value="${index + 1}"${pagination.page === index + 1 ? ' selected' : ''}>Page ${index + 1} of ${pagination.pageCount}</option>`).join('')}</select></label>
            <button class="btn btn-sm btn-outline-secondary" type="button" data-page-group="${group}" data-page-action="next"${pagination.page >= pagination.pageCount ? ' disabled' : ''} aria-label="Next page"><i class="ti ti-chevron-right"></i></button>`;
    }

    function handlePagerClick(event) {
        const button = event.target.closest('[data-page-group]');
        if (!button) return;
        const group = button.dataset.pageGroup;
        const settings = pageState[group];
        if (!settings) return;
        settings.page += button.dataset.pageAction === 'previous' ? -1 : 1;
        if (group === 'customer') renderCustomers();
        if (group === 'payment') renderPayments();
        if (group === 'history') renderPaymentHistory();
    }

    function handlePageSelect(event) {
        const select = event.target.closest('[data-page-select]');
        if (!select) return;
        const group = select.dataset.pageSelect;
        if (!pageState[group]) return;
        pageState[group].page = Math.max(1, Number(select.value) || 1);
        if (group === 'customer') renderCustomers();
        if (group === 'payment') renderPayments();
        if (group === 'history') renderPaymentHistory();
    }

    function resetPage(group) {
        if (pageState[group]) pageState[group].page = 1;
    }

    function renderSortHeaders(group) {
        const currentSort = tableSortState[group];
        document.querySelectorAll(`[data-sort-group="${group}"]`).forEach((button) => {
            const options = TABLE_SORT_OPTIONS[group]?.[button.dataset.sortColumn] || [];
            const isActive = options.includes(currentSort);
            const activeDirection = isActive ? sortDirection(currentSort) : null;
            const nextSort = isActive && currentSort === options[0] ? options[1] : options[0];
            const label = button.dataset.sortLabel || button.textContent.trim();
            const icon = button.querySelector('i');
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
            button.closest('th')?.setAttribute('aria-sort', activeDirection || 'none');
            if (icon) icon.className = `ti ti-${isActive ? `sort-${activeDirection}` : 'arrows-sort'}`;
            const action = `Click to sort ${SORT_DESCRIPTIONS[nextSort] || label.toLowerCase()}.`;
            button.title = isActive
                ? `${label}: ${SORT_DESCRIPTIONS[currentSort]}. ${action}`
                : action;
            button.setAttribute('aria-label', button.title);
        });
    }

    function handleTableSort(event) {
        const button = event.currentTarget;
        const group = button.dataset.sortGroup;
        const options = TABLE_SORT_OPTIONS[group]?.[button.dataset.sortColumn];
        if (!options) return;
        tableSortState[group] = options.includes(tableSortState[group]) && tableSortState[group] === options[0]
            ? options[1]
            : options[0];
        resetPage(group);
        if (group === 'customer') renderCustomers();
        if (group === 'payment') renderPayments();
        renderSortHeaders(group);
    }

    function showToast(message, type = 'success') {
        const toast = byId('tempToast');
        toast.classList.toggle('temp-toast--error', type === 'error');
        toast.classList.toggle('temp-toast--success', type !== 'error');
        toast.querySelector('i').className = type === 'error' ? 'ti ti-alert-circle' : 'ti ti-circle-check';
        toast.querySelector('span').textContent = message;
        toast.hidden = false;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4500);
    }

    async function api(path, options = {}) {
        const requestOptions = { credentials: 'same-origin', ...options };
        if (requestOptions.body && !(requestOptions.body instanceof FormData)) {
            requestOptions.headers = { 'Content-Type': 'application/json', ...(requestOptions.headers || {}) };
            if (typeof requestOptions.body !== 'string') requestOptions.body = JSON.stringify(requestOptions.body);
        }
        const response = await fetch(`${API_ROOT}${path}`, requestOptions);
        if (response.status === 401) {
            window.location.assign('/login.html');
            throw new Error('Your session expired. Sign in again.');
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
        return payload;
    }

    function parseCoordinates(value) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const decimalMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
        if (decimalMatch) {
            const lat = Number(decimalMatch[1]);
            const lng = Number(decimalMatch[2]);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
            return { lat, lng };
        }

        const normalizedDms = raw
            .replace(/\u00C2(?=\u00B0)/g, '')
            .replace(/[\u00BA\u02DA]/g, '\u00B0')
            .replace(/[\u2032\u2019]/g, "'")
            .replace(/[\u2033\u201C\u201D]/g, '"')
            .replace(/\uFF0C/g, ',')
            .replace(/,/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const hasDmsMarkers = /[NSEW]/i.test(normalizedDms)
            && /[\u00B0'"]|\d+\s+[NSEW]|\b[NSEW]\s*\d/i.test(normalizedDms);
        if (!hasDmsMarkers) return null;

        const parseDmsSegment = (segment) => {
            const text = String(segment || '').trim().toUpperCase();
            const hemisphere = text.match(/[NSEW]/)?.[0] || '';
            if (!hemisphere) return null;
            const numericParts = text.replace(/[NSEW]/g, ' ').match(/-?\d+(?:\.\d+)?/g) || [];
            if (!numericParts.length || numericParts.length > 3) return null;
            const degrees = Number(numericParts[0]);
            const minutes = Number(numericParts[1] || 0);
            const seconds = Number(numericParts[2] || 0);
            if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)
                || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
            let decimal = Math.abs(degrees) + (minutes / 60) + (seconds / 3600);
            if (hemisphere === 'S' || hemisphere === 'W') decimal *= -1;
            return { value: decimal, hemisphere };
        };

        const segments = normalizedDms.match(/(?:[NSEW][^NSEW]+|[^NSEW]+[NSEW])/gi) || [];
        const parsedSegments = segments.map(parseDmsSegment).filter(Boolean);
        const lat = parsedSegments.find((entry) => entry.hemisphere === 'N' || entry.hemisphere === 'S')?.value;
        const lng = parsedSegments.find((entry) => entry.hemisphere === 'E' || entry.hemisphere === 'W')?.value;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
        return { lat, lng };
    }

    function formatCoordinates(lat, lng) {
        return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
    }

    function selectedNetworkCustomerAccount() {
        return String(byId('customerEditAccount').value || '').trim();
    }

    function selectedNap() {
        const napId = String(byId('customerNap').value || '').trim();
        return state.network.naps.find((nap) => String(nap.id || '') === napId) || null;
    }

    function renderNetworkHint() {
        const hint = byId('customerNetworkHint').querySelector('span');
        const nap = selectedNap();
        const port = Number(byId('customerNapPort').value) || null;
        if (nap && port) {
            hint.textContent = `${nap.code || 'NAP'} · Port ${String(port).padStart(2, '0')} will appear in PON Management and Coverage Map as a Temp assignment.`;
            return;
        }
        hint.textContent = 'Coordinates and NAP assignment appear in PON Management and Coverage Map. Temp billing remains isolated.';
    }

    function renderNetworkPorts(selectedPort = '') {
        const select = byId('customerNapPort');
        const nap = selectedNap();
        const currentAccount = selectedNetworkCustomerAccount();
        if (!nap) {
            select.innerHTML = '<option value="">Select NAP first</option>';
            select.disabled = true;
            renderNetworkHint();
            return;
        }
        const options = (Array.isArray(nap.ports) ? nap.ports : []).map((entry) => {
            const port = Number(entry.port);
            const isCurrent = String(entry.customerAccountNumber || '') === currentAccount;
            const selectable = Boolean(entry.available || isCurrent);
            const suffix = isCurrent
                ? ' (Current)'
                : (entry.available ? ' · Available' : ` · Used by ${entry.customerName || entry.customerAccountNumber || 'customer'}`);
            return `<option value="${port}"${String(port) === String(selectedPort) ? ' selected' : ''}${selectable ? '' : ' disabled'}>Port ${String(port).padStart(2, '0')}${escapeHtml(suffix)}</option>`;
        });
        select.innerHTML = ['<option value="">Select an available port</option>', ...options].join('');
        select.disabled = false;
        renderNetworkHint();
    }

    function renderNetworkNapOptions(selectedNapId = '', selectedPort = '') {
        const select = byId('customerNap');
        select.innerHTML = [
            '<option value="">No NAP assignment</option>',
            ...state.network.naps.map((nap) => `<option value="${escapeHtml(nap.id)}"${String(nap.id) === String(selectedNapId) ? ' selected' : ''}>${escapeHtml(nap.code || 'Unnamed NAP')} · ${escapeHtml(nap.location || 'No location')}</option>`)
        ].join('');
        select.value = state.network.naps.some((nap) => String(nap.id) === String(selectedNapId)) ? String(selectedNapId) : '';
        renderNetworkPorts(selectedPort);
    }

    async function loadNetworkOptions(selectedNapId = '', selectedPort = '') {
        try {
            const payload = await api('/network-options');
            state.network = {
                branchId: payload.branchId || null,
                naps: Array.isArray(payload.naps) ? payload.naps : [],
                loaded: true
            };
            renderNetworkNapOptions(selectedNapId, selectedPort);
        } catch (error) {
            state.network = { branchId: null, naps: [], loaded: false };
            renderNetworkNapOptions();
            showToast(error.message, 'error');
        }
    }

    function customerMarkerIcon() {
        return L.divIcon({
            className: 'temp-map-marker-shell',
            html: '<span class="temp-map-marker temp-map-marker--customer"><i class="ti ti-map-pin"></i></span>',
            iconSize: [26, 26],
            iconAnchor: [13, 24]
        });
    }

    function napMarkerIcon(selected = false) {
        return L.divIcon({
            className: 'temp-map-marker-shell',
            html: `<span class="temp-map-marker temp-map-marker--nap${selected ? ' temp-map-marker--nap-selected' : ''}"><i class="ti ti-access-point"></i></span>`,
            iconSize: selected ? [30, 30] : [24, 24],
            iconAnchor: selected ? [15, 15] : [12, 12]
        });
    }

    function createEsriImageryLayer() {
        return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 22,
            maxNativeZoom: 18,
            detectRetina: true,
            keepBuffer: 4,
            attribution: '&copy; Esri',
            referrerPolicy: 'strict-origin-when-cross-origin'
        });
    }

    function setCoordinateDraft(lat, lng, options = {}) {
        coordinateDraftPin = formatCoordinates(lat, lng);
        byId('coordinatePickerStatus').textContent = `Selected ${coordinateDraftPin}.`;
        if (!coordinateCustomerMarker) {
            coordinateCustomerMarker = L.marker([lat, lng], { draggable: true, icon: customerMarkerIcon(), zIndexOffset: 1000 }).addTo(coordinateMap);
            coordinateCustomerMarker.on('dragend', () => {
                const point = coordinateCustomerMarker.getLatLng();
                setCoordinateDraft(point.lat, point.lng);
            });
        } else {
            coordinateCustomerMarker.setLatLng([lat, lng]);
        }
        if (options.center !== false) coordinateMap.setView([lat, lng], Math.max(coordinateMap.getZoom(), 17));
    }

    function renderCoordinateNapMarkers() {
        if (!coordinateMap) return;
        if (coordinateNapLayer) coordinateNapLayer.remove();
        coordinateNapLayer = L.layerGroup().addTo(coordinateMap);
        state.network.naps.forEach((nap) => {
            const point = parseCoordinates(nap.coordinate);
            if (!point) return;
            const availablePorts = (nap.ports || []).filter((port) => port.available).length;
            const marker = L.marker([point.lat, point.lng], { icon: napMarkerIcon() }).addTo(coordinateNapLayer);
            marker.bindTooltip(`${escapeHtml(nap.code || 'NAP')} · ${availablePorts} available`, { direction: 'top' });
            marker.on('click', () => {
                byId('customerNap').value = String(nap.id || '');
                renderNetworkPorts();
                byId('coordinatePickerStatus').textContent = `${nap.code || 'NAP'} selected. Choose an available port after using the coordinates.`;
            });
        });
    }

    function ensureCoordinateMap() {
        if (coordinateMap || !window.L) return;
        coordinateMap = L.map('coordinatePickerMap', { zoomControl: true }).setView([17.887, 121.873], 14);
        createEsriImageryLayer().addTo(coordinateMap);
        coordinateMap.on('click', (event) => setCoordinateDraft(event.latlng.lat, event.latlng.lng, { center: false }));
    }

    function openCoordinatePicker() {
        if (!window.L) {
            showToast('The map library did not load. Enter coordinates manually.', 'error');
            return;
        }
        const dialog = byId('coordinateDialog');
        dialog.showModal();
        ensureCoordinateMap();
        renderCoordinateNapMarkers();
        const current = parseCoordinates(byId('customerMapPin').value);
        const napPoint = parseCoordinates(selectedNap()?.coordinate);
        const initial = current || napPoint || { lat: 17.887, lng: 121.873 };
        setCoordinateDraft(initial.lat, initial.lng, { center: true });
        window.setTimeout(() => coordinateMap.invalidateSize(), 0);
    }

    function useCurrentLocation() {
        if (!navigator.geolocation) {
            showToast('Current location is not supported by this browser.', 'error');
            return;
        }
        const button = byId('useCurrentLocationBtn');
        button.disabled = true;
        byId('coordinatePickerStatus').textContent = 'Finding your current location…';
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setCoordinateDraft(position.coords.latitude, position.coords.longitude);
                button.disabled = false;
            },
            (error) => {
                byId('coordinatePickerStatus').textContent = 'Unable to read current location.';
                button.disabled = false;
                showToast(error.message || 'Unable to read current location.', 'error');
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
        );
    }

    function distanceMetersBetween(left, right) {
        if (!left || !right) return null;
        const toRadians = (value) => Number(value) * (Math.PI / 180);
        const latitudeDelta = toRadians(right.lat - left.lat);
        const longitudeDelta = toRadians(right.lng - left.lng);
        const leftLatitude = toRadians(left.lat);
        const rightLatitude = toRadians(right.lat);
        const haversine = Math.sin(latitudeDelta / 2) ** 2
            + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
        return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
    }

    function formatNapDistance(nap) {
        const customerPoint = parseCoordinates(byId('customerMapPin').value);
        const napPoint = parseCoordinates(nap?.coordinate);
        const distance = distanceMetersBetween(customerPoint, napPoint);
        if (!Number.isFinite(distance)) return '';
        return distance < 1000 ? `${Math.round(distance)} m away` : `${(distance / 1000).toFixed(1)} km away`;
    }

    function napMapPortRows(nap) {
        const currentAccount = selectedNetworkCustomerAccount();
        return (Array.isArray(nap?.ports) ? nap.ports : []).map((entry) => {
            const port = Number(entry.port);
            const isCurrent = String(entry.customerAccountNumber || '') === currentAccount;
            return {
                ...entry,
                port,
                isCurrent,
                selectable: Number.isInteger(port) && port > 0 && Boolean(entry.available || isCurrent)
            };
        }).filter((entry) => Number.isInteger(entry.port) && entry.port > 0);
    }

    function renderNapMapSelection() {
        const nap = state.network.naps.find((entry) => String(entry.id || '') === napMapDraftNapId) || null;
        const portSelect = byId('napMapPort');
        const useButton = byId('useNapSelectionBtn');
        const availability = byId('napMapAvailability');
        if (!nap) {
            byId('napMapSelectedName').textContent = 'Choose a NAP marker';
            byId('napMapSelectedMeta').textContent = 'The blue pin marks the Temp customer location.';
            availability.className = 'badge bg-secondary-lt text-secondary align-self-start';
            availability.textContent = 'No NAP selected';
            portSelect.innerHTML = '<option value="">Select a NAP first</option>';
            portSelect.disabled = true;
            useButton.disabled = true;
            byId('napMapPortHint').textContent = 'Available ports can be assigned. Occupied ports remain visible but disabled.';
            return;
        }

        const portRows = napMapPortRows(nap);
        const availableCount = portRows.filter((entry) => entry.available).length;
        const currentPort = portRows.find((entry) => entry.isCurrent)?.port || null;
        const distanceLabel = formatNapDistance(nap);
        byId('napMapSelectedName').textContent = nap.code || 'Unnamed NAP';
        byId('napMapSelectedMeta').textContent = [nap.location || 'No location', distanceLabel].filter(Boolean).join(' · ');
        availability.className = `badge ${availableCount || currentPort ? 'bg-green-lt text-green' : 'bg-red-lt text-red'} align-self-start`;
        availability.textContent = `${availableCount} of ${portRows.length} ports available${currentPort ? ` · Current Port ${String(currentPort).padStart(2, '0')}` : ''}`;
        portSelect.innerHTML = [
            '<option value="">Select an available port</option>',
            ...portRows.map((entry) => {
                const suffix = entry.isCurrent
                    ? ' (Current)'
                    : (entry.available ? ' · Available' : ` · Used by ${entry.customerName || entry.customerAccountNumber || 'customer'}`);
                return `<option value="${entry.port}"${String(entry.port) === napMapDraftPort ? ' selected' : ''}${entry.selectable ? '' : ' disabled'}>Port ${String(entry.port).padStart(2, '0')}${escapeHtml(suffix)}</option>`;
            })
        ].join('');
        const selectedRow = portRows.find((entry) => String(entry.port) === napMapDraftPort && entry.selectable);
        if (!selectedRow) napMapDraftPort = '';
        portSelect.value = napMapDraftPort;
        portSelect.disabled = !portRows.some((entry) => entry.selectable);
        useButton.disabled = !napMapDraftPort;
        byId('napMapPortHint').textContent = portSelect.disabled
            ? 'This NAP has no available port. Choose another NAP marker.'
            : 'Choose an available port, then confirm the NAP assignment.';
    }

    function renderNapMapMarkers() {
        if (!napMap) return;
        if (napMapNapLayer) napMapNapLayer.remove();
        napMapNapLayer = L.layerGroup().addTo(napMap);
        state.network.naps.forEach((nap) => {
            const point = parseCoordinates(nap.coordinate);
            if (!point) return;
            const portRows = napMapPortRows(nap);
            const availableCount = portRows.filter((entry) => entry.available).length;
            const selected = String(nap.id || '') === napMapDraftNapId;
            const marker = L.marker([point.lat, point.lng], {
                icon: napMarkerIcon(selected),
                zIndexOffset: selected ? 500 : 0
            }).addTo(napMapNapLayer);
            marker.bindTooltip(`${escapeHtml(nap.code || 'NAP')} · ${availableCount} of ${portRows.length} available`, { direction: 'top' });
            marker.on('click', () => selectNapMapNap(nap.id));
        });
    }

    function selectNapMapNap(napId, preferredPort = '') {
        const nap = state.network.naps.find((entry) => String(entry.id || '') === String(napId || '')) || null;
        napMapDraftNapId = nap ? String(nap.id || '') : '';
        const portRows = napMapPortRows(nap);
        const preferredRow = portRows.find((entry) => String(entry.port) === String(preferredPort || '') && entry.selectable);
        const firstSelectable = preferredRow || portRows.find((entry) => entry.selectable) || null;
        napMapDraftPort = firstSelectable ? String(firstSelectable.port) : '';
        renderNapMapMarkers();
        renderNapMapSelection();
        if (nap) {
            byId('napMapStatus').textContent = `${nap.code || 'NAP'} selected. ${napMapDraftPort ? `Port ${String(napMapDraftPort).padStart(2, '0')} is ready.` : 'No available port.'}`;
        }
    }

    function ensureNapMap() {
        if (napMap || !window.L) return;
        napMap = L.map('napPickerMap', { zoomControl: true }).setView([17.887, 121.873], 14);
        createEsriImageryLayer().addTo(napMap);
    }

    function renderNapMapCustomer(point) {
        if (!napMapCustomerMarker) {
            napMapCustomerMarker = L.marker([point.lat, point.lng], {
                icon: customerMarkerIcon(),
                zIndexOffset: 1000,
                interactive: false
            }).addTo(napMap);
            napMapCustomerMarker.bindTooltip('Temp customer location', { direction: 'top' });
            return;
        }
        napMapCustomerMarker.setLatLng([point.lat, point.lng]);
    }

    async function openNapMapPicker() {
        if (!window.L) {
            showToast('The map library did not load. Select the NAP from the list.', 'error');
            return;
        }
        const customerPoint = parseCoordinates(byId('customerMapPin').value);
        if (!customerPoint) {
            showToast('Pin the Temp customer location before choosing a NAP on the map.', 'error');
            byId('customerMapPin').focus();
            return;
        }
        const selectedNapId = String(byId('customerNap').value || '');
        const selectedPort = String(byId('customerNapPort').value || '');
        if (!state.network.loaded) await loadNetworkOptions(selectedNapId, selectedPort);
        if (!state.network.loaded) return;

        napMapDraftNapId = selectedNapId;
        napMapDraftPort = selectedPort;
        byId('napMapDialog').showModal();
        ensureNapMap();
        renderNapMapCustomer(customerPoint);
        if (napMapDraftNapId) {
            selectNapMapNap(napMapDraftNapId, napMapDraftPort);
        } else {
            renderNapMapMarkers();
            renderNapMapSelection();
        }
        const mappedNapCount = state.network.naps.filter((nap) => parseCoordinates(nap.coordinate)).length;
        if (!napMapDraftNapId) {
            byId('napMapStatus').textContent = `${mappedNapCount} mapped NAP${mappedNapCount === 1 ? '' : 's'} shown. Select a violet marker to view ports.`;
        }
        napMap.setView([customerPoint.lat, customerPoint.lng], 15);
        window.setTimeout(() => napMap.invalidateSize(), 0);
    }

    function useNapMapSelection() {
        const nap = state.network.naps.find((entry) => String(entry.id || '') === napMapDraftNapId) || null;
        const selectedPort = napMapPortRows(nap).find((entry) => String(entry.port) === napMapDraftPort && entry.selectable) || null;
        if (!nap || !selectedPort) {
            showToast('Select a NAP with an available port first.', 'error');
            return;
        }
        byId('customerNap').value = String(nap.id || '');
        renderNetworkPorts(String(selectedPort.port));
        byId('customerNapPort').value = String(selectedPort.port);
        renderNetworkHint();
        byId('napMapDialog').close();
    }

    function updateState(payload) {
        state.workspace = payload.workspace || state.workspace;
        state.customers = Array.isArray(payload.customers) ? payload.customers : [];
        state.payments = Array.isArray(payload.payments) ? payload.payments : [];
        state.summary = payload.summary || {};
    }

    function renderSummary() {
        byId('workspaceTitle').textContent = state.workspace.locationName || 'Secondary Location';
        byId('metricCustomers').textContent = String(state.summary.customerCount || 0);
        byId('metricActive').textContent = `${state.summary.activeCustomerCount || 0} active`;
        byId('metricPayments').textContent = formatMoney(state.summary.totalPayments);
        const receivedPaymentCount = state.summary.receivedPaymentCount
            ?? state.payments.filter((payment) => payment.kind === 'payment').length;
        byId('metricPaymentCount').textContent = `${receivedPaymentCount || 0} payment${receivedPaymentCount === 1 ? '' : 's'}`;
        byId('metricCharges').textContent = formatMoney(state.summary.totalCharges);
        byId('metricOutstanding').textContent = formatMoney(state.summary.outstandingBalance);
        byId('metricAdvance').textContent = `${formatMoney(state.summary.advanceBalance)} advance`;
    }

    function balanceClass(balance) {
        if (balance > 0) return 'balance-due';
        if (balance < 0) return 'balance-advance';
        return 'balance-clear';
    }

    function renderCustomers() {
        const term = byId('customerSearch').value.trim().toLowerCase();
        const status = byId('customerStatusFilter').value;
        const filteredCustomers = sortCustomerRows(state.customers.filter((customer) => {
            if (status && customer.status !== status) return false;
            if (!term) return true;
            return [
                customer.accountNumber,
                customer.fullName,
                customer.contactNumber,
                customer.email,
                customer.address,
                customer.planName,
                customer.planType,
                customer.mapPin,
                customer.napCode,
                customer.napPort
            ].some((value) => String(value || '').toLowerCase().includes(term));
        }), tableSortState.customer);
        const pagination = paginateRows(filteredCustomers, 'customer');
        const customers = pagination.rows;

        byId('customerTableBody').innerHTML = customers.map((customer) => {
            const planType = TEMP_PLAN_TYPES.includes(customer.planType) ? customer.planType : 'postpaid';
            const billingScheduleMode = TEMP_BILLING_SCHEDULE_MODES.includes(customer.billingScheduleMode)
                ? customer.billingScheduleMode
                : 'day';
            const cycleDetail = customer.nextBillingDate ? `Next ${formatDate(customer.nextBillingDate)}` : 'Cycle pending';
            return `<tr>
                <td><span class="account-code">${escapeHtml(customer.accountNumber)}</span></td>
                <td><span class="cell-primary">${escapeHtml(customer.fullName)}</span></td>
                <td><span class="cell-primary">${escapeHtml(customer.address || 'No address')}</span>${customer.mapPin ? `<span class="cell-secondary temp-network-meta"><i class="ti ti-map-pin"></i>${escapeHtml(customer.mapPin)}</span>` : ''}${customer.napId && customer.napPort ? `<span class="cell-secondary temp-network-meta temp-network-meta--nap"><i class="ti ti-access-point"></i>${escapeHtml(customer.napCode || 'NAP')} · Port ${String(customer.napPort).padStart(2, '0')}</span>` : ''}</td>
                <td><span class="cell-primary">${escapeHtml(customer.contactNumber || '—')}</span><span class="cell-secondary">${escapeHtml(customer.email || '')}</span></td>
                <td><span class="cell-primary">${escapeHtml(customer.planName || 'No plan')}</span><span class="cell-secondary">${formatMoney(customer.monthlyRate)} / month</span></td>
                <td><span class="plan-type-pill plan-type-pill--${escapeHtml(planType)}">${escapeHtml(titleCase(planType))}</span></td>
                <td><span class="cell-primary">${billingScheduleMode === 'date' ? 'Exact-date cycle' : `Day ${customer.billingDay}`}</span><span class="cell-secondary">${escapeHtml(cycleDetail)}</span></td>
                <td class="text-end"><strong class="${balanceClass(customer.balance)}">${formatMoney(customer.balance)}</strong><span class="cell-secondary">${customer.balance > 0 ? 'Amount due' : customer.balance < 0 ? 'Advance credit' : 'Clear'}</span></td>
                <td><span class="status-pill status-pill--${escapeHtml(customer.status)}"><i class="ti ti-${customer.status === 'active' ? 'circle-check' : 'circle-minus'}"></i>${escapeHtml(customer.status)}</span></td>
                <td><div class="row-actions">
                    <button class="icon-button" type="button" data-customer-action="statement" data-account="${escapeHtml(customer.accountNumber)}" title="Ledger &amp; payment history" aria-label="Open ledger and payment history"><i class="ti ti-file-description"></i></button>
                    <button class="icon-button" type="button" data-customer-action="payment" data-account="${escapeHtml(customer.accountNumber)}" title="Add transaction" aria-label="Add transaction"><i class="ti ti-cash-plus"></i></button>
                    <button class="icon-button" type="button" data-customer-action="edit" data-account="${escapeHtml(customer.accountNumber)}" title="Edit" aria-label="Edit customer"><i class="ti ti-edit"></i></button>
                    <button class="icon-button icon-button--danger" type="button" data-customer-action="delete" data-account="${escapeHtml(customer.accountNumber)}" title="Delete" aria-label="Delete customer"><i class="ti ti-trash"></i></button>
                </div></td>
            </tr>`;
        }).join('');

        const noResults = filteredCustomers.length === 0;
        byId('customerEmpty').hidden = !noResults;
        byId('customerTableBody').closest('.table-responsive').hidden = noResults;
        byId('customerResultCount').textContent = filteredCustomers.length
            ? `Showing ${pagination.start}–${pagination.end} of ${filteredCustomers.length} customer${filteredCustomers.length === 1 ? '' : 's'}${filteredCustomers.length !== state.customers.length ? ` (${state.customers.length} total)` : ''}`
            : `0 of ${state.customers.length} customers`;
        renderPager('customer', pagination);
    }

    function renderPayments() {
        const term = byId('paymentSearch').value.trim().toLowerCase();
        const kind = byId('paymentKindFilter').value;
        const filteredPayments = sortPaymentRows(state.payments.filter((payment) => {
            if (kind && payment.kind !== kind) return false;
            if (!term) return true;
            return [
                payment.customerName,
                payment.accountNumber,
                payment.receiptNumber,
                payment.reference,
                payment.paymentMethod,
                payment.description
            ].some((value) => String(value || '').toLowerCase().includes(term));
        }), tableSortState.payment);
        const pagination = paginateRows(filteredPayments, 'payment');
        const payments = pagination.rows;

        byId('paymentTableBody').innerHTML = payments.map((payment) => {
            const credit = payment.kind !== 'charge';
            const immutable = paymentIsImmutable(payment);
            const legacyGcash = normalizedPaymentMethod(payment.paymentMethod) === 'gcash'
                && !paymentIsOfficialGcash(payment);
            const immutableLabel = payment.systemGenerated
                ? 'Automatic cycle charge'
                : (paymentIsOfficialGcash(payment) ? 'Official imported GCash' : 'Protected transaction');
            return `
                <tr>
                    <td><span class="cell-primary">${formatDate(payment.date)}</span></td>
                    <td><span class="account-code">${escapeHtml(payment.receiptNumber)}</span></td>
                    <td><span class="cell-primary">${escapeHtml(payment.customerName)}</span><span class="cell-secondary account-code">${escapeHtml(payment.accountNumber)}</span></td>
                    <td><span class="kind-pill kind-pill--${escapeHtml(payment.kind)}">${escapeHtml(titleCase(payment.kind))}</span>${immutable ? `<span class="cell-secondary"><i class="ti ti-lock"></i> ${escapeHtml(immutableLabel)}</span>` : (legacyGcash ? '<span class="cell-secondary"><i class="ti ti-alert-triangle"></i> Unverified legacy GCash</span>' : '')}</td>
                    <td><span class="cell-primary">${escapeHtml(payment.paymentMethod || '—')}</span><span class="cell-secondary" title="${escapeHtml(payment.reference)}">${escapeHtml(payment.reference || payment.description || '')}</span></td>
                    <td><span class="cell-primary">${escapeHtml(payment.recordedBy || 'Admin')}</span></td>
                    <td class="text-end"><strong class="${credit ? 'transaction-credit' : 'transaction-debit'}">${credit ? '−' : '+'}${formatMoney(payment.amount)}</strong></td>
                    <td><div class="row-actions">
                        ${payment.kind === 'payment' ? `<button class="icon-button" type="button" data-payment-action="receipt" data-payment-id="${escapeHtml(payment.id)}" title="View receipt" aria-label="View receipt"><i class="ti ti-receipt"></i></button>` : ''}
                        ${immutable || legacyGcash ? '' : `<button class="icon-button" type="button" data-payment-action="edit" data-payment-id="${escapeHtml(payment.id)}" title="Edit" aria-label="Edit transaction"><i class="ti ti-edit"></i></button>`}
                        ${immutable ? '' : `<button class="icon-button icon-button--danger" type="button" data-payment-action="delete" data-payment-id="${escapeHtml(payment.id)}" title="Delete" aria-label="Delete transaction"><i class="ti ti-trash"></i></button>`}
                    </div></td>
                </tr>`;
        }).join('');

        const noResults = filteredPayments.length === 0;
        byId('paymentEmpty').hidden = !noResults;
        byId('paymentTableBody').closest('.table-responsive').hidden = noResults;
        byId('paymentResultCount').textContent = filteredPayments.length
            ? `Showing ${pagination.start}–${pagination.end} of ${filteredPayments.length} transaction${filteredPayments.length === 1 ? '' : 's'}${filteredPayments.length !== state.payments.length ? ` (${state.payments.length} total)` : ''}`
            : `0 of ${state.payments.length} transactions`;
        renderPager('payment', pagination);
    }

    function renderPaymentCustomerOptions(selectedAccount = '') {
        byId('paymentCustomer').innerHTML = [
            '<option value="">Select a Temp customer</option>',
            ...state.customers.map((customer) => `<option value="${escapeHtml(customer.accountNumber)}"${customer.accountNumber === selectedAccount ? ' selected' : ''}>${escapeHtml(customer.accountNumber)} — ${escapeHtml(customer.fullName)}</option>`)
        ].join('');
    }

    function renderHistoryFilterOptions() {
        const selectedMethod = byId('historyMethodFilter').value;
        const selectedRecorder = byId('historyRecorderFilter').value;
        const payments = state.payments.filter((payment) => payment.kind === 'payment');
        const methods = Array.from(new Set(payments.map((payment) => String(payment.paymentMethod || '').trim()).filter(Boolean)))
            .sort(compareText);
        const recorders = Array.from(new Set(payments.map((payment) => String(payment.recordedBy || 'Admin').trim()).filter(Boolean)))
            .sort(compareText);
        byId('historyMethodFilter').innerHTML = ['<option value="">All methods</option>', ...methods.map((method) => `<option value="${escapeHtml(method)}">${escapeHtml(method)}</option>`)].join('');
        byId('historyRecorderFilter').innerHTML = ['<option value="">All recorders</option>', ...recorders.map((recorder) => `<option value="${escapeHtml(recorder)}">${escapeHtml(recorder)}</option>`)].join('');
        if (methods.includes(selectedMethod)) byId('historyMethodFilter').value = selectedMethod;
        if (recorders.includes(selectedRecorder)) byId('historyRecorderFilter').value = selectedRecorder;
    }

    function renderPaymentHistory() {
        const month = byId('historyMonth').value || currentMonth();
        const term = byId('historySearch').value.trim().toLowerCase();
        const method = byId('historyMethodFilter').value;
        const recorder = byId('historyRecorderFilter').value;
        const sort = byId('historySort').value || 'date-desc';
        const filteredPayments = sortPaymentRows(state.payments.filter((payment) => {
            if (payment.kind !== 'payment') return false;
            if (month && !String(payment.date || '').startsWith(month)) return false;
            if (method && payment.paymentMethod !== method) return false;
            if (recorder && (payment.recordedBy || 'Admin') !== recorder) return false;
            if (!term) return true;
            return [
                payment.customerName,
                payment.accountNumber,
                payment.receiptNumber,
                payment.reference,
                payment.paymentMethod,
                payment.recordedBy,
                payment.description
            ].some((value) => String(value || '').toLowerCase().includes(term));
        }), sort);
        const pagination = paginateRows(filteredPayments, 'history');
        byId('historyTableBody').innerHTML = pagination.rows.map((payment) => {
            const customer = state.customers.find((item) => item.accountNumber === payment.accountNumber);
            const officialBadge = paymentIsOfficialGcash(payment)
                ? '<span class="cell-secondary"><i class="ti ti-shield-check"></i> Official imported credit</span>'
                : '';
            return `<tr>
                <td><span class="cell-primary">${formatDate(payment.date)}</span></td>
                <td><span class="account-code">${escapeHtml(payment.receiptNumber)}</span></td>
                <td><span class="cell-primary">${escapeHtml(payment.customerName)}</span><span class="cell-secondary account-code">${escapeHtml(payment.accountNumber)}</span></td>
                <td>${escapeHtml(customer?.address || '—')}</td>
                <td><span class="cell-primary">${escapeHtml(payment.paymentMethod || '—')}</span><span class="cell-secondary">${escapeHtml(payment.reference || payment.description || '')}</span>${officialBadge}</td>
                <td>${escapeHtml(payment.recordedBy || 'Admin')}</td>
                <td class="text-end"><strong class="transaction-credit">${formatMoney(payment.amount)}</strong></td>
                <td><div class="row-actions"><button class="icon-button" type="button" data-payment-action="receipt" data-payment-id="${escapeHtml(payment.id)}" title="View receipt" aria-label="View receipt"><i class="ti ti-receipt"></i></button></div></td>
            </tr>`;
        }).join('');

        const noResults = filteredPayments.length === 0;
        byId('historyEmpty').hidden = !noResults;
        byId('historyTableBody').closest('.table-responsive').hidden = noResults;
        byId('historyResultCount').textContent = filteredPayments.length
            ? `Showing ${pagination.start}–${pagination.end} of ${filteredPayments.length} Temp payment${filteredPayments.length === 1 ? '' : 's'} for ${month}`
            : `0 Temp payments for ${month}`;
        renderPager('history', pagination);
    }

    function gcashStateLabel(value) {
        return {
            available: 'Available',
            reconcile: 'Needs review',
            mixed: 'Main + Temp split',
            conflict: 'Already in Main',
            claimed: 'Posting pending',
            posted: 'Posted to Temp'
        }[value] || titleCase(value || 'Available');
    }

    function renderGcash() {
        const summary = state.gcash.summary || {};
        const transactions = Array.isArray(state.gcash.transactions) ? state.gcash.transactions : [];
        byId('gcashAvailableCount').textContent = String(summary.availableCount || 0);
        byId('gcashReconcileCount').textContent = String(summary.reconcileCount || 0);
        byId('gcashMixedCount').textContent = String(summary.mixedCount || 0);
        byId('gcashConflictCount').textContent = String(summary.conflictCount || 0);
        byId('gcashPostedCount').textContent = String(summary.postedCount || 0);
        byId('gcashAvailableAmount').textContent = formatMoney(summary.availableAmount);
        byId('gcashAvailableMonths').innerHTML = (state.gcash.availableMonths || [])
            .map((month) => `<option value="${escapeHtml(month)}"></option>`).join('');

        byId('gcashTableBody').innerHTML = transactions.map((transaction) => {
            const transactionState = transaction.state || 'available';
            const allocationSource = transaction.assignment?.allocations?.length
                ? transaction.assignment.allocations
                : [
                    ...(transactionState === 'mixed' ? (transaction.mainPayments || []) : []),
                    ...(transaction.legacyPayments || [])
                ];
            const allocations = (Array.isArray(allocationSource) ? allocationSource : []).map((allocation) => {
                const customerName = allocation.customerName
                    || state.customers.find((customer) => customer.accountNumber === allocation.accountNumber)?.fullName
                    || allocation.accountNumber;
                return `${escapeHtml(customerName)} (${formatMoney(allocation.amount)})`;
            });
            const actionLabel = transactionState === 'reconcile'
                ? 'Review & post'
                : (transactionState === 'claimed'
                    ? 'Complete posting'
                    : (transactionState === 'mixed' ? 'Split remainder' : 'Allocate'));
            const action = transactionState === 'conflict'
                ? '<span class="text-danger small"><i class="ti ti-shield-x"></i> Already in Main</span>'
                : transactionState === 'posted'
                ? '<span class="text-success small"><i class="ti ti-circle-check"></i> Complete</span>'
                : `<button class="btn btn-sm ${transactionState === 'reconcile' || transactionState === 'claimed' ? 'btn-warning' : 'btn-primary'}" type="button" data-gcash-action="allocate" data-gcash-reference="${escapeHtml(transaction.reference)}"><i class="ti ti-users-plus"></i> ${actionLabel}</button>`;
            const mainConflictNote = transactionState === 'mixed'
                ? `<span class="cell-secondary gcash-allocation-summary">${formatMoney(transaction.mainAmount)} already in Main; allocate ${formatMoney(transaction.remainingAmount)} to Temp.</span>`
                : (transactionState === 'conflict'
                    ? `<span class="cell-secondary gcash-allocation-summary">${escapeHtml(transaction.mainPlanReason || `${(transaction.mainPayments || []).length} matching Main payment${(transaction.mainPayments || []).length === 1 ? '' : 's'}; Temp posting disabled.`)}</span>`
                    : '');
            return `<tr>
                <td><span class="cell-primary">${formatDate(transaction.transactionDate)}</span><span class="cell-secondary">${escapeHtml(transaction.transactionAt || '')}</span></td>
                <td><span class="account-code">${escapeHtml(transaction.reference)}</span></td>
                <td><span class="cell-primary">${escapeHtml(transaction.sender || 'Sender unavailable')}</span><span class="cell-secondary" title="${escapeHtml(transaction.description || '')}">${escapeHtml(transaction.description || '')}</span></td>
                <td><span class="cell-primary">${escapeHtml(transaction.recipientLabel || transaction.recipient || '—')}</span><span class="cell-secondary">${escapeHtml(transaction.recipientLabel ? transaction.recipient : '')}</span></td>
                <td class="text-end"><strong class="transaction-credit">${formatMoney(transaction.amount)}</strong></td>
                <td><span class="gcash-state gcash-state--${escapeHtml(transactionState)}">${escapeHtml(gcashStateLabel(transactionState))}</span>${mainConflictNote}${allocations.length ? `<span class="cell-secondary gcash-allocation-summary">${allocations.join(' · ')}</span>` : ''}</td>
                <td class="text-end">${action}</td>
            </tr>`;
        }).join('');

        const noResults = transactions.length === 0;
        byId('gcashEmpty').hidden = !noResults;
        byId('gcashTableBody').closest('.table-responsive').hidden = noResults;
        byId('gcashResultCount').textContent = `${transactions.length} imported credit${transactions.length === 1 ? '' : 's'} for ${state.gcash.selectedMonth || byId('gcashMonth').value}`;
    }

    function renderAll() {
        renderSummary();
        renderCustomers();
        renderPayments();
        renderHistoryFilterOptions();
        renderPaymentHistory();
        if (state.gcash.loaded) renderGcash();
        renderSortHeaders('customer');
        renderSortHeaders('payment');
        renderPaymentCustomerOptions(byId('paymentCustomer').value);
    }

    async function loadWorkspace(options = {}) {
        try {
            const payload = await api('/workspace');
            updateState(payload);
            renderAll();
            if (options.notify) showToast('Temp workspace refreshed.');
        } catch (error) {
            showToast(error.message, 'error');
        }
    }

    async function loadGcash(options = {}) {
        const month = byId('gcashMonth').value || currentMonth();
        const button = byId('refreshGcashBtn');
        if (button) button.disabled = true;
        try {
            const payload = await api(`/gcash?month=${encodeURIComponent(month)}`);
            state.gcash = {
                selectedMonth: payload.selectedMonth || month,
                availableMonths: Array.isArray(payload.availableMonths) ? payload.availableMonths : [],
                summary: payload.summary || {},
                transactions: Array.isArray(payload.transactions) ? payload.transactions : [],
                loaded: true
            };
            byId('gcashMonth').value = state.gcash.selectedMonth;
            renderGcash();
            if (options.notify) showToast('Imported GCash credits refreshed.');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            if (button) button.disabled = false;
        }
    }

    function activatePanel(panelName, options = {}) {
        const panelNames = ['customers', 'billing', 'history', 'gcash'];
        const selectedPanel = panelNames.includes(panelName) ? panelName : 'customers';
        panelNames.forEach((name) => {
            const tab = byId(`${name}Tab`);
            const panel = byId(`${name}Panel`);
            const selected = name === selectedPanel;
            panel.hidden = !selected;
            tab.classList.toggle('active', selected);
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        });
        if (options.updateHash !== false) history.replaceState(null, '', `#${selectedPanel}`);
        if (options.focus) byId(`${selectedPanel}Tab`).focus();
        if (selectedPanel === 'gcash' && !state.gcash.loaded) loadGcash();
    }

    async function openCustomerDialog(customer = null) {
        byId('customerForm').reset();
        byId('customerEditAccount').value = customer?.accountNumber || '';
        byId('customerDialogTitle').textContent = customer ? 'Edit customer' : 'Add customer';
        byId('customerAccount').disabled = Boolean(customer);
        byId('customerAccount').value = customer?.accountNumber || '';
        byId('customerFirstName').value = customer?.firstName || '';
        byId('customerLastName').value = customer?.lastName || '';
        byId('customerContact').value = customer?.contactNumber || '';
        byId('customerEmail').value = customer?.email || '';
        byId('customerAddress').value = TEMP_SERVICE_ADDRESSES.includes(customer?.address)
            ? customer.address
            : TEMP_SERVICE_ADDRESSES[0];
        const storedCoordinates = parseCoordinates(customer?.mapPin);
        byId('customerMapPin').value = storedCoordinates
            ? formatCoordinates(storedCoordinates.lat, storedCoordinates.lng)
            : (customer?.mapPin || '');
        renderNetworkNapOptions(customer?.napId || '', customer?.napPort || '');
        byId('customerPlanType').value = TEMP_PLAN_TYPES.includes(customer?.planType)
            ? customer.planType
            : 'postpaid';
        byId('customerActivationDate').value = customer?.activationDate || today();
        byId('customerBillingScheduleMode').value = TEMP_BILLING_SCHEDULE_MODES.includes(customer?.billingScheduleMode)
            ? customer.billingScheduleMode
            : (customer ? 'day' : 'date');
        byId('customerNextBillingDate').min = customer ? '' : today();
        byId('customerNextBillingDate').value = customer?.nextBillingDate || defaultNextBillingDate();
        const storedRate = Number(customer?.monthlyRate);
        const selectedPlan = Object.hasOwn(TEMP_PLAN_RATES, customer?.planName)
            ? customer.planName
            : Object.keys(TEMP_PLAN_RATES).find((planName) => TEMP_PLAN_RATES[planName] === storedRate) || 'Old plan';
        byId('customerPlan').value = selectedPlan;
        byId('customerRate').value = String(TEMP_PLAN_RATES[selectedPlan]);
        byId('customerBillingDay').value = customer?.billingDay || 1;
        byId('customerOpeningBalance').value = customer?.openingBalance ?? 0;
        byId('customerStatus').value = customer?.status || 'active';
        byId('customerNotes').value = customer?.notes || '';
        updateCustomerBillingScheduleFields();
        await loadNetworkOptions(customer?.napId || '', customer?.napPort || '');
        byId('customerDialog').showModal();
        window.setTimeout(() => byId('customerFirstName').focus(), 0);
    }

    function openPaymentDialog(payment = null, accountNumber = '') {
        if (!state.customers.length) {
            showToast('Add a Temp customer before recording a transaction.', 'error');
            return;
        }
        if (payment && (paymentIsImmutable(payment) || normalizedPaymentMethod(payment.paymentMethod) === 'gcash')) {
            showToast('This protected transaction cannot be edited.', 'error');
            return;
        }
        byId('paymentForm').reset();
        byId('paymentEditId').value = payment?.id || '';
        byId('paymentDialogTitle').textContent = payment ? 'Edit transaction' : 'Add transaction';
        renderPaymentCustomerOptions(payment?.accountNumber || accountNumber);
        byId('paymentCustomer').value = payment?.accountNumber || accountNumber || '';
        byId('paymentKind').value = payment?.kind || 'payment';
        byId('paymentAmount').value = payment?.amount || '';
        byId('paymentDate').value = payment?.date || today();
        byId('paymentMethod').value = payment?.paymentMethod || 'Cash';
        byId('paymentReference').value = payment?.reference || '';
        byId('paymentDescription').value = payment?.description || '';
        updateManualGcashNotice();
        byId('paymentDialog').showModal();
        window.setTimeout(() => byId('paymentCustomer').focus(), 0);
    }

    function updateManualGcashNotice() {
        const isManualGcash = normalizedPaymentMethod(byId('paymentMethod').value) === 'gcash';
        byId('manualGcashNotice').hidden = !isManualGcash;
        byId('savePaymentBtn').disabled = isManualGcash;
        byId('paymentReference').required = false;
    }

    function openReceipt(paymentId) {
        const payment = state.payments.find((item) => item.id === paymentId);
        if (!payment || payment.kind !== 'payment') return;
        const customer = state.customers.find((item) => item.accountNumber === payment.accountNumber);
        const officialNote = paymentIsOfficialGcash(payment)
            ? '<div class="receipt-verification"><i class="ti ti-shield-check"></i><span>Verified against an official imported GCash credit.</span></div>'
            : '';
        byId('receiptDialogTitle').textContent = `Receipt ${payment.receiptNumber}`;
        byId('receiptContent').innerHTML = `
            <article class="payment-receipt">
                <header class="payment-receipt__header"><div><span class="payment-receipt__eyebrow">Secondary location</span><h3>${escapeHtml(state.workspace.locationName || 'Secondary Location')}</h3><p>Official Temp payment receipt</p></div><span class="payment-receipt__mark"><i class="ti ti-receipt"></i></span></header>
                <div class="payment-receipt__number"><span>Receipt number</span><strong class="account-code">${escapeHtml(payment.receiptNumber)}</strong></div>
                <dl class="payment-receipt__details">
                    <div><dt>Received from</dt><dd>${escapeHtml(payment.customerName)}</dd></div>
                    <div><dt>Account number</dt><dd class="account-code">${escapeHtml(payment.accountNumber)}</dd></div>
                    <div><dt>Service address</dt><dd>${escapeHtml(customer?.address || '—')}</dd></div>
                    <div><dt>Payment date</dt><dd>${formatDate(payment.date)}</dd></div>
                    <div><dt>Payment method</dt><dd>${escapeHtml(payment.paymentMethod || '—')}</dd></div>
                    <div><dt>Reference</dt><dd class="account-code">${escapeHtml(payment.reference || '—')}</dd></div>
                    <div><dt>Recorded by</dt><dd>${escapeHtml(payment.recordedBy || 'Admin')}</dd></div>
                    <div><dt>Description</dt><dd>${escapeHtml(payment.description || 'Payment received')}</dd></div>
                </dl>
                <div class="payment-receipt__amount"><span>Amount received</span><strong>${formatMoney(payment.amount)}</strong></div>
                ${officialNote}
                <footer class="payment-receipt__footer"><span>Temp workspace only</span><span>Printed ${formatDate(today())}</span></footer>
            </article>`;
        byId('receiptDialog').showModal();
    }

    function openStatement(accountNumber) {
        const customer = state.customers.find((item) => item.accountNumber === accountNumber);
        if (!customer) return;
        const transactions = state.payments
            .filter((payment) => payment.accountNumber === accountNumber)
            .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt));
        const paymentHistory = transactions
            .filter((payment) => payment.kind === 'payment')
            .slice()
            .sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt));
        const totalCharges = transactions
            .filter((payment) => payment.kind === 'charge')
            .reduce((total, payment) => total + Number(payment.amount || 0), 0);
        const totalPayments = paymentHistory.reduce((total, payment) => total + Number(payment.amount || 0), 0);
        const planType = TEMP_PLAN_TYPES.includes(customer.planType) ? customer.planType : 'postpaid';
        const billingScheduleMode = TEMP_BILLING_SCHEDULE_MODES.includes(customer.billingScheduleMode)
            ? customer.billingScheduleMode
            : 'day';
        const nextBillingLabel = customer.nextBillingDate ? formatDate(customer.nextBillingDate) : 'Cycle pending';
        let runningBalance = Number(customer.openingBalance) || 0;
        const ledgerRows = transactions.map((payment) => {
            runningBalance += Number(payment.balanceImpact) || 0;
            const details = [payment.paymentMethod, payment.reference || payment.description].filter(Boolean).join(' · ') || '—';
            const debit = payment.kind === 'charge' ? formatMoney(payment.amount) : '—';
            const credit = payment.kind === 'charge' ? '—' : formatMoney(payment.amount);
            return `<tr><td>${formatDate(payment.date)}</td><td class="account-code">${escapeHtml(payment.receiptNumber)}</td><td><span class="kind-pill kind-pill--${escapeHtml(payment.kind)}">${escapeHtml(titleCase(payment.kind))}</span></td><td>${escapeHtml(details)}</td><td class="text-end transaction-debit">${debit}</td><td class="text-end transaction-credit">${credit}</td><td class="text-end"><strong class="${balanceClass(runningBalance)}">${formatMoney(runningBalance)}</strong></td></tr>`;
        }).join('');
        const paymentHistoryRows = paymentHistory.map((payment) => `
            <tr>
                <td>${formatDate(payment.date)}</td>
                <td class="account-code">${escapeHtml(payment.receiptNumber)}</td>
                <td>${escapeHtml(payment.paymentMethod || '—')}</td>
                <td>${escapeHtml(payment.reference || payment.description || '—')}</td>
                <td>${escapeHtml(payment.recordedBy || 'Admin')}</td>
                <td class="text-end"><strong class="transaction-credit">${formatMoney(payment.amount)}</strong></td>
            </tr>`).join('');
        byId('statementTitle').textContent = `${customer.fullName} — Ledger & payment history`;
        byId('statementContent').innerHTML = `
            <article class="statement-card">
                <div class="statement-heading">
                    <div>
                        <div class="statement-customer-line"><h3>${escapeHtml(customer.fullName)}</h3><span class="status-pill status-pill--${escapeHtml(customer.status)}">${escapeHtml(customer.status)}</span></div>
                        <p><span class="account-code">${escapeHtml(customer.accountNumber)}</span> · ${escapeHtml(customer.address || 'No address')}</p>
                        <p>${escapeHtml(customer.planName || 'No plan')} · ${formatMoney(customer.monthlyRate)} monthly · ${escapeHtml(titleCase(planType))} · ${billingScheduleMode === 'date' ? `Exact-date cycle (${escapeHtml(nextBillingLabel)})` : `Billing day ${customer.billingDay}`}</p>
                    </div>
                    <div class="statement-balance"><span>Current balance</span><strong class="${balanceClass(customer.balance)}">${formatMoney(customer.balance)}</strong><small>${customer.balance > 0 ? 'Amount due' : customer.balance < 0 ? 'Advance credit' : 'Account is clear'}</small></div>
                </div>
                <div class="statement-summary" aria-label="Customer ledger summary">
                    <div><span>Opening balance</span><strong>${formatMoney(customer.openingBalance)}</strong></div>
                    <div><span>Total charges</span><strong class="transaction-debit">${formatMoney(totalCharges)}</strong></div>
                    <div><span>Payments received</span><strong class="transaction-credit">${formatMoney(totalPayments)}</strong></div>
                    <div><span>Next billing</span><strong>${escapeHtml(nextBillingLabel)}</strong></div>
                </div>
                <section class="statement-section" aria-labelledby="ledgerHeading">
                    <div class="statement-section__heading"><div><span class="statement-section__icon"><i class="ti ti-list-details"></i></span><div><h4 id="ledgerHeading">Account ledger</h4><p>All charges, payments, rebates, and discounts in balance order.</p></div></div><span class="statement-count">${transactions.length} transaction${transactions.length === 1 ? '' : 's'}</span></div>
                    <div class="statement-table-wrap">
                        <table class="statement-table statement-table--ledger" id="customerLedgerTable"><thead><tr><th>Date</th><th>Receipt</th><th>Type</th><th>Details</th><th class="text-end">Debit</th><th class="text-end">Credit</th><th class="text-end">Balance</th></tr></thead><tbody><tr class="statement-opening-row"><td>—</td><td>—</td><td>Opening</td><td>Starting account balance</td><td class="text-end">—</td><td class="text-end">—</td><td class="text-end"><strong>${formatMoney(customer.openingBalance)}</strong></td></tr>${ledgerRows || '<tr><td class="statement-empty-row" colspan="7">No ledger transactions recorded.</td></tr>'}</tbody></table>
                    </div>
                </section>
                <section class="statement-section" aria-labelledby="paymentHistoryHeading">
                    <div class="statement-section__heading"><div><span class="statement-section__icon statement-section__icon--success"><i class="ti ti-history"></i></span><div><h4 id="paymentHistoryHeading">Payment history</h4><p>Payments received from this customer only.</p></div></div><div class="statement-section__total"><span>${paymentHistory.length} payment${paymentHistory.length === 1 ? '' : 's'}</span><strong>${formatMoney(totalPayments)}</strong></div></div>
                    <div class="statement-table-wrap">
                        <table class="statement-table statement-table--payments" id="customerPaymentHistory"><thead><tr><th>Date</th><th>Receipt</th><th>Method</th><th>Reference</th><th>Recorded by</th><th class="text-end">Amount</th></tr></thead><tbody>${paymentHistoryRows || '<tr><td class="statement-empty-row" colspan="6">No payments recorded for this customer.</td></tr>'}</tbody></table>
                    </div>
                </section>
            </article>`;
        byId('statementDialog').showModal();
    }

    function gcashTransactionAmount(transaction) {
        return roundMoney(transaction?.amount ?? transaction?.credit);
    }

    function gcashAllocationCustomerOptions(selectedAccount = '') {
        const selectedExists = state.customers.some((customer) => customer.accountNumber === selectedAccount);
        return [
            '<option value="">Select a Temp customer</option>',
            ...(!selectedExists && selectedAccount ? [`<option value="${escapeHtml(selectedAccount)}" selected>${escapeHtml(selectedAccount)} — unavailable</option>`] : []),
            ...state.customers.map((customer) => `<option value="${escapeHtml(customer.accountNumber)}"${customer.accountNumber === selectedAccount ? ' selected' : ''}>${escapeHtml(customer.accountNumber)} — ${escapeHtml(customer.fullName)}</option>`)
        ].join('');
    }

    function updateGcashAllocationTotals() {
        const officialAmount = gcashTransactionAmount(gcashAllocationTransaction);
        const allocated = roundMoney(gcashAllocationRows.reduce((total, allocation) => total + Number(allocation.amount || 0), 0));
        const remaining = roundMoney(officialAmount - allocated);
        const mainAmount = roundMoney(gcashAllocationRows
            .filter((allocation) => allocation.workspace === 'main')
            .reduce((total, allocation) => total + Number(allocation.amount || 0), 0));
        byId('gcashAllocatedAmount').textContent = formatMoney(allocated);
        byId('gcashRemainingAmount').textContent = formatMoney(remaining);
        byId('gcashRemainingAmount').className = Math.abs(remaining) < 0.005 ? 'transaction-credit' : 'balance-due';
        byId('postGcashBtn').disabled = Math.abs(remaining) >= 0.005;
        const guidance = byId('gcashAllocationGuidance');
        if (Math.abs(remaining) < 0.005) {
            guidance.className = 'alert alert-success mt-3 mb-3';
            guidance.innerHTML = mainAmount > 0
                ? `<i class="ti ti-circle-check me-2"></i><span>The existing Main payment and Temp allocation exactly match the imported credit. Main will not be posted again; the Temp portion will be finalized once.</span>`
                : '<i class="ti ti-circle-check me-2"></i><span>The allocation exactly matches the imported credit.</span>';
        } else if (remaining > 0) {
            guidance.className = 'alert alert-info mt-3 mb-3';
            guidance.innerHTML = `<i class="ti ti-info-circle me-2"></i><span>Allocate the remaining <strong>${formatMoney(remaining)}</strong>.</span>`;
        } else {
            guidance.className = 'alert alert-danger mt-3 mb-3';
            guidance.innerHTML = `<i class="ti ti-alert-circle me-2"></i><span>Reduce allocations by <strong>${formatMoney(Math.abs(remaining))}</strong>.</span>`;
        }
        byId('addGcashAllocationBtn').disabled = gcashAllocationRows.length >= GCASH_MAX_ALLOCATIONS;
    }

    function renderGcashAllocationRows() {
        byId('gcashAllocationRows').innerHTML = gcashAllocationRows.map((allocation, index) => {
            const isMain = allocation.workspace === 'main';
            const lockedNote = allocation.locked
                ? `<span class="allocation-lock"><i class="ti ti-lock"></i> ${isMain ? 'Existing Main payment; will not be posted again' : (allocation.source === 'legacy' ? `Existing receipt ${escapeHtml(allocation.receiptNumber || '')}` : 'Claimed allocation')}</span>`
                : '<span class="allocation-hint">Editable allocation</span>';
            const canRemove = !allocation.locked && gcashAllocationRows.filter((row) => !row.locked).length > 1;
            return `<div class="gcash-allocation-row" data-allocation-row="${index}">
                <div class="gcash-allocation-row__heading"><strong>${isMain ? 'Main' : 'Temp'} allocation ${index + 1}</strong>${lockedNote}</div>
                ${isMain
                    ? `<label class="form-field"><span>Main customer</span><span class="gcash-allocation-main"><i class="ti ti-building-bank"></i><strong>${escapeHtml(allocation.customerName || allocation.accountNumber)}</strong><span class="account-code">${escapeHtml(allocation.accountNumber)}</span></span></label>`
                    : `<label class="form-field"><span>Temp customer</span><select class="form-select" data-allocation-account="${index}"${allocation.locked ? ' disabled' : ''}>${gcashAllocationCustomerOptions(allocation.accountNumber)}</select></label>`}
                <label class="form-field"><span>Amount</span><div class="money-input"><span>&#8369;</span><input class="form-control" data-allocation-amount="${index}" type="number" min="0.01" step="0.01" value="${escapeHtml(allocation.amount || '')}"${allocation.locked ? ' disabled' : ''}></div></label>
                <button class="icon-button icon-button--danger allocation-remove" type="button" data-remove-allocation="${index}" title="Remove allocation" aria-label="Remove allocation"${canRemove ? '' : ' hidden'}><i class="ti ti-x"></i></button>
            </div>`;
        }).join('');
        updateGcashAllocationTotals();
    }

    function openGcashAllocation(reference) {
        const transaction = state.gcash.transactions.find((item) => item.reference === reference);
        if (!transaction || transaction.state === 'posted') return;
        if (transaction.state === 'conflict') {
            showToast('This reference already exists in Main Payment History and cannot be posted to Temp.', 'error');
            return;
        }
        if (!state.customers.length) {
            showToast('Add a Temp customer before allocating an imported GCash credit.', 'error');
            return;
        }
        gcashAllocationTransaction = transaction;
        const assignmentAllocations = Array.isArray(transaction.assignment?.allocations)
            ? transaction.assignment.allocations
            : [];
        const legacyPayments = Array.isArray(transaction.legacyPayments) ? transaction.legacyPayments : [];
        const mainPayments = Array.isArray(transaction.mainPayments) ? transaction.mainPayments : [];
        const mainPaymentIds = new Set(mainPayments.map((payment) => String(payment.paymentEntryId || payment.id || '')).filter(Boolean));
        const lockedSource = assignmentAllocations.length
            ? assignmentAllocations
            : [
                ...mainPayments.map((payment) => ({ ...payment, workspace: 'main' })),
                ...legacyPayments.map((payment) => ({ ...payment, workspace: 'temp' }))
            ];
        gcashAllocationRows = lockedSource.map((allocation) => {
            const isMain = allocation.workspace === 'main'
                || String(allocation.customerName || '').startsWith('Main - ')
                || mainPaymentIds.has(String(allocation.paymentEntryId || allocation.id || ''));
            return {
            accountNumber: allocation.accountNumber || '',
            customerName: String(allocation.customerName || '').replace(/^Main - /, ''),
            amount: roundMoney(allocation.amount),
            locked: true,
            source: isMain ? 'main' : (assignmentAllocations.length ? 'claimed' : 'legacy'),
            workspace: isMain ? 'main' : 'temp',
            receiptNumber: allocation.receiptNumber || ''
        };
        });
        const officialAmount = gcashTransactionAmount(transaction);
        const lockedTotal = roundMoney(gcashAllocationRows.reduce((total, allocation) => total + allocation.amount, 0));
        const remaining = roundMoney(officialAmount - lockedTotal);
        if (!gcashAllocationRows.length || (remaining > 0 && gcashAllocationRows.length < GCASH_MAX_ALLOCATIONS)) {
            gcashAllocationRows.push({ accountNumber: '', amount: remaining > 0 ? remaining : officialAmount, locked: false, source: 'new', workspace: 'temp' });
        }
        byId('gcashAllocationReference').value = transaction.reference;
        byId('gcashProofReference').textContent = transaction.reference;
        byId('gcashProofDate').textContent = formatDate(transaction.transactionDate);
        byId('gcashProofAmount').textContent = formatMoney(officialAmount);
        const mixedPosting = gcashAllocationRows.some((allocation) => allocation.workspace === 'main');
        byId('gcashAllocationTitle').textContent = mixedPosting ? 'Complete Main + Temp GCash split' : 'Post GCash to Temp customers';
        byId('gcashAssignmentConfirmationLabel').textContent = mixedPosting
            ? 'I verified the existing Main payment, Temp customers, amounts, and official reference. Link them as one locked payment group without duplicating Main.'
            : 'I verified the Temp customers, amounts, and official GCash reference. Post this allocation once.';
        byId('gcashAssignmentConfirmed').checked = false;
        renderGcashAllocationRows();
        byId('gcashAllocationDialog').showModal();
    }

    function addGcashAllocation() {
        if (gcashAllocationRows.length >= GCASH_MAX_ALLOCATIONS) return;
        gcashAllocationRows.push({ accountNumber: '', amount: '', locked: false, source: 'new', workspace: 'temp' });
        renderGcashAllocationRows();
    }

    function handleGcashAllocationInput(event) {
        const accountIndex = event.target.dataset.allocationAccount;
        const amountIndex = event.target.dataset.allocationAmount;
        const index = Number(accountIndex ?? amountIndex);
        if (!Number.isInteger(index) || !gcashAllocationRows[index] || gcashAllocationRows[index].locked) return;
        if (accountIndex != null) gcashAllocationRows[index].accountNumber = event.target.value;
        if (amountIndex != null) gcashAllocationRows[index].amount = event.target.value;
        updateGcashAllocationTotals();
    }

    function handleGcashAllocationRemove(event) {
        const button = event.target.closest('[data-remove-allocation]');
        if (!button) return;
        const index = Number(button.dataset.removeAllocation);
        if (!Number.isInteger(index) || gcashAllocationRows[index]?.locked) return;
        gcashAllocationRows.splice(index, 1);
        renderGcashAllocationRows();
    }

    async function postGcashAllocation(event) {
        event.preventDefault();
        if (!gcashAllocationTransaction) return;
        const allAllocations = gcashAllocationRows.map((allocation) => ({
            accountNumber: String(allocation.accountNumber || '').trim(),
            amount: roundMoney(allocation.amount),
            workspace: allocation.workspace || 'temp'
        }));
        const allocations = allAllocations.filter((allocation) => allocation.workspace !== 'main');
        if (!allocations.length || allAllocations.length > GCASH_MAX_ALLOCATIONS
            || allocations.some((allocation) => !allocation.accountNumber || allocation.amount <= 0)) {
            showToast('Select a Temp customer and positive amount for every allocation.', 'error');
            return;
        }
        if (new Set(allAllocations.map((allocation) => allocation.accountNumber)).size !== allAllocations.length) {
            showToast('Each Main or Temp account can appear only once in an allocation.', 'error');
            return;
        }
        const total = roundMoney(allAllocations.reduce((sum, allocation) => sum + allocation.amount, 0));
        if (Math.abs(total - gcashTransactionAmount(gcashAllocationTransaction)) >= 0.005) {
            showToast('The allocation total must exactly match the imported GCash credit.', 'error');
            return;
        }
        if (!byId('gcashAssignmentConfirmed').checked) {
            showToast('Confirm the customers, amounts, and official reference before posting.', 'error');
            return;
        }
        const button = byId('postGcashBtn');
        button.disabled = true;
        try {
            const result = await api(`/gcash/${encodeURIComponent(gcashAllocationTransaction.reference)}/post`, {
                method: 'POST',
                body: { allocations, assignmentConfirmed: true }
            });
            byId('gcashAllocationDialog').close();
            await loadWorkspace();
            await loadGcash();
            showToast(result.message || (result.idempotent ? 'This official GCash allocation was already posted.' : 'Official GCash payment posted to Temp.'));
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    }

    async function saveCustomer(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const accountNumber = byId('customerEditAccount').value;
        const payload = Object.fromEntries(new FormData(form).entries());
        payload.monthlyRate = Number(payload.monthlyRate || 0);
        payload.openingBalance = Number(payload.openingBalance || 0);
        payload.billingDay = Number(payload.billingDay || 1);
        payload.napPort = payload.napPort ? Number(payload.napPort) : null;
        payload.napId = String(payload.napId || '').trim();
        const rawMapPin = String(payload.mapPin || '').trim();
        const parsedMapPin = rawMapPin ? parseCoordinates(rawMapPin) : null;
        if (rawMapPin && !parsedMapPin) {
            showToast('Enter valid decimal or DMS latitude and longitude.', 'error');
            byId('customerMapPin').focus();
            return;
        }
        payload.mapPin = parsedMapPin ? formatCoordinates(parsedMapPin.lat, parsedMapPin.lng) : '';
        const button = byId('saveCustomerBtn');
        button.disabled = true;
        try {
            await api(accountNumber ? `/customers/${encodeURIComponent(accountNumber)}` : '/customers', {
                method: accountNumber ? 'PUT' : 'POST',
                body: payload
            });
            byId('customerDialog').close();
            await loadWorkspace();
            state.network.loaded = false;
            showToast(accountNumber ? 'Temp customer updated.' : 'Temp customer added.');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    }

    function synchronizeCustomerPlanAndRate(source) {
        if (source === 'plan') {
            byId('customerRate').value = String(TEMP_PLAN_RATES[byId('customerPlan').value] || 700);
            return;
        }
        const selectedRate = Number(byId('customerRate').value);
        byId('customerPlan').value = Object.keys(TEMP_PLAN_RATES)
            .find((planName) => TEMP_PLAN_RATES[planName] === selectedRate) || 'Old plan';
    }

    function updateCustomerBillingScheduleFields() {
        const billingScheduleMode = byId('customerBillingScheduleMode').value;
        const usesExactDate = billingScheduleMode === 'date';
        byId('customerNextBillingDateField').hidden = !usesExactDate;
        byId('customerNextBillingDate').disabled = !usesExactDate;
        byId('customerNextBillingDate').required = usesExactDate;
        byId('customerBillingDayField').hidden = usesExactDate;
        byId('customerBillingDay').disabled = usesExactDate;
        if (usesExactDate && !byId('customerNextBillingDate').value) {
            byId('customerNextBillingDate').value = defaultNextBillingDate();
        }
        updateCustomerCycleHint();
    }

    function updateCustomerCycleHint() {
        const planType = byId('customerPlanType').value;
        const billingScheduleMode = byId('customerBillingScheduleMode').value;
        const billingDay = Math.min(31, Math.max(1, Number(byId('customerBillingDay').value) || 1));
        const nextBillingDate = byId('customerNextBillingDate').value;
        const hint = byId('customerCycleHint');
        hint.classList.toggle('cycle-hint--prepaid', planType === 'prepaid');
        hint.classList.toggle('cycle-hint--prorate', planType === 'prorate');
        if (billingScheduleMode === 'date') {
            const selectedDate = nextBillingDate ? formatDate(nextBillingDate) : 'the selected date';
            hint.querySelector('span').textContent = `Opening balance stays manual. The first automatic full monthly charge is on ${selectedDate}, then it repeats monthly.`;
            return;
        }
        if (planType === 'prorate') {
            hint.querySelector('span').textContent = `The first charge is prorated from Activation date to Billing day ${billingDay}. Later cycles charge the full monthly rate.`;
            return;
        }
        hint.querySelector('span').textContent = `The full monthly rate is automatically charged every month on Billing day ${billingDay}. Opening balance remains exactly as entered.`;
    }

    async function savePayment(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        if (normalizedPaymentMethod(byId('paymentMethod').value) === 'gcash') {
            showToast('Use GCash Posting to verify an imported official credit and prevent duplicates.', 'error');
            return;
        }
        const paymentId = byId('paymentEditId').value;
        const payload = Object.fromEntries(new FormData(form).entries());
        payload.amount = Number(payload.amount);
        const button = byId('savePaymentBtn');
        button.disabled = true;
        try {
            await api(paymentId ? `/payments/${encodeURIComponent(paymentId)}` : '/payments', {
                method: paymentId ? 'PUT' : 'POST',
                body: payload
            });
            byId('paymentDialog').close();
            await loadWorkspace();
            showToast(paymentId ? 'Temp transaction updated.' : 'Temp transaction recorded.');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            button.disabled = false;
            updateManualGcashNotice();
        }
    }

    async function handleCustomerAction(event) {
        const button = event.target.closest('[data-customer-action]');
        if (!button) return;
        const accountNumber = button.dataset.account;
        const customer = state.customers.find((item) => item.accountNumber === accountNumber);
        if (!customer) return;
        if (button.dataset.customerAction === 'edit') openCustomerDialog(customer);
        if (button.dataset.customerAction === 'payment') openPaymentDialog(null, accountNumber);
        if (button.dataset.customerAction === 'statement') openStatement(accountNumber);
        if (button.dataset.customerAction === 'delete') {
            if (!window.confirm(`Delete ${customer.fullName} from the Temp workspace?`)) return;
            try {
                await api(`/customers/${encodeURIComponent(accountNumber)}`, { method: 'DELETE' });
                await loadWorkspace();
                showToast('Temp customer deleted.');
            } catch (error) {
                showToast(error.message, 'error');
            }
        }
    }

    async function handlePaymentAction(event) {
        const button = event.target.closest('[data-payment-action]');
        if (!button) return;
        const payment = state.payments.find((item) => item.id === button.dataset.paymentId);
        if (!payment) return;
        if (button.dataset.paymentAction === 'receipt') openReceipt(payment.id);
        if (button.dataset.paymentAction === 'edit') openPaymentDialog(payment);
        if (button.dataset.paymentAction === 'delete') {
            if (paymentIsImmutable(payment)) {
                showToast('This protected transaction cannot be deleted.', 'error');
                return;
            }
            if (!window.confirm(`Delete transaction ${payment.receiptNumber}?`)) return;
            try {
                await api(`/payments/${encodeURIComponent(payment.id)}`, { method: 'DELETE' });
                await loadWorkspace();
                showToast('Temp transaction deleted.');
            } catch (error) {
                showToast(error.message, 'error');
            }
        }
    }

    async function exportWorkspace(format) {
        const normalizedFormat = format === 'xlsx' ? 'xlsx' : 'json';
        const formatButtons = [byId('exportJsonBtn'), byId('exportExcelBtn')];
        formatButtons.forEach((button) => { button.disabled = true; });
        try {
            const response = await fetch(`${API_ROOT}/export?format=${normalizedFormat}`, {
                credentials: 'same-origin'
            });
            if (response.status === 401) {
                window.location.assign('/login.html');
                throw new Error('Your session expired. Sign in again.');
            }
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || `Export failed (${response.status}).`);
            }
            const blob = await response.blob();
            const fallback = `temp-workspace.${normalizedFormat === 'xlsx' ? 'xlsx' : 'json'}`;
            const filename = filenameFromDisposition(response.headers.get('Content-Disposition'), fallback);
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            link.hidden = true;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
            byId('exportFormatDialog').close();
            showToast(`Complete Temp backup exported as ${normalizedFormat === 'xlsx' ? 'Excel' : 'JSON'}.`);
        } catch (error) {
            showToast(error.message || 'Unable to export the Temp workspace.', 'error');
        } finally {
            formatButtons.forEach((button) => { button.disabled = false; });
        }
    }

    async function exportCollectorWorkbook() {
        const button = byId('exportCollectorBtn');
        button.disabled = true;
        try {
            const response = await fetch(`${API_ROOT}/collector-export`, { credentials: 'same-origin' });
            if (response.status === 401) {
                window.location.assign('/login.html');
                throw new Error('Your session expired. Sign in again.');
            }
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || `Collector export failed (${response.status}).`);
            }
            const blob = await response.blob();
            const filename = filenameFromDisposition(
                response.headers.get('Content-Disposition'),
                'temp-collector.xlsx'
            );
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            link.hidden = true;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
            showToast('Collector Excel exported.');
        } catch (error) {
            showToast(error.message || 'Unable to export the Collector Excel file.', 'error');
        } finally {
            button.disabled = false;
        }
    }

    async function exportPaymentHistory() {
        const month = byId('historyMonth').value || currentMonth();
        const button = byId('exportPaymentHistoryBtn');
        button.disabled = true;
        try {
            const response = await fetch(`${API_ROOT}/payment-history-export?month=${encodeURIComponent(month)}`, {
                credentials: 'same-origin'
            });
            if (response.status === 401) {
                window.location.assign('/login.html');
                throw new Error('Your session expired. Sign in again.');
            }
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || `Payment history export failed (${response.status}).`);
            }
            const blob = await response.blob();
            const filename = filenameFromDisposition(response.headers.get('Content-Disposition'), `temp-payment-history-${month}.xlsx`);
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            link.hidden = true;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
            showToast(`Temp-only payment history for ${month} exported.`);
        } catch (error) {
            showToast(error.message || 'Unable to export Temp payment history.', 'error');
        } finally {
            button.disabled = false;
        }
    }

    function handleGcashTableAction(event) {
        const button = event.target.closest('[data-gcash-action="allocate"]');
        if (!button) return;
        openGcashAllocation(button.dataset.gcashReference);
    }

    async function importWorkspace(file) {
        if (!file) return;
        const extension = file.name.toLowerCase().match(/\.(json|xlsx|xls)$/)?.[1];
        if (!extension) {
            showToast('Select an exported Temp JSON, XLSX, or XLS file.', 'error');
            byId('importWorkspaceFile').value = '';
            return;
        }
        if (!window.confirm('Importing this file will replace every Temp customer and transaction. Continue?')) {
            byId('importWorkspaceFile').value = '';
            return;
        }
        const importButton = byId('importWorkspaceBtn');
        importButton.disabled = true;
        try {
            const response = await fetch(`${API_ROOT}/import-file`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Import-Filename': encodeURIComponent(file.name)
                },
                body: file
            });
            if (response.status === 401) {
                window.location.assign('/login.html');
                throw new Error('Your session expired. Sign in again.');
            }
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || `Import failed (${response.status}).`);
            updateState(result);
            renderAll();
            if (state.gcash.loaded) await loadGcash();
            showToast(result.message || 'Temp workspace imported.');
        } catch (error) {
            showToast(error.message || 'Unable to import that file.', 'error');
        } finally {
            importButton.disabled = false;
            byId('importWorkspaceFile').value = '';
        }
    }

    async function clearWorkspaceData() {
        const customerCount = state.customers.length;
        const transactionCount = state.payments.length;
        if (!customerCount && !transactionCount) {
            showToast('The Temp workspace is already empty.');
            return;
        }
        const confirmed = window.confirm(
            `Permanently delete all ${customerCount} Temp customers and ${transactionCount} transactions? `
            + 'This cannot be undone. Export a backup first if you may need these records.'
        );
        if (!confirmed) return;

        const button = byId('clearWorkspaceBtn');
        button.disabled = true;
        try {
            const result = await api('/workspace', { method: 'DELETE' });
            updateState(result);
            renderAll();
            if (state.gcash.loaded) await loadGcash();
            showToast(result.message || 'All Temp data was cleared.');
        } catch (error) {
            showToast(error.message || 'Unable to clear the Temp workspace.', 'error');
        } finally {
            button.disabled = false;
        }
    }

    document.querySelectorAll('[data-panel]').forEach((tab) => {
        tab.addEventListener('click', () => activatePanel(tab.dataset.panel));
        tab.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const tabs = Array.from(document.querySelectorAll('[data-panel]'));
            const currentIndex = tabs.indexOf(tab);
            const offset = event.key === 'ArrowRight' ? 1 : -1;
            const nextTab = tabs[(currentIndex + offset + tabs.length) % tabs.length];
            activatePanel(nextTab.dataset.panel, { focus: true });
        });
    });
    document.querySelectorAll('[data-close-dialog]').forEach((button) => {
        button.addEventListener('click', () => byId(button.dataset.closeDialog).close());
    });
    document.querySelectorAll('.temp-dialog').forEach((dialog) => {
        dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
        });
    });

    byId('historyMonth').value = currentMonth();
    byId('gcashMonth').value = currentMonth();
    byId('customerSearch').addEventListener('input', () => { resetPage('customer'); renderCustomers(); });
    byId('customerStatusFilter').addEventListener('change', () => { resetPage('customer'); renderCustomers(); });
    byId('paymentSearch').addEventListener('input', () => { resetPage('payment'); renderPayments(); });
    byId('paymentKindFilter').addEventListener('change', () => { resetPage('payment'); renderPayments(); });
    ['historySearch', 'historyMonth', 'historyMethodFilter', 'historyRecorderFilter', 'historySort'].forEach((id) => {
        byId(id).addEventListener(id === 'historySearch' ? 'input' : 'change', () => { resetPage('history'); renderPaymentHistory(); });
    });
    ['customer', 'payment', 'history'].forEach((group) => {
        byId(`${group}PageSize`).addEventListener('change', (event) => {
            pageState[group].pageSize = Math.max(1, Number(event.target.value) || 25);
            resetPage(group);
            if (group === 'customer') renderCustomers();
            if (group === 'payment') renderPayments();
            if (group === 'history') renderPaymentHistory();
        });
    });
    document.addEventListener('click', handlePagerClick);
    document.addEventListener('change', handlePageSelect);
    document.querySelectorAll('[data-sort-group]').forEach((button) => button.addEventListener('click', handleTableSort));
    byId('customerTableBody').addEventListener('click', handleCustomerAction);
    byId('paymentTableBody').addEventListener('click', handlePaymentAction);
    byId('historyTableBody').addEventListener('click', handlePaymentAction);
    byId('gcashTableBody').addEventListener('click', handleGcashTableAction);
    byId('addCustomerBtn').addEventListener('click', () => openCustomerDialog());
    byId('addPaymentBtn').addEventListener('click', () => openPaymentDialog());
    byId('customerForm').addEventListener('submit', saveCustomer);
    byId('customerPlan').addEventListener('change', () => synchronizeCustomerPlanAndRate('plan'));
    byId('customerRate').addEventListener('change', () => synchronizeCustomerPlanAndRate('rate'));
    byId('customerNap').addEventListener('change', () => renderNetworkPorts());
    byId('customerNapPort').addEventListener('change', renderNetworkHint);
    byId('clearNetworkAssignmentBtn').addEventListener('click', () => {
        byId('customerNap').value = '';
        renderNetworkPorts();
    });
    byId('openCoordinatePickerBtn').addEventListener('click', openCoordinatePicker);
    byId('openNapMapPickerBtn').addEventListener('click', openNapMapPicker);
    byId('napMapPort').addEventListener('change', (event) => {
        napMapDraftPort = String(event.target.value || '');
        renderNapMapSelection();
    });
    byId('useNapSelectionBtn').addEventListener('click', useNapMapSelection);
    byId('useCurrentLocationBtn').addEventListener('click', useCurrentLocation);
    byId('useCoordinatesBtn').addEventListener('click', () => {
        if (!parseCoordinates(coordinateDraftPin)) {
            showToast('Choose a valid point on the map first.', 'error');
            return;
        }
        byId('customerMapPin').value = coordinateDraftPin;
        byId('coordinateDialog').close();
    });
    byId('customerPlanType').addEventListener('change', updateCustomerCycleHint);
    byId('customerBillingScheduleMode').addEventListener('change', updateCustomerBillingScheduleFields);
    byId('customerNextBillingDate').addEventListener('change', updateCustomerCycleHint);
    byId('customerBillingDay').addEventListener('input', updateCustomerCycleHint);
    byId('paymentForm').addEventListener('submit', savePayment);
    byId('paymentMethod').addEventListener('change', updateManualGcashNotice);
    byId('paymentKind').addEventListener('change', updateManualGcashNotice);
    byId('openGcashPostingBtn').addEventListener('click', () => {
        byId('paymentDialog').close();
        const wasLoaded = state.gcash.loaded;
        activatePanel('gcash');
        if (wasLoaded) loadGcash();
    });
    byId('clearWorkspaceBtn').addEventListener('click', clearWorkspaceData);
    byId('refreshWorkspaceBtn').addEventListener('click', () => loadWorkspace({ notify: true }));
    byId('exportWorkspaceBtn').addEventListener('click', () => byId('exportFormatDialog').showModal());
    byId('exportCollectorBtn').addEventListener('click', exportCollectorWorkbook);
    byId('exportPaymentHistoryBtn').addEventListener('click', exportPaymentHistory);
    byId('exportJsonBtn').addEventListener('click', () => exportWorkspace('json'));
    byId('exportExcelBtn').addEventListener('click', () => exportWorkspace('xlsx'));
    byId('importWorkspaceBtn').addEventListener('click', () => byId('importWorkspaceFile').click());
    byId('importWorkspaceFile').addEventListener('change', (event) => importWorkspace(event.target.files?.[0]));
    byId('printStatementBtn').addEventListener('click', () => window.print());
    byId('printReceiptBtn').addEventListener('click', () => window.print());
    byId('gcashMonth').addEventListener('change', () => loadGcash());
    byId('refreshGcashBtn').addEventListener('click', () => loadGcash({ notify: true }));
    byId('addGcashAllocationBtn').addEventListener('click', addGcashAllocation);
    byId('gcashAllocationRows').addEventListener('input', handleGcashAllocationInput);
    byId('gcashAllocationRows').addEventListener('change', handleGcashAllocationInput);
    byId('gcashAllocationRows').addEventListener('click', handleGcashAllocationRemove);
    byId('gcashAllocationForm').addEventListener('submit', postGcashAllocation);
    const panelFromHash = () => {
        const requested = location.hash.toLowerCase().replace(/^#/, '');
        return ['customers', 'billing', 'history', 'gcash'].includes(requested) ? requested : 'customers';
    };
    window.addEventListener('hashchange', () => activatePanel(panelFromHash(), { updateHash: false }));

    renderSortHeaders('customer');
    renderSortHeaders('payment');
    activatePanel(panelFromHash(), { updateHash: false });
    loadWorkspace();
})();
