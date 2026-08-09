(function () {
  const TERMINAL_STATUSES = new Set(['completed', 'cancelled']);
  const ACTIVE_STATUSES = new Set(['assigned', 'accepted', 'traveling', 'on_site']);
  const BUSY_STATUSES = new Set(['accepted', 'traveling', 'on_site']);
  const STATUS_LABELS = {
    unassigned: 'Unassigned',
    assigned: 'Assigned',
    accepted: 'Accepted',
    traveling: 'Traveling',
    on_site: 'On Site',
    completed: 'Completed',
    failed: 'Failed',
    rescheduled: 'Rescheduled',
    needs_team: 'Needs Team',
    rejected: 'Rejected',
    cancelled: 'Cancelled'
  };
  const PRIORITY_ORDER = { emergency: 0, urgent: 1, high: 2, normal: 3, low: 4 };
  const NETWORK_LINKS_MIN_ZOOM = 14;
  const MAP_LAYER_PREFERENCE_KEY = 'technicianJobMapLayersV1';

  const elements = {
    tableBody: document.getElementById('jobTableBody'),
    footerSummary: document.getElementById('jobFooterSummary'),
    pageInfo: document.getElementById('jobPageInfo'),
    prevPage: document.getElementById('jobPrevPage'),
    nextPage: document.getElementById('jobNextPage'),
    search: document.getElementById('jobSearch'),
    statusFilter: document.getElementById('jobStatusFilter'),
    technicianFilter: document.getElementById('jobTechnicianFilter'),
    priorityFilter: document.getElementById('jobPriorityFilter'),
    refresh: document.getElementById('refreshDispatchBtn'),
    metricActive: document.getElementById('metricActive'),
    metricUnassigned: document.getElementById('metricUnassigned'),
    metricOverdue: document.getElementById('metricOverdue'),
    metricAvailable: document.getElementById('metricAvailable'),
    workloadList: document.getElementById('technicianWorkloadList'),
    map: document.getElementById('dispatchMap'),
    mapEmpty: document.getElementById('dispatchMapEmpty'),
    mapEmptyTitle: document.getElementById('dispatchMapEmptyTitle'),
    mapEmptyCopy: document.getElementById('dispatchMapEmptyCopy'),
    mapEmptyAction: document.getElementById('dispatchMapEmptyAction'),
    mapCount: document.getElementById('jobMapCount'),
    mapFooter: document.getElementById('dispatchMapFooter'),
    mapMissingCount: document.getElementById('jobMapMissingCount'),
    mapReviewMissing: document.getElementById('jobMapReviewMissing'),
    mapShowJobs: document.getElementById('jobMapShowJobs'),
    mapShowNaps: document.getElementById('jobMapShowNaps'),
    mapShowLinks: document.getElementById('jobMapShowLinks'),
    mapFitLayers: document.getElementById('jobMapFitLayers'),
    mapNetworkSummary: document.getElementById('jobMapNetworkSummary'),
    toast: document.getElementById('techToast'),
    toastBody: document.getElementById('techToastBody'),
    openJobModal: document.getElementById('openJobModal'),
    jobModal: document.getElementById('jobModal'),
    jobModalClose: document.getElementById('jobModalClose'),
    jobModalCancel: document.getElementById('jobModalCancel'),
    jobForm: document.getElementById('jobModalForm'),
    jobModalEyebrow: document.getElementById('jobModalEyebrow'),
    jobModalTitle: document.getElementById('jobModalTitle'),
    jobModalSubmit: document.getElementById('jobModalSubmit'),
    jobEntryId: document.getElementById('jobEntryId'),
    jobCustomer: document.getElementById('jobCustomer'),
    jobCustomerHint: document.getElementById('jobCustomerHint'),
    jobType: document.getElementById('jobType'),
    jobPriority: document.getElementById('jobPriority'),
    jobTech: document.getElementById('jobTech'),
    jobMapPin: document.getElementById('jobMapPin'),
    jobMapPinHint: document.getElementById('jobMapPinHint'),
    appointmentStart: document.getElementById('jobAppointmentStart'),
    appointmentEnd: document.getElementById('jobAppointmentEnd'),
    slaDue: document.getElementById('jobSlaDue'),
    description: document.getElementById('jobDescription'),
    equipment: document.getElementById('jobEquipment'),
    materials: document.getElementById('jobMaterials'),
    detailsModal: document.getElementById('jobDetailsModal'),
    detailsClose: document.getElementById('jobDetailsClose'),
    detailsDone: document.getElementById('jobDetailsDone'),
    detailsEdit: document.getElementById('jobDetailsEdit'),
    detailsLocation: document.getElementById('jobDetailsLocation'),
    detailsDelete: document.getElementById('jobDetailsDelete'),
    detailsEyebrow: document.getElementById('jobDetailsEyebrow'),
    detailsTitle: document.getElementById('jobDetailsTitle'),
    detailsSummary: document.getElementById('jobDetailsSummary'),
    detailsStatus: document.getElementById('jobDetailsStatus'),
    detailsUpdateStatus: document.getElementById('jobDetailsUpdateStatus'),
    eventTimeline: document.getElementById('jobEventTimeline')
  };

  const state = {
    jobs: [],
    customers: [],
    naps: [],
    technicians: [],
    summary: null,
    activeJobId: null,
    page: 1,
    pageSize: 25,
    map: null,
    markerLayer: null,
    napLayer: null,
    linkLayer: null,
    focusLayer: null,
    focusedNetworkLabel: '',
    networkLoadError: '',
    networkMetrics: {
      naps: 0,
      links: 0,
      visibleLinks: 0,
      unmatchedLinks: 0,
      workOrders: 0,
      portsUsed: 0,
      fallbackLinks: 0,
      fallbackNaps: 0,
      duplicateJobs: 0
    },
    mapPoints: { jobs: [], naps: [], links: [] },
    mapTilesUnavailable: false
  };

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const notify = (message, type = 'info') => {
    if (typeof window.appToast === 'function') {
      window.appToast(message, { type });
      return;
    }
    if (!elements.toast) return;
    if (elements.toastBody) elements.toastBody.textContent = message;
    else elements.toast.textContent = message;
    elements.toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => elements.toast.classList.remove('show'), 2600);
  };

  const confirmAction = async (message, options = {}) => {
    if (typeof window.appConfirm === 'function') {
      const result = await window.appConfirm(message, options);
      return result === true || result?.ok === true || result?.confirmed === true;
    }
    return window.confirm(message);
  };

  const requestJson = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error || payload?.message || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  };

  const hasAccountRole = (account, role) => {
    const wanted = String(role || '').trim().toLowerCase();
    const values = Array.isArray(account?.roles)
      ? account.roles
      : String(account?.role || '').split(/[,/|;]+|\s+\+\s+|\s+and\s+/i);
    return values.some((value) => String(value || '').trim().toLowerCase() === wanted);
  };

  const technicianName = (account = {}) => String(
    account.username || account.name || account.displayName || `Technician ${account.id || ''}`
  ).trim();

  const customerName = (customer = {}) => String(
    customer.name || [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.accountNumber || ''
  ).trim();

  const customerLabel = (customer = {}) => {
    const name = customerName(customer) || 'Unnamed customer';
    const account = String(customer.accountNumber || '').trim();
    return account ? `${account} · ${name}` : name;
  };

  const customerMapPin = (customer = {}) => String(
    customer.mapPin || customer.map_pin || customer.coordinates || customer.coordinate || ''
  ).trim();

  const parseCoordinateInput = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const decoded = (() => {
      try {
        return decodeURIComponent(raw.replace(/\+/g, ' '));
      } catch (_error) {
        return raw;
      }
    })();
    const isValidPair = (latitude, longitude) => (
      Number.isFinite(latitude)
      && latitude >= -90
      && latitude <= 90
      && Number.isFinite(longitude)
      && longitude >= -180
      && longitude <= 180
    );
    const decimalMatch = decoded.match(/(?:@|[?&](?:q|query|ll)=)?(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/i);
    if (decimalMatch) {
      const latitude = Number(decimalMatch[1]);
      const longitude = Number(decimalMatch[2]);
      if (isValidPair(latitude, longitude)) return { latitude, longitude };
    }
    const plainParts = decoded.trim().split(/\s+/).filter(Boolean);
    if (plainParts.length === 2) {
      const latitude = Number(plainParts[0]);
      const longitude = Number(plainParts[1]);
      if (isValidPair(latitude, longitude)) return { latitude, longitude };
    }

    const normalizedDms = decoded
      .replace(/[\u00BA\u02DA]/g, '\u00B0')
      .replace(/[\u2032\u2019]/g, "'")
      .replace(/[\u2033\u201C\u201D]/g, '"')
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const parseDmsSegment = (segment) => {
      const text = String(segment || '').trim().toUpperCase();
      const hemisphere = text.match(/[NSEW]/)?.[0] || '';
      const numericParts = text.replace(/[NSEW]/g, ' ').match(/-?\d+(?:\.\d+)?/g) || [];
      if (!hemisphere || !numericParts.length) return null;
      const degrees = Number(numericParts[0]);
      const minutes = Number(numericParts[1] || 0);
      const seconds = Number(numericParts[2] || 0);
      if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
      if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
      let decimal = Math.abs(degrees) + (minutes / 60) + (seconds / 3600);
      if (hemisphere === 'S' || hemisphere === 'W') decimal *= -1;
      return { value: decimal, hemisphere };
    };
    const segments = normalizedDms.match(/(?:[NSEW][^NSEW]+|[^NSEW]+[NSEW])/gi) || [];
    const parsedSegments = segments.map(parseDmsSegment).filter(Boolean);
    const latitude = parsedSegments.find((entry) => ['N', 'S'].includes(entry.hemisphere))?.value;
    const longitude = parsedSegments.find((entry) => ['E', 'W'].includes(entry.hemisphere))?.value;
    return isValidPair(latitude, longitude) ? { latitude, longitude } : null;
  };

  const jobCoordinates = (job = {}) => {
    if (job.latitude == null || job.latitude === '' || job.longitude == null || job.longitude === '') return null;
    const latitude = Number(job.latitude);
    const longitude = Number(job.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
    return { latitude, longitude };
  };

  const jobMapPin = (job = {}) => {
    const coordinates = jobCoordinates(job);
    return coordinates ? `${coordinates.latitude}, ${coordinates.longitude}` : '';
  };

  const normalizeLookupKey = (value) => String(value || '').trim().toLowerCase();

  const coordinatesFromSource = (source = {}) => {
    const latitudeValue = source.latitude ?? source.lat;
    const longitudeValue = source.longitude ?? source.lng ?? source.lon;
    const latitude = String(latitudeValue ?? '').trim() ? Number(latitudeValue) : NaN;
    const longitude = String(longitudeValue ?? '').trim() ? Number(longitudeValue) : NaN;
    if (
      Number.isFinite(latitude)
      && latitude >= -90
      && latitude <= 90
      && Number.isFinite(longitude)
      && longitude >= -180
      && longitude <= 180
    ) {
      return { latitude, longitude };
    }
    const coordinateKeys = [
      'mapPin',
      'map_pin',
      'coordinate',
      'coordinates',
      'coords',
      'pin',
      'locationPin',
      'gps',
      'gpsCoordinates'
    ];
    for (const key of coordinateKeys) {
      const parsed = parseCoordinateInput(source?.[key]);
      if (parsed) return parsed;
    }
    return null;
  };

  const normalizeStatus = (job = {}) => {
    const raw = String(job.workflowStatus || job.workflow_status || job.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (STATUS_LABELS[raw]) return raw;
    if (['done', 'closed', 'resolved'].includes(raw)) return 'completed';
    if (['in_progress', 'inprogress'].includes(raw)) return 'accepted';
    if (raw === 'scheduled') return String(job.technician || '').trim() ? 'assigned' : 'unassigned';
    return String(job.technician || '').trim() ? 'assigned' : 'unassigned';
  };

  const statusBadge = (status) => {
    const normalized = STATUS_LABELS[status] ? status : 'unassigned';
    const color = {
      unassigned: 'secondary',
      assigned: 'blue',
      accepted: 'azure',
      traveling: 'indigo',
      on_site: 'purple',
      completed: 'green',
      failed: 'red',
      rescheduled: 'orange',
      needs_team: 'yellow',
      rejected: 'pink',
      cancelled: 'red'
    }[normalized] || 'secondary';
    return `<span class="badge bg-${color}-lt text-${color}">${escapeHtml(STATUS_LABELS[normalized])}</span>`;
  };

  const priorityBadge = (priority) => {
    const normalized = String(priority || 'normal').trim().toLowerCase();
    const label = normalized.charAt(0).toUpperCase() + normalized.slice(1);
    const color = {
      emergency: 'red',
      urgent: 'orange',
      high: 'yellow',
      normal: 'blue',
      low: 'secondary'
    }[normalized] || 'secondary';
    return `<span class="badge bg-${color}-lt text-${color}">${escapeHtml(label)}</span>`;
  };

  const formatDateTime = (value, fallback = 'Not scheduled') => {
    const parsed = new Date(value || '');
    if (!Number.isFinite(parsed.getTime())) return fallback;
    return parsed.toLocaleString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const toLocalInputValue = (value) => {
    const parsed = new Date(value || '');
    if (!Number.isFinite(parsed.getTime())) return '';
    const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };

  const fromLocalInputValue = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
  };

  const setDefaultSchedule = () => {
    const start = new Date();
    start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    elements.appointmentStart.value = toLocalInputValue(start);
    elements.appointmentEnd.value = toLocalInputValue(end);
    updateRecommendedSla();
  };

  const updateRecommendedSla = () => {
    const start = new Date(elements.appointmentStart?.value || '');
    if (!Number.isFinite(start.getTime()) || !elements.slaDue) return;
    const hours = {
      emergency: 2,
      urgent: 4,
      high: 12,
      normal: 24,
      low: 72
    }[elements.jobPriority?.value] || 24;
    elements.slaDue.value = toLocalInputValue(new Date(start.getTime() + hours * 60 * 60 * 1000));
  };

  const initials = (value) => String(value || 'NA')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const createClientEventId = () => {
    if (window.crypto?.randomUUID) return `web-${window.crypto.randomUUID()}`;
    return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const parseItemLines = (value) => String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, quantity, unit, serialNumber] = line.split('|').map((part) => part.trim());
      return {
        name,
        quantity: Math.max(0, Number(quantity || 1) || 1),
        unit: unit || '',
        serialNumber: serialNumber || ''
      };
    });

  const itemLines = (items) => (Array.isArray(items) ? items : [])
    .map((item) => [item.name, item.quantity || 1, item.unit || '', item.serialNumber || ''].join(' | ').replace(/( \| ?)+$/, ''))
    .join('\n');

  const customerByAccount = (accountNumber) => state.customers.find((customer) =>
    String(customer?.accountNumber || '').trim() === String(accountNumber || '').trim()
  );

  const activeJob = () => state.jobs.find((job) => Number(job.id) === Number(state.activeJobId)) || null;

  const openModalElement = (modal) => {
    if (!modal) return;
    modal.classList.add('active', 'show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-active');
  };

  const closeModalElement = (modal) => {
    if (!modal) return;
    modal.classList.remove('active', 'show');
    modal.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.technician-modal.active')) document.body.classList.remove('modal-active');
  };

  const populateTechnicianSelects = () => {
    const currentFormValue = elements.jobTech?.value || '';
    const currentFilterValue = elements.technicianFilter?.value || '';
    const options = state.technicians.map((account) => {
      const name = technicianName(account);
      return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
    }).join('');
    if (elements.jobTech) {
      elements.jobTech.innerHTML = `<option value="">Leave unassigned</option>${options}`;
      elements.jobTech.value = currentFormValue;
    }
    if (elements.technicianFilter) {
      elements.technicianFilter.innerHTML = `<option value="">All technicians</option>${options}`;
      elements.technicianFilter.value = currentFilterValue;
    }
  };

  const populateCustomerSelect = () => {
    if (!elements.jobCustomer) return;
    const selected = elements.jobCustomer.value;
    const options = state.customers
      .slice()
      .sort((left, right) => customerLabel(left).localeCompare(customerLabel(right)))
      .map((customer) => `<option value="${escapeHtml(customer.accountNumber || '')}">${escapeHtml(customerLabel(customer))}</option>`)
      .join('');
    elements.jobCustomer.innerHTML = `<option value="">No linked customer</option>${options}`;
    elements.jobCustomer.value = selected;
  };

  const updateCustomerHint = () => {
    if (!elements.jobCustomerHint) return;
    const customer = customerByAccount(elements.jobCustomer?.value);
    if (!customer) {
      elements.jobCustomerHint.textContent = 'Choose a customer to copy account, contact, plan, address, and GPS details.';
      return;
    }
    const address = [customer.street, customer.barangay, customer.municipality, customer.province]
      .filter(Boolean)
      .join(', ');
    elements.jobCustomerHint.textContent = [
      customer.planName || 'No plan',
      customer.mobileRaw || customer.mobile || 'No phone',
      address || 'No service address',
      customerMapPin(customer) ? 'GPS ready' : 'No GPS pin'
    ].join(' · ');
  };

  const copyCustomerMapPin = () => {
    if (!elements.jobMapPin) return;
    const customer = customerByAccount(elements.jobCustomer?.value);
    elements.jobMapPin.value = customer ? customerMapPin(customer) : '';
    if (elements.jobMapPinHint) {
      elements.jobMapPinHint.textContent = customer && !customerMapPin(customer)
        ? 'This customer has no saved Map Pin. Enter decimal or DMS coordinates for this work order.'
        : 'Automatically copied from the selected customer. Decimal and DMS coordinates are accepted.';
    }
  };

  const getFilteredJobs = () => {
    const query = String(elements.search?.value || '').trim().toLowerCase();
    const statusFilter = elements.statusFilter?.value || 'open';
    const technicianFilter = String(elements.technicianFilter?.value || '').trim().toLowerCase();
    const priorityFilter = elements.priorityFilter?.value || '';
    return state.jobs.filter((job) => {
      const status = normalizeStatus(job);
      if (statusFilter === 'open' && TERMINAL_STATUSES.has(status)) return false;
      if (statusFilter !== 'open' && statusFilter !== 'all' && status !== statusFilter) return false;
      if (technicianFilter && String(job.technician || '').trim().toLowerCase() !== technicianFilter) return false;
      if (priorityFilter && String(job.priority || '').toLowerCase() !== priorityFilter) return false;
      if (!query) return true;
      return [
        job.jobNumber,
        job.ticketNumber,
        job.type,
        job.customerAccountNumber,
        job.customerName,
        job.customerPhone,
        job.serviceAddress,
        job.technician,
        job.description,
        job.priority,
        status
      ].join(' ').toLowerCase().includes(query);
    }).sort((left, right) => {
      const priorityDiff = (PRIORITY_ORDER[left.priority] ?? 3) - (PRIORITY_ORDER[right.priority] ?? 3);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(left.appointmentStart || left.schedule || 0) - new Date(right.appointmentStart || right.schedule || 0);
    });
  };

  const slaState = (job) => {
    const dueAt = new Date(job.slaDueAt || '');
    if (!Number.isFinite(dueAt.getTime()) || TERMINAL_STATUSES.has(normalizeStatus(job))) return null;
    const remaining = dueAt.getTime() - Date.now();
    if (remaining < 0) return { badgeClass: 'bg-red-lt text-red', label: 'Overdue' };
    if (remaining <= 4 * 60 * 60 * 1000) return { badgeClass: 'bg-orange-lt text-orange', label: 'Due soon' };
    return { badgeClass: 'bg-secondary-lt text-secondary', label: formatDateTime(dueAt) };
  };

  const renderJobs = () => {
    if (!elements.tableBody) return;
    const jobs = getFilteredJobs();
    const totalPages = Math.max(1, Math.ceil(jobs.length / state.pageSize));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * state.pageSize;
    const pageRows = jobs.slice(start, start + state.pageSize);

    if (!pageRows.length) {
      elements.tableBody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-5">
            <div class="empty py-3">
              <div class="empty-icon"><i class="ti ti-clipboard-off text-secondary"></i></div>
              <p class="empty-title">No work orders found</p>
              <p class="empty-subtitle text-secondary">No work orders match the current filters.</p>
            </div>
          </td>
        </tr>`;
    } else {
      elements.tableBody.innerHTML = pageRows.map((job) => {
        const status = normalizeStatus(job);
        const sla = slaState(job);
        const jobNumber = job.jobNumber || job.ticketNumber || `JOB-${String(job.id || '').padStart(8, '0')}`;
        const customer = job.customerName || job.customerAccountNumber || 'No linked customer';
        const appointment = job.appointmentStart || job.schedule;
        return `
          <tr data-job-id="${escapeHtml(job.id)}">
            <td>
              <span class="technician-cell-primary fw-semibold">${escapeHtml(jobNumber)}</span>
              <span class="technician-cell-secondary text-capitalize">${escapeHtml(String(job.type || 'general').replace(/[-_]/g, ' '))}</span>
            </td>
            <td>
              <span class="technician-cell-primary fw-semibold">${escapeHtml(customer)}</span>
              <span class="technician-cell-secondary">${escapeHtml(job.customerAccountNumber || job.serviceAddress || 'No account snapshot')}</span>
            </td>
            <td>
              ${job.technician
                ? `<span class="technician-cell-primary fw-semibold">${escapeHtml(job.technician)}</span><span class="technician-cell-secondary">Assigned</span>`
                : '<span class="badge bg-yellow-lt text-yellow">Pending assignment</span>'}
            </td>
            <td><span class="technician-cell-primary fw-semibold">${escapeHtml(formatDateTime(appointment))}</span><span class="technician-cell-secondary">to ${escapeHtml(formatDateTime(job.appointmentEnd, 'Open window'))}</span></td>
            <td><span class="technician-sla-stack">${priorityBadge(job.priority)}${sla ? `<span class="badge ${sla.badgeClass}">${escapeHtml(sla.label)}</span>` : ''}</span></td>
            <td>${statusBadge(status)}</td>
            <td class="text-center">
              <div class="btn-list flex-nowrap justify-content-center">
                <button class="btn btn-icon btn-ghost-primary btn-sm" type="button" data-action="view" aria-label="Open work order" title="Open work order"><i class="ti ti-eye"></i></button>
                <button class="btn btn-icon btn-ghost-secondary btn-sm" type="button" data-action="edit" aria-label="Edit work order" title="Edit work order"><i class="ti ti-edit"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
    if (elements.footerSummary) {
      elements.footerSummary.textContent = jobs.length
        ? `Showing ${start + 1}-${Math.min(start + state.pageSize, jobs.length)} of ${jobs.length} work orders`
        : 'No work orders';
    }
    if (elements.pageInfo) elements.pageInfo.textContent = `Page ${state.page} of ${totalPages}`;
    if (elements.prevPage) elements.prevPage.disabled = state.page <= 1;
    if (elements.nextPage) elements.nextPage.disabled = state.page >= totalPages;
  };

  const renderMetricsAndWorkload = () => {
    const now = Date.now();
    const openJobs = state.jobs.filter((job) => !TERMINAL_STATUSES.has(normalizeStatus(job)));
    const busyNames = new Set(state.jobs
      .filter((job) => BUSY_STATUSES.has(normalizeStatus(job)))
      .map((job) => String(job.technician || '').trim().toLowerCase())
      .filter(Boolean));
    const unassigned = openJobs.filter((job) => normalizeStatus(job) === 'unassigned').length;
    const overdue = openJobs.filter((job) => {
      const dueAt = new Date(job.slaDueAt || '').getTime();
      return dueAt > 0 && dueAt < now;
    }).length;
    const active = openJobs.filter((job) => ACTIVE_STATUSES.has(normalizeStatus(job))).length;
    const available = state.technicians.filter((account) =>
      account.active !== false && !busyNames.has(technicianName(account).toLowerCase())
    ).length;
    elements.metricActive.textContent = String(state.summary?.metrics?.active ?? active);
    elements.metricUnassigned.textContent = String(state.summary?.metrics?.unassigned ?? unassigned);
    elements.metricOverdue.textContent = String(state.summary?.metrics?.overdue ?? overdue);
    elements.metricAvailable.textContent = String(available);

    if (!elements.workloadList) return;
    if (!state.technicians.length) {
      elements.workloadList.innerHTML = '<div class="list-group-item text-center text-secondary py-4">No technician accounts found.</div>';
      return;
    }
    elements.workloadList.innerHTML = state.technicians.map((account) => {
      const name = technicianName(account);
      const assigned = openJobs.filter((job) => String(job.technician || '').trim().toLowerCase() === name.toLowerCase());
      const activeCount = assigned.filter((job) => BUSY_STATUSES.has(normalizeStatus(job))).length;
      const urgent = assigned.filter((job) => ['urgent', 'emergency'].includes(job.priority)).length;
      const disabled = account.active === false || String(account.status || '').toLowerCase() === 'disabled';
      const stateName = disabled ? 'offline' : activeCount > 0 ? 'busy' : 'available';
      const availabilityClass = stateName === 'available'
        ? 'bg-green-lt text-green'
        : stateName === 'busy'
          ? 'bg-orange-lt text-orange'
          : 'bg-secondary-lt text-secondary';
      return `
        <div class="list-group-item">
          <div class="row align-items-center g-2">
            <div class="col-auto"><span class="avatar avatar-sm bg-blue-lt text-blue">${escapeHtml(initials(name))}</span></div>
            <div class="col text-truncate">
              <div class="fw-semibold text-truncate">${escapeHtml(name)}</div>
              <div class="text-secondary small">${assigned.length} open · ${urgent} urgent</div>
            </div>
            <div class="col-auto"><span class="badge ${availabilityClass} text-capitalize">${stateName}</span></div>
          </div>
        </div>
      `;
    }).join('');
  };

  const mapLayerVisibility = () => ({
    jobs: elements.mapShowJobs?.checked !== false,
    naps: elements.mapShowNaps?.checked !== false,
    links: elements.mapShowLinks?.checked !== false
  });

  const initializeMapLayerPreferences = () => {
    let saved = null;
    try {
      saved = JSON.parse(window.localStorage.getItem(MAP_LAYER_PREFERENCE_KEY) || 'null');
    } catch (_error) {
      saved = null;
    }
    if (saved && typeof saved === 'object') {
      if (elements.mapShowJobs) elements.mapShowJobs.checked = saved.jobs !== false;
      if (elements.mapShowNaps) elements.mapShowNaps.checked = saved.naps !== false;
      if (elements.mapShowLinks) elements.mapShowLinks.checked = saved.links !== false;
      return;
    }
    if (window.matchMedia?.('(max-width: 767.98px)').matches) {
      if (elements.mapShowNaps) elements.mapShowNaps.checked = false;
      if (elements.mapShowLinks) elements.mapShowLinks.checked = false;
    }
  };

  const saveMapLayerPreferences = () => {
    try {
      window.localStorage.setItem(MAP_LAYER_PREFERENCE_KEY, JSON.stringify(mapLayerVisibility()));
    } catch (_error) {
      // Map layers still work when browser storage is unavailable.
    }
  };

  const jobCustomerKeys = (job = {}) => {
    const customer = customerByAccount(job.customerAccountNumber);
    return new Set([
      job.customerAccountNumber,
      job.customerName,
      customer?.accountNumber,
      customerName(customer || {})
    ].map(normalizeLookupKey).filter(Boolean));
  };

  const connectionForJob = (nap, job) => {
    const keys = jobCustomerKeys(job);
    return (Array.isArray(nap?.connections) ? nap.connections : []).find((connection) => (
      [connection?.customerId, connection?.customerRef, connection?.customerName]
        .map(normalizeLookupKey)
        .filter(Boolean)
        .some((key) => keys.has(key))
    )) || null;
  };

  const mappedNapRecords = () => state.naps
    .map((nap) => ({ nap, coordinates: coordinatesFromSource(nap) }))
    .filter((entry) => Boolean(entry.coordinates));

  const resolveWorkOrderRoute = (job, naps, { allowCustomerFallback = false } = {}) => {
    const customer = customerByAccount(job.customerAccountNumber);
    const workOrderCoordinates = jobCoordinates(job)
      || (allowCustomerFallback ? coordinatesFromSource(customer || {}) : null);
    if (!workOrderCoordinates || !naps.length) return null;
    let assignedConnection = null;
    const assignedNap = naps.find((entry) => {
      const connection = connectionForJob(entry.nap, job);
      if (!connection) return false;
      assignedConnection = connection;
      return true;
    });
    const latitudeRadians = workOrderCoordinates.latitude * (Math.PI / 180);
    const nearestNap = assignedNap || naps.reduce((nearest, entry) => {
      const distance = (candidate) => {
        const latitudeDelta = candidate.coordinates.latitude - workOrderCoordinates.latitude;
        const longitudeDelta = (candidate.coordinates.longitude - workOrderCoordinates.longitude) * Math.cos(latitudeRadians);
        return (latitudeDelta * latitudeDelta) + (longitudeDelta * longitudeDelta);
      };
      return !nearest || distance(entry) < distance(nearest) ? entry : nearest;
    }, null);
    if (!nearestNap) return null;
    return {
      job,
      nap: nearestNap.nap,
      napCoordinates: nearestNap.coordinates,
      workOrderCoordinates,
      connection: assignedConnection,
      assigned: Boolean(assignedNap)
    };
  };

  const napMarkerIcon = (isFallback = false) => {
    return window.L.divIcon({
      className: `technician-nap-marker${isFallback ? ' is-fallback' : ''}`,
      html: '<i class="ti ti-network" aria-hidden="true"></i>',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -18]
    });
  };

  const napPopup = (nap, routes) => {
    const ports = new Map();
    routes.filter((route) => route.assigned && route.connection?.port).forEach((route) => {
      const portKey = String(route.connection.port);
      if (!ports.has(portKey)) {
        ports.set(portKey, {
          port: route.connection.port,
          customer: route.connection.customerName || route.job.customerName || route.job.customerAccountNumber || 'Customer',
          jobNumbers: new Set()
        });
      }
      route.jobs.forEach((job) => ports.get(portKey).jobNumbers.add(job.jobNumber || job.ticketNumber || `Job ${job.id}`));
    });
    const portRows = [...ports.values()].sort((left, right) => Number(left.port) - Number(right.port));
    const fallbackCount = routes.filter((route) => !route.assigned).length;
    return `
      <div class="technician-map-popup technician-network-popup">
        <div class="d-flex align-items-start gap-2 mb-2">
          <span class="avatar avatar-sm bg-purple-lt text-purple"><i class="ti ti-network"></i></span>
          <div class="flex-fill">
            <div class="subheader">Used NAP Ports</div>
            <h4 class="technician-map-popup-title mb-0">${escapeHtml(nap.code || 'NAP')}</h4>
          </div>
          <span class="badge bg-purple-lt text-purple">${portRows.length} used</span>
        </div>
        <div class="list-group list-group-flush border-top">
          ${portRows.length ? portRows.map((row) => `
            <div class="list-group-item px-0 py-2">
              <div class="d-flex justify-content-between gap-2"><strong>Port ${escapeHtml(row.port)}</strong><span class="text-secondary small">${escapeHtml([...row.jobNumbers].join(', '))}</span></div>
              <div class="text-secondary small">${escapeHtml(row.customer)}</div>
            </div>`).join('') : '<div class="list-group-item px-0 py-2 text-secondary">No assigned port for this fallback route.</div>'}
        </div>
        ${fallbackCount ? `<div class="alert alert-warning py-2 px-3 mt-2 mb-0">${fallbackCount} nearest-NAP fallback ${fallbackCount === 1 ? 'route has' : 'routes have'} no assigned port.</div>` : ''}
      </div>`;
  };

  const workOrderLinkPopup = (route) => `
    <div class="technician-map-popup technician-network-popup">
      <div class="d-flex align-items-start gap-2 mb-2">
        <span class="avatar avatar-sm bg-blue-lt text-blue"><i class="ti ti-route"></i></span>
        <div class="flex-fill">
          <div class="subheader">Work Order Link</div>
          <h4 class="technician-map-popup-title mb-0">${escapeHtml(route.nap.code || 'NAP')} <i class="ti ti-arrow-right"></i> ${escapeHtml(route.job.customerName || route.job.customerAccountNumber || 'Customer')}</h4>
        </div>
      </div>
      <div class="list-group list-group-flush border-top">
        <div class="list-group-item px-0 py-1 d-flex justify-content-between gap-2"><span class="text-secondary"><i class="ti ti-clipboard-list me-1"></i>Work Orders</span><strong class="text-end">${escapeHtml(route.jobs.map((job) => job.jobNumber || job.ticketNumber || `Job ${job.id}`).join(', '))}</strong></div>
        <div class="list-group-item px-0 py-1 d-flex justify-content-between"><span class="text-secondary"><i class="ti ti-plug-connected me-1"></i>NAP Port</span><strong>${escapeHtml(route.connection?.port || 'Not assigned')}</strong></div>
        <div class="list-group-item px-0 py-1 d-flex justify-content-between"><span class="text-secondary"><i class="ti ti-route me-1"></i>Route</span><span class="badge ${route.assigned ? 'bg-green-lt text-green' : 'bg-orange-lt text-orange'}">${route.assigned ? 'Assigned' : 'Nearest fallback'}</span></div>
      </div>
      <button class="btn btn-primary btn-sm mt-2" type="button" onclick="window.openDispatchJobDetails(${Number(route.job.id)})">Open work order</button>
    </div>`;

  const updateNetworkMapSummary = () => {
    if (!elements.mapNetworkSummary) return;
    const metrics = state.networkMetrics;
    elements.mapNetworkSummary.classList.toggle('text-danger', Boolean(state.networkLoadError));
    if (state.networkLoadError) {
      elements.mapNetworkSummary.textContent = `Network layers unavailable: ${state.networkLoadError}`;
      return;
    }
    const zoomHint = elements.mapShowLinks?.checked && state.map && state.map.getZoom() < NETWORK_LINKS_MIN_ZOOM
      ? ` Zoom to ${NETWORK_LINKS_MIN_ZOOM}+ to display links.`
      : '';
    const qualityHint = metrics.unmatchedLinks
      ? ` ${metrics.unmatchedLinks} work-order ${metrics.unmatchedLinks === 1 ? 'route has' : 'routes have'} no mapped NAP.`
      : '';
    const focusHint = state.focusedNetworkLabel ? ` Focus: ${state.focusedNetworkLabel}.` : '';
    const duplicateHint = metrics.duplicateJobs
      ? ` ${metrics.duplicateJobs} duplicate-customer work ${metrics.duplicateJobs === 1 ? 'order shares' : 'orders share'} an existing link.`
      : '';
    const fallbackHint = metrics.fallbackLinks
      ? ` Nearest fallbacks ${metrics.fallbackLinks}.`
      : '';
    const fallbackNapHint = metrics.fallbackNaps
      ? ` Fallback NAPs ${metrics.fallbackNaps}.`
      : '';
    elements.mapNetworkSummary.textContent = `Mapped work orders ${metrics.workOrders} · Work-order links ${metrics.links} · Used NAPs ${metrics.naps} · Ports used ${metrics.portsUsed}.${zoomHint}${qualityHint}${duplicateHint}${fallbackHint}${fallbackNapHint}${focusHint}`;
  };

  const renderNetworkLayers = () => {
    if (!state.map || !state.napLayer || !state.linkLayer || !window.L) return state.networkMetrics;
    state.napLayer.clearLayers();
    state.linkLayer.clearLayers();
    state.mapPoints.naps = [];
    state.mapPoints.links = [];
    const visibility = mapLayerVisibility();
    const mappedNaps = mappedNapRecords();
    const openJobs = state.jobs.filter((job) => !TERMINAL_STATUSES.has(normalizeStatus(job)) && Boolean(jobCoordinates(job)));
    const groupedJobs = new Map();
    openJobs.forEach((job) => {
      const key = normalizeLookupKey(job.customerAccountNumber || job.customerName) || `job:${job.id}`;
      if (!groupedJobs.has(key)) groupedJobs.set(key, []);
      groupedJobs.get(key).push(job);
    });
    const routes = [];
    let unmatchedLinks = 0;
    groupedJobs.forEach((jobs) => {
      const route = resolveWorkOrderRoute(jobs[0], mappedNaps);
      if (!route) {
        unmatchedLinks += 1;
        return;
      }
      routes.push({ ...route, jobs });
    });
    const routesByNap = new Map();
    routes.forEach((route) => {
      const key = normalizeLookupKey(route.nap.id || route.nap.code);
      if (!routesByNap.has(key)) routesByNap.set(key, { nap: route.nap, coordinates: route.napCoordinates, routes: [] });
      routesByNap.get(key).routes.push(route);
    });

    routesByNap.forEach((entry) => {
      state.mapPoints.naps.push([entry.coordinates.latitude, entry.coordinates.longitude]);
      if (!visibility.naps) return;
      const onlyFallbacks = entry.routes.every((route) => !route.assigned);
      window.L.marker(
        [entry.coordinates.latitude, entry.coordinates.longitude],
        { icon: napMarkerIcon(onlyFallbacks) }
      ).bindPopup(napPopup(entry.nap, entry.routes), { maxWidth: 390 }).addTo(state.napLayer);
    });

    let visibleLinks = 0;
    routes.forEach((route) => {
      const linePoints = [
        [route.napCoordinates.latitude, route.napCoordinates.longitude],
        [route.workOrderCoordinates.latitude, route.workOrderCoordinates.longitude]
      ];
      state.mapPoints.links.push(...linePoints);
      if (!visibility.links || state.map.getZoom() < NETWORK_LINKS_MIN_ZOOM) return;
      window.L.polyline(linePoints, {
        color: route.assigned ? '#2fb344' : '#f76707',
        weight: route.assigned ? 3 : 2.5,
        opacity: 0.9,
        dashArray: route.assigned ? null : '10 8',
        className: `technician-work-order-link ${route.assigned ? 'is-assigned' : 'is-fallback'}`
      }).bindPopup(workOrderLinkPopup(route), { maxWidth: 350 }).addTo(state.linkLayer);
      visibleLinks += 1;
    });

    const usedPortKeys = new Set(routes
      .filter((route) => route.assigned && route.connection?.port)
      .map((route) => `${normalizeLookupKey(route.nap.id || route.nap.code)}:${route.connection.port}`));
    const usedNapCount = [...routesByNap.values()].filter((entry) => entry.routes.some((route) => route.assigned)).length;
    const fallbackNapCount = [...routesByNap.values()].filter((entry) => entry.routes.every((route) => !route.assigned)).length;
    state.networkMetrics = {
      naps: usedNapCount,
      links: routes.length,
      visibleLinks,
      unmatchedLinks,
      workOrders: openJobs.length,
      portsUsed: usedPortKeys.size,
      fallbackLinks: routes.filter((route) => !route.assigned).length,
      fallbackNaps: fallbackNapCount,
      duplicateJobs: Math.max(openJobs.length - groupedJobs.size, 0)
    };
    updateNetworkMapSummary();
    return state.networkMetrics;
  };

  const fitVisibleMapLayers = ({ quiet = false } = {}) => {
    if (!state.map || !window.L) return;
    const visibility = mapLayerVisibility();
    const points = [];
    if (visibility.jobs) points.push(...state.mapPoints.jobs);
    if (visibility.naps) points.push(...state.mapPoints.naps);
    if (visibility.links) points.push(...state.mapPoints.links);
    if (!points.length) {
      if (!quiet) notify('No visible map locations to fit.', 'warning');
      return;
    }
    if (points.length === 1) state.map.setView(points[0], 16);
    else state.map.fitBounds(points, { padding: [25, 25], maxZoom: 16 });
  };

  const clearJobNetworkPath = () => {
    state.focusLayer?.clearLayers();
    state.focusedNetworkLabel = '';
    updateNetworkMapSummary();
  };

  const highlightJobNetworkPath = (job) => {
    clearJobNetworkPath();
    if (!job || !state.map || !state.focusLayer || !window.L) return;
    const type = String(job.type || '').trim().toLowerCase();
    if (!['repair', 'install', 'installation'].includes(type)) return;
    const route = resolveWorkOrderRoute(job, mappedNapRecords(), { allowCustomerFallback: true });
    if (!route) return;

    const linePoints = [
      [route.napCoordinates.latitude, route.napCoordinates.longitude],
      [route.workOrderCoordinates.latitude, route.workOrderCoordinates.longitude]
    ];
    window.L.polyline(linePoints, {
      color: '#ae3ec9',
      weight: 4,
      opacity: 0.95,
      className: 'technician-network-link technician-network-link--focus'
    }).bindTooltip(
      `${escapeHtml(route.nap.code || 'NAP')} · ${route.assigned ? 'assigned route' : 'nearest route'}`,
      { sticky: true }
    ).addTo(state.focusLayer).bringToFront();
    state.focusedNetworkLabel = `${job.jobNumber || `Job ${job.id}`} → ${route.nap.code || 'NAP'} (${route.assigned ? 'assigned' : 'nearest'})`;
    updateNetworkMapSummary();
  };

  const initializeMap = () => {
    if (state.map || !elements.map || !window.L) return;
    state.map = window.L.map(elements.map, { zoomControl: true, attributionControl: true })
      .setView([12.8797, 121.774], 5);
    const tileLayer = window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    });
    tileLayer.on('tileerror', () => {
      state.mapTilesUnavailable = true;
      if (elements.mapFooter && elements.mapMissingCount) {
        elements.mapFooter.hidden = false;
        elements.mapMissingCount.textContent = 'Map tiles unavailable. Check the internet connection.';
      }
    });
    tileLayer.addTo(state.map);
    state.linkLayer = window.L.layerGroup().addTo(state.map);
    state.markerLayer = window.L.layerGroup().addTo(state.map);
    state.napLayer = window.L.layerGroup().addTo(state.map);
    state.focusLayer = window.L.layerGroup().addTo(state.map);
    state.map.on('zoomend', renderNetworkLayers);
  };

  const setMapNotice = ({ title, message, actionLabel = '', jobId = '' } = {}) => {
    if (!elements.mapEmpty) return;
    elements.mapEmpty.hidden = false;
    if (elements.mapEmptyTitle) elements.mapEmptyTitle.textContent = title || 'Job Map unavailable';
    if (elements.mapEmptyCopy) elements.mapEmptyCopy.textContent = message || '';
    if (elements.mapEmptyAction) {
      elements.mapEmptyAction.hidden = !actionLabel;
      elements.mapEmptyAction.textContent = actionLabel;
      elements.mapEmptyAction.dataset.jobId = String(jobId || '');
    }
  };

  const renderMap = ({ preserveView = false } = {}) => {
    const openJobs = state.jobs.filter((job) => !TERMINAL_STATUSES.has(normalizeStatus(job)));
    const jobs = openJobs.filter((job) => Boolean(jobCoordinates(job)));
    const missingJobs = openJobs.filter((job) => !jobs.includes(job));

    if (elements.mapFooter && elements.mapMissingCount && elements.mapReviewMissing) {
      elements.mapFooter.hidden = missingJobs.length === 0 && !state.mapTilesUnavailable;
      elements.mapMissingCount.textContent = state.mapTilesUnavailable
        ? 'Map tiles unavailable. Check the internet connection.'
        : `${missingJobs.length} open ${missingJobs.length === 1 ? 'job is' : 'jobs are'} missing GPS coordinates.`;
      elements.mapReviewMissing.hidden = missingJobs.length === 0;
      elements.mapReviewMissing.dataset.jobId = String(missingJobs[0]?.id || '');
    }

    if (!window.L) {
      setMapNotice({
        title: 'Job Map could not load',
        message: 'The map library needs an internet connection. Work orders and saved coordinates are still available.',
        actionLabel: missingJobs.length ? 'Add job location' : '',
        jobId: missingJobs[0]?.id
      });
      return;
    }

    initializeMap();
    if (!state.map || !state.markerLayer) return;
    state.markerLayer.clearLayers();
    const visibility = mapLayerVisibility();
    state.mapPoints.jobs = jobs.map((job) => {
      const coordinates = jobCoordinates(job);
      return [coordinates.latitude, coordinates.longitude];
    });
    const markerIcon = window.L.divIcon({
      className: 'technician-map-marker',
      html: '<i class="ti ti-map-pin" aria-hidden="true"></i>',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -18]
    });
    jobs.forEach((job) => {
      const jobLocation = jobCoordinates(job);
      const coordinates = [jobLocation.latitude, jobLocation.longitude];
      if (!visibility.jobs) return;
      const marker = window.L.marker(coordinates, { icon: markerIcon }).addTo(state.markerLayer);
      marker.bindPopup(`
        <div class="technician-map-popup">
          <h4 class="technician-map-popup-title">${escapeHtml(job.customerName || job.jobNumber || 'Work order')}</h4>
          <p class="technician-map-popup-meta">${escapeHtml(job.jobNumber || '')} · ${escapeHtml(STATUS_LABELS[normalizeStatus(job)])}<br>${escapeHtml(job.technician || 'Unassigned')}</p>
          <button class="btn btn-sm btn-primary" type="button" onclick="window.openDispatchJobDetails(${Number(job.id)})">Open work order</button>
        </div>
      `);
    });
    const networkMetrics = renderNetworkLayers();
    elements.mapCount.textContent = [
      `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`,
      `${networkMetrics.naps} used ${networkMetrics.naps === 1 ? 'NAP' : 'NAPs'}`,
      networkMetrics.fallbackNaps ? `${networkMetrics.fallbackNaps} fallback ${networkMetrics.fallbackNaps === 1 ? 'NAP' : 'NAPs'}` : '',
      `${networkMetrics.links} work-order ${networkMetrics.links === 1 ? 'link' : 'links'}`,
      missingJobs.length ? `${missingJobs.length} missing GPS` : ''
    ].filter(Boolean).join(' · ');

    const networkVisible = (visibility.naps && (networkMetrics.naps + networkMetrics.fallbackNaps) > 0)
      || (visibility.links && networkMetrics.links > 0);
    if ((visibility.jobs && jobs.length) || networkVisible) {
      elements.mapEmpty.hidden = true;
    } else if (!visibility.jobs && !visibility.naps && !visibility.links) {
      setMapNotice({
        title: 'All map layers are hidden',
        message: 'Turn on Work Orders, NAPs, or Links above the map.'
      });
    } else if (openJobs.length) {
      setMapNotice({
        title: 'No open jobs have GPS coordinates',
        message: 'Add a valid latitude and longitude to place the work order on this map.',
        actionLabel: 'Add job location',
        jobId: missingJobs[0]?.id
      });
    } else {
      setMapNotice({
        title: 'No open jobs to map',
        message: 'Create a work order and add its Map Pin to show it here.',
        actionLabel: 'Create work order'
      });
    }
    if (!preserveView) {
      if (visibility.jobs && state.mapPoints.jobs.length) {
        if (state.mapPoints.jobs.length === 1) state.map.setView(state.mapPoints.jobs[0], 16);
        else state.map.fitBounds(state.mapPoints.jobs, { padding: [25, 25], maxZoom: 16 });
      } else {
        fitVisibleMapLayers({ quiet: true });
      }
    }
    setTimeout(() => state.map.invalidateSize(), 0);
  };

  const loadData = async ({ quiet = false } = {}) => {
    if (!quiet && elements.refresh) elements.refresh.disabled = true;
    try {
      const [jobsPayload, customersPayload, accountsPayload, summaryPayload, networkResult] = await Promise.all([
        requestJson('/api/jobs'),
        requestJson('/api/customers'),
        requestJson('/api/accounts'),
        requestJson('/api/jobs/dispatch-summary'),
        requestJson('/api/pon/state')
          .then((payload) => ({ payload, error: '' }))
          .catch((error) => ({ payload: { naps: [] }, error: error.message || 'Unable to load PON state.' }))
      ]);
      state.jobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
      state.customers = Array.isArray(customersPayload.customers) ? customersPayload.customers : [];
      state.naps = Array.isArray(networkResult.payload?.naps) ? networkResult.payload.naps : [];
      state.networkLoadError = networkResult.error;
      const accounts = Array.isArray(accountsPayload.accounts)
        ? accountsPayload.accounts
        : Array.isArray(accountsPayload) ? accountsPayload : [];
      state.technicians = accounts.filter((account) => hasAccountRole(account, 'technician'));
      state.summary = summaryPayload;
      populateTechnicianSelects();
      populateCustomerSelect();
      renderJobs();
      renderMetricsAndWorkload();
      renderMap();
      if (typeof window.refreshSidebarWorkBadges === 'function') window.refreshSidebarWorkBadges();
    } catch (error) {
      console.error('Dispatch load failed:', error);
      notify(error.message || 'Unable to load technician dispatch.', 'error');
      elements.tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-5">Unable to load dispatch data.</td></tr>';
    } finally {
      if (elements.refresh) elements.refresh.disabled = false;
    }
  };

  const openJobForm = (job = null) => {
    clearJobNetworkPath();
    elements.jobForm.reset();
    const isEdit = Boolean(job);
    elements.jobEntryId.value = job?.id || '';
    elements.jobModalEyebrow.textContent = isEdit ? 'Edit Work Order' : 'New Work Order';
    elements.jobModalTitle.textContent = isEdit ? 'Update dispatch work' : 'Create dispatch work';
    elements.jobModalSubmit.innerHTML = `<i class="ti ti-device-floppy"></i> ${isEdit ? 'Save Changes' : 'Save Work Order'}`;
    if (isEdit) {
      elements.jobCustomer.value = job.customerAccountNumber || '';
      if (job.customerAccountNumber && !elements.jobCustomer.value) {
        const option = new Option(`${job.customerAccountNumber} · ${job.customerName || 'Archived customer'}`, job.customerAccountNumber, true, true);
        elements.jobCustomer.add(option);
      }
      elements.jobType.value = job.type || 'repair';
      elements.jobPriority.value = job.priority || 'normal';
      elements.jobTech.value = job.technician || '';
      if (job.technician && !elements.jobTech.value) {
        elements.jobTech.add(new Option(job.technician, job.technician, true, true));
      }
      elements.appointmentStart.value = toLocalInputValue(job.appointmentStart || job.schedule);
      elements.appointmentEnd.value = toLocalInputValue(job.appointmentEnd);
      elements.slaDue.value = toLocalInputValue(job.slaDueAt);
      elements.jobMapPin.value = jobMapPin(job);
      elements.description.value = job.description || job.dispatchPayload?.instructions || '';
      elements.equipment.value = itemLines(job.dispatchPayload?.equipment);
      elements.materials.value = itemLines(job.dispatchPayload?.materials);
    } else {
      elements.jobType.value = 'repair';
      elements.jobPriority.value = 'normal';
      elements.jobMapPin.value = '';
      setDefaultSchedule();
    }
    updateCustomerHint();
    closeModalElement(elements.detailsModal);
    openModalElement(elements.jobModal);
    elements.jobCustomer.focus();
  };

  const closeJobForm = () => {
    closeModalElement(elements.jobModal);
    elements.jobForm.reset();
    elements.jobEntryId.value = '';
  };

  const openLocationEditor = (jobId = '') => {
    const job = state.jobs.find((entry) => Number(entry.id) === Number(jobId));
    openJobForm(job || null);
    setTimeout(() => {
      elements.jobMapPin?.focus();
      elements.jobMapPin?.select();
    }, 0);
  };

  const saveJob = async (event) => {
    event.preventDefault();
    const id = Number(elements.jobEntryId.value || 0);
    const appointmentStart = fromLocalInputValue(elements.appointmentStart.value);
    const appointmentEnd = fromLocalInputValue(elements.appointmentEnd.value);
    const slaDueAt = fromLocalInputValue(elements.slaDue.value);
    const mapPin = String(elements.jobMapPin?.value || '').trim();
    const parsedMapPin = mapPin ? parseCoordinateInput(mapPin) : null;
    if (!appointmentStart) {
      notify('Appointment start is required.', 'warning');
      return;
    }
    if (mapPin && !parsedMapPin) {
      notify('Map Pin must contain decimal or DMS latitude and longitude.', 'warning');
      elements.jobMapPin?.focus();
      return;
    }
    const normalizedMapPin = parsedMapPin
      ? `${parsedMapPin.latitude.toFixed(6)}, ${parsedMapPin.longitude.toFixed(6)}`
      : '';
    const payload = {
      customerAccountNumber: elements.jobCustomer.value,
      mapPin: normalizedMapPin,
      type: elements.jobType.value,
      priority: elements.jobPriority.value,
      technician: elements.jobTech.value,
      schedule: appointmentStart,
      appointmentStart,
      appointmentEnd,
      slaDueAt,
      notes: elements.description.value,
      description: elements.description.value,
      dispatchPayload: {
        instructions: elements.description.value,
        equipment: parseItemLines(elements.equipment.value),
        materials: parseItemLines(elements.materials.value)
      },
      clientEventId: createClientEventId()
    };
    const unlock = window.withSubmitLock
      ? window.withSubmitLock(elements.jobForm, { label: 'Saving...' })
      : null;
    if (window.withSubmitLock && !unlock) return;
    try {
      await requestJson(id ? `/api/jobs/${id}` : '/api/jobs', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      notify(id ? 'Work order updated.' : 'Work order created.', 'success');
      closeJobForm();
      await loadData({ quiet: true });
    } catch (error) {
      notify(error.message || 'Unable to save work order.', 'error');
    } finally {
      if (unlock) unlock();
    }
  };

  const renderList = (items, emptyLabel) => {
    if (!Array.isArray(items) || !items.length) return `<p class="text-secondary mb-0">${escapeHtml(emptyLabel)}</p>`;
    return `<div class="list-group list-group-flush">${items.map((item) => `
      <div class="list-group-item px-0 py-2">
        <div class="fw-semibold">${escapeHtml(item.name || item)}</div>
        ${item.quantity || item.serialNumber ? `<div class="text-secondary small">${item.quantity ? `${escapeHtml(item.quantity)} ${escapeHtml(item.unit || '')}` : ''}${item.quantity && item.serialNumber ? ' · ' : ''}${item.serialNumber ? `SN ${escapeHtml(item.serialNumber)}` : ''}</div>` : ''}
      </div>`).join('')}</div>`;
  };

  const renderJobDetails = (job) => {
    const status = normalizeStatus(job);
    const coordinates = jobCoordinates(job);
    const pinReady = Boolean(coordinates);
    const mapQuery = pinReady ? `${coordinates.latitude},${coordinates.longitude}` : job.serviceAddress || '';
    const wazeQuery = pinReady ? `ll=${encodeURIComponent(mapQuery)}` : `q=${encodeURIComponent(mapQuery)}`;
    const phone = String(job.customerPhone || '').trim();
    const payload = job.dispatchPayload || {};
    if (elements.detailsLocation) {
      elements.detailsLocation.innerHTML = `<i class="ti ti-map-pin"></i> ${pinReady ? 'Edit Location' : 'Add Location'}`;
    }
    elements.detailsEyebrow.textContent = job.jobNumber || job.ticketNumber || 'Work Order';
    elements.detailsTitle.textContent = job.customerName || job.customerAccountNumber || 'Unlinked work order';
    elements.detailsStatus.value = status;
    elements.detailsSummary.innerHTML = `
      <div class="card technician-detail-hero mb-3">
        <div class="card-body">
          <div class="row g-3 align-items-center">
            <div class="col">
              <h3 class="card-title mb-1">${escapeHtml(job.customerName || 'No linked customer')}</h3>
              <div class="text-secondary">${escapeHtml(job.customerAccountNumber || 'No account')} · ${escapeHtml(job.planName || 'No plan snapshot')}</div>
              <div class="text-secondary mt-1"><i class="ti ti-map-pin me-1" aria-hidden="true"></i>${escapeHtml(job.serviceAddress || 'No service address')}</div>
            </div>
            <div class="col-12 col-lg-auto">
              <div class="btn-list">
                ${phone ? `<a class="btn btn-outline-secondary btn-sm" href="tel:${encodeURIComponent(phone)}"><i class="ti ti-phone"></i> Call</a><a class="btn btn-outline-secondary btn-sm" href="sms:${encodeURIComponent(phone)}"><i class="ti ti-message"></i> Message</a>` : ''}
                ${mapQuery ? `<a class="btn btn-outline-secondary btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}"><i class="ti ti-brand-google-maps"></i> Google Maps</a><a class="btn btn-outline-secondary btn-sm" target="_blank" rel="noopener" href="https://www.waze.com/ul?${wazeQuery}&navigate=yes"><i class="ti ti-navigation"></i> Waze</a>` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="row g-3 mb-4">
        <div class="col-6 col-lg-4"><div class="card card-sm h-100"><div class="card-body"><div class="subheader">Type</div><div class="fw-semibold text-capitalize technician-detail-value">${escapeHtml(String(job.type || 'General').replace(/[-_]/g, ' '))}</div></div></div></div>
        <div class="col-6 col-lg-4"><div class="card card-sm h-100"><div class="card-body"><div class="subheader">Technician</div><div class="fw-semibold technician-detail-value">${escapeHtml(job.technician || 'Unassigned')}</div></div></div></div>
        <div class="col-6 col-lg-4"><div class="card card-sm h-100"><div class="card-body"><div class="subheader">Status</div><div class="mt-1">${statusBadge(status)}</div></div></div></div>
        <div class="col-6 col-lg-4"><div class="card card-sm h-100"><div class="card-body"><div class="subheader">Appointment</div><div class="fw-semibold technician-detail-value">${escapeHtml(formatDateTime(job.appointmentStart || job.schedule))}</div></div></div></div>
        <div class="col-6 col-lg-4"><div class="card card-sm h-100"><div class="card-body"><div class="subheader">Appointment End</div><div class="fw-semibold technician-detail-value">${escapeHtml(formatDateTime(job.appointmentEnd, 'Open window'))}</div></div></div></div>
        <div class="col-6 col-lg-4"><div class="card card-sm h-100"><div class="card-body"><div class="subheader">SLA Due</div><div class="fw-semibold technician-detail-value">${escapeHtml(formatDateTime(job.slaDueAt, 'Not set'))}</div></div></div></div>
        <div class="col-6 col-lg-4"><div class="card card-sm h-100"><div class="card-body"><div class="subheader">Priority</div><div class="mt-1">${priorityBadge(job.priority)}</div></div></div></div>
        <div class="col-6 col-lg-4"><div class="card card-sm h-100"><div class="card-body"><div class="subheader">GPS</div><div class="fw-semibold technician-detail-value">${escapeHtml(pinReady ? mapQuery : 'Not set')}</div></div></div></div>
        <div class="col-6 col-lg-4"><div class="card card-sm h-100"><div class="card-body"><div class="subheader">Record Version</div><div class="fw-semibold technician-detail-value">${escapeHtml(job.version || 1)}</div></div></div></div>
      </div>
      <div class="subheader mb-3"><i class="ti ti-clipboard-check me-1" aria-hidden="true"></i> Field evidence</div>
      <div class="row g-3">
        <div class="col-md-6"><article class="card technician-evidence-card"><div class="card-header"><h3 class="card-title">Instructions</h3></div><div class="card-body"><p class="mb-0">${escapeHtml(job.description || payload.instructions || 'No instructions recorded.')}</p></div></article></div>
        <div class="col-md-6"><article class="card technician-evidence-card"><div class="card-header"><h3 class="card-title">Diagnosis / Work Performed</h3></div><div class="card-body"><p>${escapeHtml(payload.diagnosis || 'No diagnosis yet.')}</p><p>${escapeHtml(payload.workPerformed || 'No work details yet.')}</p></div></article></div>
        <div class="col-md-6"><article class="card technician-evidence-card"><div class="card-header"><h3 class="card-title">Equipment</h3></div><div class="card-body">${renderList(payload.equipment, 'No equipment recorded.')}</div></article></div>
        <div class="col-md-6"><article class="card technician-evidence-card"><div class="card-header"><h3 class="card-title">Materials</h3></div><div class="card-body">${renderList(payload.materials, 'No materials recorded.')}</div></article></div>
        <div class="col-md-6"><article class="card technician-evidence-card"><div class="card-header"><h3 class="card-title">Signal / Speed Test</h3></div><div class="card-body"><p>RX: ${escapeHtml(payload.signal?.rxDbm ?? '-')} dBm · TX: ${escapeHtml(payload.signal?.txDbm ?? '-')} dBm</p><p>Download: ${escapeHtml(payload.speedTest?.downloadMbps ?? '-')} Mbps · Upload: ${escapeHtml(payload.speedTest?.uploadMbps ?? '-')} Mbps · Ping: ${escapeHtml(payload.speedTest?.pingMs ?? '-')} ms</p></div></article></div>
        <div class="col-md-6"><article class="card technician-evidence-card"><div class="card-header"><h3 class="card-title">Photos / Signature</h3></div><div class="card-body"><p>${escapeHtml((payload.photos || []).length)} photo reference(s)</p><p>${payload.signature ? `Signed by ${escapeHtml(payload.signature.name || 'customer')}` : 'No signature recorded.'}</p></div></article></div>
      </div>
    `;
  };

  const loadEvents = async (job) => {
    elements.eventTimeline.innerHTML = '<div class="list-group-item text-center text-secondary py-4">Loading history...</div>';
    try {
      const payload = await requestJson(`/api/jobs/${encodeURIComponent(job.id)}/events`);
      const events = Array.isArray(payload.events) ? payload.events.slice().reverse() : [];
      if (!events.length) {
        elements.eventTimeline.innerHTML = '<div class="list-group-item text-center text-secondary py-4">No audit events recorded for this legacy job yet.</div>';
        return;
      }
      elements.eventTimeline.innerHTML = events.map((entry) => {
        const eventLabel = String(entry.eventType || 'updated').replace(/[_-]/g, ' ');
        const transition = entry.toStatus
          ? `${STATUS_LABELS[entry.fromStatus] || entry.fromStatus || 'New'} → ${STATUS_LABELS[entry.toStatus] || entry.toStatus}`
          : '';
        return `
          <div class="list-group-item">
            <div class="row align-items-center g-2">
              <div class="col-auto"><span class="avatar avatar-sm bg-blue-lt text-blue"><i class="ti ti-history"></i></span></div>
              <div class="col">
                <div class="fw-semibold text-capitalize">${escapeHtml(eventLabel)}${transition ? ` · ${escapeHtml(transition)}` : ''}</div>
                <div class="text-secondary small">${escapeHtml(entry.actorName || entry.actorType || 'System')} · ${escapeHtml(formatDateTime(entry.eventAt))}</div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (error) {
      elements.eventTimeline.innerHTML = `<div class="list-group-item text-center text-danger py-4">${escapeHtml(error.message || 'Unable to load audit history.')}</div>`;
    }
  };

  const openJobDetails = async (jobId) => {
    const job = state.jobs.find((entry) => Number(entry.id) === Number(jobId));
    if (!job) return;
    state.activeJobId = Number(job.id);
    highlightJobNetworkPath(job);
    renderJobDetails(job);
    openModalElement(elements.detailsModal);
    await loadEvents(job);
  };

  window.openDispatchJobDetails = openJobDetails;

  const closeJobDetails = () => {
    closeModalElement(elements.detailsModal);
    clearJobNetworkPath();
    state.activeJobId = null;
  };

  const updateJobStatus = async () => {
    const job = activeJob();
    if (!job) return;
    try {
      const payload = await requestJson(`/api/jobs/${encodeURIComponent(job.id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: elements.detailsStatus.value,
          expectedVersion: job.version || 1,
          clientEventId: createClientEventId()
        })
      });
      const index = state.jobs.findIndex((entry) => Number(entry.id) === Number(job.id));
      if (index >= 0 && payload.job) state.jobs[index] = payload.job;
      const updatedJob = payload.job || (index >= 0 ? state.jobs[index] : job);
      notify('Job status updated.', 'success');
      renderJobDetails(updatedJob);
      await loadEvents(updatedJob);
      const summary = await requestJson('/api/jobs/dispatch-summary');
      state.summary = summary;
      renderJobs();
      renderMetricsAndWorkload();
      renderMap();
    } catch (error) {
      notify(error.message || 'Unable to update job status.', 'error');
      if (error.payload?.currentJob) {
        const index = state.jobs.findIndex((entry) => Number(entry.id) === Number(job.id));
        if (index >= 0) state.jobs[index] = error.payload.currentJob;
        renderJobDetails(error.payload.currentJob);
      }
    }
  };

  const deleteActiveJob = async () => {
    const job = activeJob();
    if (!job) return;
    const confirmed = await confirmAction(
      `Permanently delete ${job.jobNumber || `job ${job.id}`}? Its audit event will be retained.`,
      { title: 'Delete Work Order', okText: 'Delete' }
    );
    if (!confirmed) return;
    try {
      await requestJson(`/api/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
      notify('Work order deleted.', 'success');
      closeJobDetails();
      await loadData({ quiet: true });
    } catch (error) {
      notify(error.message || 'Unable to delete work order.', 'error');
    }
  };

  const resetPageAndRender = () => {
    state.page = 1;
    renderJobs();
  };

  const wireEvents = () => {
    elements.openJobModal?.addEventListener('click', () => openJobForm());
    elements.jobModalClose?.addEventListener('click', closeJobForm);
    elements.jobModalCancel?.addEventListener('click', closeJobForm);
    elements.jobForm?.addEventListener('submit', saveJob);
    elements.jobCustomer?.addEventListener('change', () => {
      updateCustomerHint();
      copyCustomerMapPin();
    });
    elements.jobPriority?.addEventListener('change', updateRecommendedSla);
    elements.appointmentStart?.addEventListener('change', () => {
      const start = new Date(elements.appointmentStart.value || '');
      const end = new Date(elements.appointmentEnd.value || '');
      if (Number.isFinite(start.getTime()) && (!Number.isFinite(end.getTime()) || end <= start)) {
        elements.appointmentEnd.value = toLocalInputValue(new Date(start.getTime() + 2 * 60 * 60 * 1000));
      }
      updateRecommendedSla();
    });
    elements.detailsClose?.addEventListener('click', closeJobDetails);
    elements.detailsDone?.addEventListener('click', closeJobDetails);
    elements.detailsEdit?.addEventListener('click', () => {
      const job = activeJob();
      if (job) openJobForm(job);
    });
    elements.detailsLocation?.addEventListener('click', () => {
      const job = activeJob();
      if (job) openLocationEditor(job.id);
    });
    elements.mapEmptyAction?.addEventListener('click', () => {
      openLocationEditor(elements.mapEmptyAction.dataset.jobId || '');
    });
    elements.mapReviewMissing?.addEventListener('click', () => {
      openLocationEditor(elements.mapReviewMissing.dataset.jobId || '');
    });
    [elements.mapShowJobs, elements.mapShowNaps, elements.mapShowLinks].forEach((control) => {
      control?.addEventListener('change', () => {
        saveMapLayerPreferences();
        renderMap({ preserveView: true });
      });
    });
    elements.mapFitLayers?.addEventListener('click', () => fitVisibleMapLayers());
    elements.detailsDelete?.addEventListener('click', deleteActiveJob);
    elements.detailsUpdateStatus?.addEventListener('click', updateJobStatus);
    elements.refresh?.addEventListener('click', () => loadData());
    elements.search?.addEventListener('input', resetPageAndRender);
    elements.statusFilter?.addEventListener('change', resetPageAndRender);
    elements.technicianFilter?.addEventListener('change', resetPageAndRender);
    elements.priorityFilter?.addEventListener('change', resetPageAndRender);
    elements.prevPage?.addEventListener('click', () => {
      if (state.page > 1) {
        state.page -= 1;
        renderJobs();
      }
    });
    elements.nextPage?.addEventListener('click', () => {
      state.page += 1;
      renderJobs();
    });
    elements.tableBody?.addEventListener('click', (event) => {
      const row = event.target.closest('tr[data-job-id]');
      if (!row) return;
      const jobId = Number(row.dataset.jobId);
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'edit') {
        const job = state.jobs.find((entry) => Number(entry.id) === jobId);
        if (job) openJobForm(job);
        return;
      }
      openJobDetails(jobId);
    });
  };

  initializeMapLayerPreferences();
  wireEvents();
  loadData();
})();
