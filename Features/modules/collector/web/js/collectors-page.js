// Collectors workspace sidebar + reporting logic
(function () {
  const assignMessage = document.getElementById('assignMessage');
  const reportContainer = document.getElementById('reportContainer');
  const collectorApprovalList = document.getElementById('collectorApprovalList');
  const collectorApprovalCount = document.getElementById('collectorApprovalCount');
  const collectorApprovalTotal = document.getElementById('collectorApprovalTotal');
  const collectorApprovalsEmptyState = document.getElementById('collectorApprovalsEmptyState');
  const collectorApprovalRefresh = document.getElementById('collectorApprovalRefresh');
  const collectorApprovalFiltersToggle = document.getElementById('collectorApprovalFiltersToggle');
  const collectorApprovalFiltersPanel = document.getElementById('collectorApprovalFiltersPanel');
  const collectorApprovalSearch = document.getElementById('collectorApprovalSearch');
  const collectorApprovalCollectorFilter = document.getElementById('collectorApprovalCollectorFilter');
  const collectorApprovalDateFilter = document.getElementById('collectorApprovalDateFilter');
  const collectorApprovalClearFilters = document.getElementById('collectorApprovalClearFilters');
  const collectorApprovalSummaryAmount = document.getElementById('collectorApprovalSummaryAmount');
  const collectorApprovalSummaryPayments = document.getElementById('collectorApprovalSummaryPayments');
  const collectorApprovalSummaryCollectors = document.getElementById('collectorApprovalSummaryCollectors');
  const collectorApprovalSummaryOldest = document.getElementById('collectorApprovalSummaryOldest');
  const collectorApprovalSelection = document.getElementById('collectorApprovalSelection');
  const collectorApprovalSelectionCount = document.getElementById('collectorApprovalSelectionCount');
  const collectorApprovalApproveSelected = document.getElementById('collectorApprovalApproveSelected');
  const collectorApprovalPagination = document.getElementById('collectorApprovalPagination');
  const collectorApprovalPageSummary = document.getElementById('collectorApprovalPageSummary');
  const collectorApprovalPageIndicator = document.getElementById('collectorApprovalPageIndicator');
  const collectorApprovalPreviousPage = document.getElementById('collectorApprovalPreviousPage');
  const collectorApprovalNextPage = document.getElementById('collectorApprovalNextPage');
  const collectorPaymentRejectModal = document.getElementById('collectorPaymentRejectModal');
  const collectorPaymentRejectForm = document.getElementById('collectorPaymentRejectForm');
  const collectorPaymentRejectEntryId = document.getElementById('collectorPaymentRejectEntryId');
  const collectorPaymentRejectSummary = document.getElementById('collectorPaymentRejectSummary');
  const collectorPaymentRejectReason = document.getElementById('collectorPaymentRejectReason');
  const collectorPaymentRejectMessage = document.getElementById('collectorPaymentRejectMessage');
  const collectorPaymentRejectSubmit = document.getElementById('collectorPaymentRejectSubmit');
  const closeCollectorPaymentRejectModal = document.getElementById('closeCollectorPaymentRejectModal');
  const cancelCollectorPaymentRejectModal = document.getElementById('cancelCollectorPaymentRejectModal');
  const collectorRemittanceList = document.getElementById('collectorRemittanceList');
  const collectorRemittanceCount = document.getElementById('collectorRemittanceCount');
  const collectorRemittanceTotal = document.getElementById('collectorRemittanceTotal');
  const collectorRemittanceRefresh = document.getElementById('collectorRemittanceRefresh');
  const collectorRemittanceEmptyState = document.getElementById('collectorRemittanceEmptyState');
  const collectorRemittancePendingCount = document.getElementById('collectorRemittancePendingCount');
  const collectorRemittanceCompletedCount = document.getElementById('collectorRemittanceCompletedCount');
  const collectorRemittanceRejectedCount = document.getElementById('collectorRemittanceRejectedCount');
  const collectorRemittanceFilterButtons = document.querySelectorAll('[data-collector-remittance-filter]');
  const collectorRemittanceReviewModal = document.getElementById('collectorRemittanceReviewModal');
  const collectorRemittanceReviewForm = document.getElementById('collectorRemittanceReviewForm');
  const collectorRemittanceReviewTitle = document.getElementById('collectorRemittanceReviewTitle');
  const collectorRemittanceReviewSubtitle = document.getElementById('collectorRemittanceReviewSubtitle');
  const collectorRemittanceReviewId = document.getElementById('collectorRemittanceReviewId');
  const collectorRemittanceReviewAction = document.getElementById('collectorRemittanceReviewAction');
  const collectorRemittanceReviewSummary = document.getElementById('collectorRemittanceReviewSummary');
  const collectorRemittanceReviewPayments = document.getElementById('collectorRemittanceReviewPayments');
  const collectorRemittanceReviewNoteLabel = document.getElementById('collectorRemittanceReviewNoteLabel');
  const collectorRemittanceReviewNote = document.getElementById('collectorRemittanceReviewNote');
  const collectorRemittanceReviewMessage = document.getElementById('collectorRemittanceReviewMessage');
  const collectorRemittanceReviewSubmit = document.getElementById('collectorRemittanceReviewSubmit');
  const closeCollectorRemittanceReviewModal = document.getElementById('closeCollectorRemittanceReviewModal');
  const cancelCollectorRemittanceReviewModal = document.getElementById('cancelCollectorRemittanceReviewModal');
  const collectorPriorityList = document.getElementById('collectorPriorityList');
  const collectorPriorityCount = document.getElementById('collectorPriorityCount');
  const collectorPriorityEmptyState = document.getElementById('collectorPriorityEmptyState');
  const collectorPriorityHistoryToggle = document.getElementById('collectorPriorityHistoryToggle');
  const collectorPriorityHistoryToggleLabel = document.getElementById('collectorPriorityHistoryToggleLabel');
  const collectorPriorityHistoryCount = document.getElementById('collectorPriorityHistoryCount');
  const collectorPriorityPagination = document.getElementById('collectorPriorityPagination');
  const collectorPriorityPageSummary = document.getElementById('collectorPriorityPageSummary');
  const collectorPriorityPageIndicator = document.getElementById('collectorPriorityPageIndicator');
  const collectorPriorityPreviousPage = document.getElementById('collectorPriorityPreviousPage');
  const collectorPriorityNextPage = document.getElementById('collectorPriorityNextPage');
  const collectorPriorityRefresh = document.getElementById('collectorPriorityRefresh');
  const collectorPriorityCreate = document.getElementById('collectorPriorityCreate');
  const collectorPriorityModal = document.getElementById('collectorPriorityModal');
  const collectorPriorityForm = document.getElementById('collectorPriorityForm');
  const collectorPriorityModalTitle = document.getElementById('collectorPriorityModalTitle');
  const collectorPriorityRecordId = document.getElementById('collectorPriorityRecordId');
  const collectorPriorityCustomerSearch = document.getElementById('collectorPriorityCustomerSearch');
  const collectorPriorityCustomerList = document.getElementById('collectorPriorityCustomerList');
  const collectorPriorityCustomerHint = document.getElementById('collectorPriorityCustomerHint');
  const collectorPrioritySelectedCount = document.getElementById('collectorPrioritySelectedCount');
  const collectorPrioritySelectAllVisible = document.getElementById('collectorPrioritySelectAllVisible');
  const collectorPriorityClearSelected = document.getElementById('collectorPriorityClearSelected');
  const collectorPriorityLevel = document.getElementById('collectorPriorityLevel');
  const collectorPriorityDate = document.getElementById('collectorPriorityDate');
  const collectorPriorityExpires = document.getElementById('collectorPriorityExpires');
  const collectorPriorityReason = document.getElementById('collectorPriorityReason');
  const collectorPriorityMessage = document.getElementById('collectorPriorityMessage');
  const collectorPrioritySave = document.getElementById('collectorPrioritySave');
  const closeCollectorPriorityModal = document.getElementById('closeCollectorPriorityModal');
  const cancelCollectorPriorityModal = document.getElementById('cancelCollectorPriorityModal');
  const collectorRescheduleList = document.getElementById('collectorRescheduleList');
  const collectorRescheduleCount = document.getElementById('collectorRescheduleCount');
  const collectorReschedulesEmptyState = document.getElementById('collectorReschedulesEmptyState');
  const collectorRescheduleFiltersToggle = document.getElementById('collectorRescheduleFiltersToggle');
  const collectorRescheduleFiltersPanel = document.getElementById('collectorRescheduleFiltersPanel');
  const collectorRescheduleActiveFilterCount = document.getElementById('collectorRescheduleActiveFilterCount');
  const collectorRescheduleSearch = document.getElementById('collectorRescheduleSearch');
  const collectorRescheduleCollectorFilter = document.getElementById('collectorRescheduleCollectorFilter');
  const collectorRescheduleStatusFilter = document.getElementById('collectorRescheduleStatusFilter');
  const collectorRescheduleDateFilter = document.getElementById('collectorRescheduleDateFilter');
  const collectorRescheduleClearFilters = document.getElementById('collectorRescheduleClearFilters');
  const collectorRescheduleRefresh = document.getElementById('collectorRescheduleRefresh');
  const collectorRescheduleCreate = document.getElementById('collectorRescheduleCreate');
  const collectorRescheduleOverdueCount = document.getElementById('collectorRescheduleOverdueCount');
  const collectorRescheduleTodayCount = document.getElementById('collectorRescheduleTodayCount');
  const collectorRescheduleUpcomingCount = document.getElementById('collectorRescheduleUpcomingCount');
  const collectorReschedulePagination = document.getElementById('collectorReschedulePagination');
  const collectorReschedulePageSummary = document.getElementById('collectorReschedulePageSummary');
  const collectorReschedulePageIndicator = document.getElementById('collectorReschedulePageIndicator');
  const collectorReschedulePreviousPage = document.getElementById('collectorReschedulePreviousPage');
  const collectorRescheduleNextPage = document.getElementById('collectorRescheduleNextPage');
  const collectorScheduleModal = document.getElementById('collectorScheduleModal');
  const collectorScheduleForm = document.getElementById('collectorScheduleForm');
  const collectorScheduleModalTitle = document.getElementById('collectorScheduleModalTitle');
  const collectorScheduleModalSubtitle = document.getElementById('collectorScheduleModalSubtitle');
  const collectorScheduleRecordId = document.getElementById('collectorScheduleRecordId');
  const collectorScheduleCustomer = document.getElementById('collectorScheduleCustomer');
  const collectorScheduleCollector = document.getElementById('collectorScheduleCollector');
  const collectorScheduleDate = document.getElementById('collectorScheduleDate');
  const collectorScheduleTime = document.getElementById('collectorScheduleTime');
  const collectorScheduleResult = document.getElementById('collectorScheduleResult');
  const collectorScheduleResultLabel = document.getElementById('collectorScheduleResultLabel');
  const collectorScheduleNotes = document.getElementById('collectorScheduleNotes');
  const collectorScheduleNotesLabel = document.getElementById('collectorScheduleNotesLabel');
  const collectorScheduleNotesHint = document.getElementById('collectorScheduleNotesHint');
  const collectorSchedulePaymentDetails = document.getElementById('collectorSchedulePaymentDetails');
  const collectorSchedulePaymentReference = document.getElementById('collectorSchedulePaymentReference');
  const collectorScheduleAmountPaid = document.getElementById('collectorScheduleAmountPaid');
  const collectorScheduleRemainingBalance = document.getElementById('collectorScheduleRemainingBalance');
  const collectorSchedulePaymentStatus = document.getElementById('collectorSchedulePaymentStatus');
  const collectorScheduleAuditSummary = document.getElementById('collectorScheduleAuditSummary');
  const collectorScheduleMessage = document.getElementById('collectorScheduleMessage');
  const collectorScheduleSave = document.getElementById('collectorScheduleSave');
  const collectorScheduleCancelLabel = document.getElementById('collectorScheduleCancelLabel');
  const closeCollectorScheduleModal = document.getElementById('closeCollectorScheduleModal');
  const cancelCollectorScheduleModal = document.getElementById('cancelCollectorScheduleModal');
  const assignmentList = document.getElementById('assignmentList');
  const assignmentCount = document.getElementById('assignmentCount');
  const assignmentSearchWrap = document.getElementById('assignmentSearchWrap');
  const assignmentSearch = document.getElementById('assignmentSearch');
  const assignmentSearchClear = document.getElementById('assignmentSearchClear');
  const monthlySummary = document.getElementById('monthlySummary');
  const assignmentsEmptyState = document.getElementById('assignmentsEmptyState');
  const collectorStatsCollectors = document.getElementById('collectorStatsCollectors');
  const collectorStatsAreas = document.getElementById('collectorStatsAreas');
  const collectorStatsCollected = document.getElementById('collectorStatsCollected');
  const collectorStatsPending = document.getElementById('collectorStatsPending');
  const collectorStatsReschedules = document.getElementById('collectorStatsReschedules');
  const collectorAutoRefreshStatus = document.getElementById('collectorAutoRefreshStatus');
  const assignmentModal = document.getElementById('assignmentModal');
  const assignmentForm = document.getElementById('assignmentForm');
  const modalCollectorSelect = document.getElementById('modalCollectorSelect');
  const assignmentAreaSearch = document.getElementById('assignmentAreaSearch');
  const assignmentAreaList = document.getElementById('assignmentAreaList');
  const assignmentClientReview = document.getElementById('assignmentClientReview');
  const assignmentAreaCount = document.getElementById('assignmentAreaCount');
  const assignmentFilterTabs = document.getElementById('assignmentFilterTabs');
  const assignmentSelectAllVisibleBtn = document.getElementById('assignmentSelectAllVisible');
  const assignmentClearSelectedBtn = document.getElementById('assignmentClearSelected');
  const assignmentSaveBtn = document.getElementById('assignmentSaveBtn');
  const assignmentModalMessage = document.getElementById('assignmentModalMessage');
  const newAssignmentBtn = document.getElementById('newAssignmentBtn');
  const closeAssignmentModalBtn = document.getElementById('closeAssignmentModal');
  const cancelAssignmentModalBtn = document.getElementById('cancelAssignmentModal');
  const collectorAreasModal = document.getElementById('collectorAreasModal');
  const collectorAreasModalTitle = document.getElementById('collectorAreasModalTitle');
  const collectorAreasModalSubtitle = document.getElementById('collectorAreasModalSubtitle');
  const collectorAreasModalBody = document.getElementById('collectorAreasModalBody');
  const closeCollectorAreasModalBtn = document.getElementById('closeCollectorAreasModal');
  const collectorAreasDoneBtn = document.getElementById('collectorAreasDoneBtn');
  const collectorAreasEditBtn = document.getElementById('collectorAreasEditBtn');

  const collectorLookup = {};
  let collectorAccountsCache = [];
  let assignmentsByArea = {};
  let availableAreas = [];
  let modalSelectedAreas = new Set();
  let clientReviewCustomers = [];
  let clientReviewByArea = new Map();
  let clientReviewLoaded = false;
  let clientReviewLoading = false;
  let clientReviewError = '';
  let clientReviewPromise = null;
  let activeAssignmentFilter = 'all';
  let areaTotalsCache = {};
  let areaUnpaidCache = {};
  let collectorApprovalRecords = [];
  let collectorPaymentRejectTrigger = null;
  let collectorRemittanceRecords = [];
  let collectorRemittanceFilter = 'pending';
  let collectorRemittanceReviewTrigger = null;
  const collectorApprovalSelectedIds = new Set();
  const collectorApprovalCollapsedGroups = new Set();
  let collectorApprovalPage = 1;
  const collectorApprovalPageSize = 5;
  let collectorPriorityRecords = [];
  let collectorPriorityView = 'active';
  let collectorPriorityPage = 1;
  const collectorPriorityPageSize = 10;
  let collectorPriorityViewMode = false;
  let collectorPrioritySelectionLocked = false;
  let collectorPriorityCustomerCandidates = [];
  const collectorPrioritySelectedAccounts = new Set();
  let collectorRescheduleRecords = [];
  let collectorReschedulePage = 1;
  const collectorReschedulePageSize = 10;
  let collectorScheduleViewMode = false;
  let areaStatsPromise = null;
  let collectorAreaReportCache = {};
  let areaReportCache = {};
  let activeCollectorAreasId = '';
  const COLLECTOR_FALLBACK_REFRESH_INTERVAL_MS = 30000;
  const COLLECTOR_LIVE_RECONNECT_INTERVAL_MS = 10000;
  const COLLECTOR_LIVE_UPDATE_DEBOUNCE_MS = 150;
  const COLLECTOR_LIVE_TOPICS = new Set(['approvals', 'remittances', 'priorities', 'reschedules', 'assignments']);
  let collectorAutoRefreshTimer = null;
  let collectorAutoRefreshInFlight = false;
  let collectorAutoRefreshLastUpdatedAt = null;
  let collectorLastFieldInteractionAt = 0;
  let collectorLiveEventSource = null;
  let collectorLiveReconnectTimer = null;
  let collectorLiveFlushTimer = null;
  let collectorLiveConnected = false;
  let collectorLiveLastVersion = null;
  const collectorLivePendingTopics = new Set();

  const getCurrentMonthKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };

  function fmtMoney(n) {
    return Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function storeAccount(acc) {
    if (!acc) return null;
    const id = acc.id ?? acc.accountId ?? acc.username;
    if (id === undefined || id === null) return null;
    const key = String(id);
    collectorLookup[key] = { ...(collectorLookup[key] || {}), ...acc, id: key };
    return key;
  }

  function rememberAccountsMap(map) {
    Object.entries(map || {}).forEach(([id, acc]) => {
      const key = String(id);
      collectorLookup[key] = { ...(collectorLookup[key] || {}), ...(acc || {}), id: key };
    });
  }

  function getCollectorName(id) {
    const record = collectorLookup[String(id)] || {};
    return record.name || record.username || record.accountId || `Collector ${id}`;
  }

  function getCollectorInitials(id) {
    const label = getCollectorName(id)
      .replace(/[^a-z0-9\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!label) return 'C';
    const parts = label.split(' ').filter(Boolean);
    const initials = parts.length > 1
      ? `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`
      : label.slice(0, 2);
    return initials.toUpperCase();
  }

  function updateAssignmentSummaryStats(collectorCount, assignedAreaTotal, collectedTotal) {
    const safeCollectorCount = Number(collectorCount || 0);
    const safeAssignedAreaTotal = Number(assignedAreaTotal || 0);
    const safeCollectedTotal = Number(collectedTotal || 0);
    if (collectorStatsCollectors) collectorStatsCollectors.textContent = String(safeCollectorCount);
    if (collectorStatsAreas) collectorStatsAreas.textContent = String(safeAssignedAreaTotal);
    if (collectorStatsCollected) collectorStatsCollected.textContent = `PHP ${fmtMoney(safeCollectedTotal)}`;
  }

  function normalizeAreaKey(area) {
    return String(area || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function getAreaReportEntry(cache, area) {
    if (!cache || !area) return null;
    if (cache[area]) return cache[area];
    const target = normalizeAreaKey(area);
    const match = Object.entries(cache).find(([name]) => normalizeAreaKey(name) === target);
    return match ? match[1] : null;
  }

  function getCollectorId(account) {
    return String(account?._id ?? account?.id ?? account?.accountId ?? account?.username ?? '').trim();
  }

  function buildCollectorAreaMap() {
    const map = {};
    Object.entries(normalizeAssignments(assignmentsByArea || {})).forEach(([area, ids]) => {
      ids.forEach((collectorId) => {
        const key = String(collectorId || '').trim();
        if (!key) return;
        map[key] = map[key] || [];
        if (!map[key].includes(area)) map[key].push(area);
      });
    });
    Object.keys(map).forEach((collectorId) => {
      map[collectorId].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true }));
    });
    return map;
  }

  function getDisplayCollectors() {
    const byId = new Map();
    collectorAccountsCache.forEach((account) => {
      const id = getCollectorId(account);
      if (!id) return;
      byId.set(id, { ...(account || {}), id, _id: id });
    });

    Object.values(normalizeAssignments(assignmentsByArea || {})).forEach((ids) => {
      ids.forEach((collectorId) => {
        const id = String(collectorId || '').trim();
        if (!id || byId.has(id)) return;
        byId.set(id, { ...(collectorLookup[id] || {}), id, _id: id });
      });
    });

    return Array.from(byId.values()).sort((a, b) => {
      const left = getCollectorName(getCollectorId(a));
      const right = getCollectorName(getCollectorId(b));
      return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
    });
  }

  function getCollectorAreaAmount(collectorId, area, monthKey) {
    const byCollector = collectorAreaReportCache[String(collectorId)] || {};
    const byMonth = getAreaReportEntry(byCollector, area) || {};
    if (Object.prototype.hasOwnProperty.call(byMonth, monthKey)) {
      return Number(byMonth[monthKey] || 0);
    }
    const legacyArea = getAreaReportEntry(areaReportCache, area) || {};
    if (String(legacyArea.collectorId || '') === String(collectorId)) {
      return Number(legacyArea.months?.[monthKey] || 0);
    }
    return 0;
  }

  function getCollectorMonthTotal(collectorId, areas, monthKey) {
    void areas;
    const monthlyTotal = Number(loadReport.lastReport?.[String(collectorId)]?.[monthKey] || 0);
    return Number.isFinite(monthlyTotal) ? monthlyTotal : 0;
  }

  function areaCountLabel(count) {
    return count === 1 ? '1 area' : `${count} areas`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getClientArea(customer) {
    return String(
      customer?.area
      || customer?.coverageArea
      || customer?.coverage_area
      || customer?.coverageAreaName
      || customer?.areaName
      || ''
    ).trim();
  }

  function getClientAccountNumber(customer) {
    return String(customer?.accountNumber || customer?.account_number || customer?.id || '').trim();
  }

  function getClientDisplayName(customer) {
    const firstName = String(customer?.firstName || customer?.first_name || '').trim();
    const lastName = String(customer?.lastName || customer?.last_name || '').trim();
    const fromParts = [firstName, lastName].filter(Boolean).join(' ');
    return String(
      customer?.name
      || customer?.fullName
      || customer?.customerName
      || fromParts
      || getClientAccountNumber(customer)
      || 'Unnamed client'
    ).trim();
  }

  function getClientPlanLabel(customer) {
    return String(customer?.planName || customer?.plan_name || customer?.plan || customer?.packageName || '').trim();
  }

  function getClientStatusLabel(customer) {
    if (customer?.complimentaryAccount?.active === true) return 'Complimentary';
    const label = String(
      customer?.accountStatusLabel
      || customer?.statusLabel
      || customer?.statusText
      || customer?.status
      || ''
    ).trim();
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
  }

  function compareClientRecords(left, right) {
    const nameOrder = getClientDisplayName(left).localeCompare(getClientDisplayName(right), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
    if (nameOrder) return nameOrder;
    return getClientAccountNumber(left).localeCompare(getClientAccountNumber(right), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  }

  function rebuildClientReviewIndex() {
    const next = new Map();
    clientReviewCustomers.forEach((customer) => {
      const area = getClientArea(customer);
      const areaKey = normalizeAreaKey(area);
      if (!areaKey) return;
      const bucket = next.get(areaKey) || [];
      bucket.push(customer);
      next.set(areaKey, bucket);
    });
    next.forEach((clients) => clients.sort(compareClientRecords));
    clientReviewByArea = next;
  }

  function getClientsForArea(area) {
    return clientReviewByArea.get(normalizeAreaKey(area)) || [];
  }

  function clientCountLabel(count) {
    return count === 1 ? '1 client' : `${count} clients`;
  }

  function renderClientReviewRows(clients) {
    const visible = clients.slice(0, 12);
    const rows = visible.map((client) => {
      const accountNumber = getClientAccountNumber(client);
      const planLabel = getClientPlanLabel(client);
      const statusLabel = getClientStatusLabel(client);
      const metaParts = [accountNumber ? `#${accountNumber}` : '', planLabel, statusLabel].filter(Boolean);
      return `
        <li class="assignment-client-review__item">
          <span class="assignment-client-review__name">${escapeHtml(getClientDisplayName(client))}</span>
          <span class="assignment-client-review__meta">${escapeHtml(metaParts.join(' - ') || 'Client record')}</span>
        </li>
      `;
    }).join('');
    const moreCount = clients.length - visible.length;
    const moreRow = moreCount > 0
      ? `<li class="assignment-client-review__more">+${moreCount} more ${moreCount === 1 ? 'client' : 'clients'}</li>`
      : '';
    return `<ul class="assignment-client-review__list">${rows}${moreRow}</ul>`;
  }

  function renderAssignmentClientReview() {
    if (!assignmentClientReview) return;
    const selectedAreas = getSelectedModalAreas();
    if (!selectedAreas.length) {
      assignmentClientReview.innerHTML = `
        <div class="assignment-client-review__empty">
          <i class="ti ti-users" aria-hidden="true"></i>
          <span>Select coverage areas to review clients per area.</span>
        </div>
      `;
      return;
    }

    if (clientReviewLoading && !clientReviewLoaded) {
      assignmentClientReview.innerHTML = `
        <div class="assignment-client-review__empty">
          <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
          <span>Loading clients for review...</span>
        </div>
      `;
      return;
    }

    if (clientReviewError && !clientReviewLoaded) {
      assignmentClientReview.innerHTML = `
        <div class="assignment-client-review__empty assignment-client-review__empty--error">
          <i class="ti ti-alert-circle" aria-hidden="true"></i>
          <span>${escapeHtml(clientReviewError)}</span>
        </div>
      `;
      return;
    }

    const groups = selectedAreas.map((area) => ({
      area,
      clients: getClientsForArea(area),
    }));
    const totalClients = groups.reduce((sum, group) => sum + group.clients.length, 0);

    assignmentClientReview.innerHTML = `
      <div class="assignment-client-review__header">
        <div>
          <span class="assignment-client-review__eyebrow">Review only</span>
          <strong>Clients per selected area</strong>
        </div>
        <span class="badge bg-secondary-lt text-secondary">${clientCountLabel(totalClients)}</span>
      </div>
      <div class="assignment-client-review__groups">
        ${groups.map((group) => `
          <section class="assignment-client-review__group">
            <div class="assignment-client-review__group-head">
              <strong title="${escapeHtml(group.area)}">${escapeHtml(group.area)}</strong>
              <span>${clientCountLabel(group.clients.length)}</span>
            </div>
            ${group.clients.length
              ? renderClientReviewRows(group.clients)
              : '<p class="assignment-client-review__no-clients">No clients found in this area.</p>'}
          </section>
        `).join('')}
      </div>
    `;
  }

  async function loadClientReviewCustomers(forceRefresh = false) {
    if (forceRefresh && !clientReviewPromise) clientReviewLoaded = false;
    if (clientReviewLoaded) return clientReviewCustomers;
    if (clientReviewPromise) return clientReviewPromise;
    clientReviewLoading = true;
    clientReviewError = '';
    renderAssignmentClientReview();

    clientReviewPromise = Promise.all([
      fetch('/api/customers', { credentials: 'include', cache: 'no-store' }),
      fetch('/api/payment-records', { credentials: 'include', cache: 'no-store' }).catch(() => null)
    ])
      .then(async ([res, billingRes]) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || payload?.message || 'Unable to load clients for review.');
        }
        const billingPayload = billingRes?.ok ? await billingRes.json().catch(() => ({})) : {};
        const billingByAccount = new Map((Array.isArray(billingPayload?.records) ? billingPayload.records : []).map((record) => [
          getClientAccountNumber(record),
          record
        ]));
        const customers = Array.isArray(payload?.customers)
          ? payload.customers
          : (Array.isArray(payload) ? payload : []);
        clientReviewCustomers = customers.map((customer) => {
          const billingRecord = billingByAccount.get(getClientAccountNumber(customer)) || null;
          return {
            ...customer,
            complimentaryAccount: billingRecord?.complimentaryAccount || billingRecord?.billingSummary?.complimentaryAccount || null,
            collectorBillingRecord: billingRecord
          };
        });
        clientReviewLoaded = true;
        rebuildClientReviewIndex();
        return clientReviewCustomers;
      })
      .catch((err) => {
        clientReviewError = err?.message || 'Unable to load clients for review.';
        throw err;
      })
      .finally(() => {
        clientReviewLoading = false;
        clientReviewPromise = null;
        renderAssignmentClientReview();
      });

    return clientReviewPromise;
  }

  function formatCollectorPaymentDate(value) {
    if (!value) return 'No date';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function setApprovalCount(count) {
    const safeCount = Math.max(Number(count) || 0, 0);
    if (collectorApprovalCount) {
      collectorApprovalCount.textContent = safeCount === 1 ? '1 pending' : `${safeCount} pending`;
    }
    if (collectorStatsPending) collectorStatsPending.textContent = String(safeCount);
  }

  function updateCollectorApprovalBatchState(records = []) {
    const rows = Array.isArray(records) ? records : [];
    const total = rows.reduce((sum, record) => sum + Math.abs(Number(record?.amount) || 0), 0);
    setApprovalCount(rows.length);
    if (collectorApprovalTotal) collectorApprovalTotal.textContent = `PHP ${fmtMoney(total)}`;
  }

  function getCollectorApprovalGroupKey(record = {}) {
    return String(
      record?.collectorId
      || record?.collectorUsername
      || record?.collectorName
      || 'collector'
    ).trim() || 'collector';
  }

  function getCollectorApprovalGroupName(record = {}) {
    return String(record?.collectorName || record?.collectorUsername || 'Collector').trim() || 'Collector';
  }

  function getCollectorApprovalTime(record = {}) {
    const time = new Date(record?.recordedAt || record?.date || '').getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function collectorApprovalDateKey(value) {
    const raw = String(value || '').trim();
    const directMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (directMatch) return directMatch[1];
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getCollectorApprovalAge(record = {}) {
    const time = getCollectorApprovalTime(record);
    if (!time) return { days: null, isOld: false, label: '—' };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const recorded = new Date(time);
    recorded.setHours(0, 0, 0, 0);
    const days = Math.max(0, Math.floor((today.getTime() - recorded.getTime()) / 86400000));
    return {
      days,
      isOld: days >= 2,
      label: days === 0 ? 'Today' : (days === 1 ? '1 day' : `${days} days`),
    };
  }

  function populateCollectorApprovalFilter(records = []) {
    if (!collectorApprovalCollectorFilter) return;
    const previous = collectorApprovalCollectorFilter.value;
    const options = new Map();
    (Array.isArray(records) ? records : []).forEach((record) => {
      options.set(getCollectorApprovalGroupKey(record), getCollectorApprovalGroupName(record));
    });
    collectorApprovalCollectorFilter.innerHTML = '<option value="">All collectors</option>';
    [...options.entries()]
      .sort((left, right) => left[1].localeCompare(right[1], undefined, { sensitivity: 'base', numeric: true }))
      .forEach(([key, name]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = name;
        collectorApprovalCollectorFilter.appendChild(option);
      });
    collectorApprovalCollectorFilter.value = options.has(previous) ? previous : '';
  }

  function updateCollectorApprovalSelectionState() {
    const count = collectorApprovalSelectedIds.size;
    if (collectorApprovalSelection) collectorApprovalSelection.hidden = count === 0;
    if (collectorApprovalSelectionCount) {
      collectorApprovalSelectionCount.textContent = count === 1 ? '1 selected' : `${count} selected`;
    }
    if (collectorApprovalApproveSelected) collectorApprovalApproveSelected.disabled = count === 0;
  }

  function buildCollectorApprovalGroups(records = []) {
    const byKey = new Map();
    (Array.isArray(records) ? records : []).forEach((record) => {
      const key = getCollectorApprovalGroupKey(record);
      const existing = byKey.get(key) || {
        key,
        name: getCollectorApprovalGroupName(record),
        records: [],
        total: 0,
        oldestTime: Number.POSITIVE_INFINITY,
      };
      const time = getCollectorApprovalTime(record);
      existing.records.push(record);
      existing.total += Math.abs(Number(record?.amount) || 0);
      if (time) existing.oldestTime = Math.min(existing.oldestTime, time);
      byKey.set(key, existing);
    });
    return [...byKey.values()].sort((left, right) => {
      if (left.oldestTime !== right.oldestTime) return left.oldestTime - right.oldestTime;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
    });
  }

  function formatCollectorApprovalBatchLine(record = {}) {
    const clientName = record?.customerName || record?.accountNumber || 'Client';
    const reference = String(record?.reference || '').trim() || 'No reference';
    return `${clientName} - PHP ${fmtMoney(record?.amount)} - ${reference}`;
  }

  function buildCollectorApprovalBatchMessage(records = []) {
    const rows = Array.isArray(records) ? records : [];
    const total = rows.reduce((sum, record) => sum + Math.abs(Number(record?.amount) || 0), 0);
    const visibleRows = rows.slice(0, 10).map(formatCollectorApprovalBatchLine);
    const remaining = rows.length - visibleRows.length;
    const moreLine = remaining > 0 ? [`+${remaining} more payment${remaining === 1 ? '' : 's'}`] : [];
    const collectorName = rows.length ? getCollectorApprovalGroupName(rows[0]) : 'Collector';
    return [
      `Approve ${rows.length} pending payment${rows.length === 1 ? '' : 's'} for ${collectorName}?`,
      '',
      'Paid Client - Amount - Reference',
      ...visibleRows,
      ...moreLine,
      '',
      `Total: PHP ${fmtMoney(total)}`
    ].join('\n');
  }

  function renderCollectorApprovals(records = []) {
    const rows = Array.isArray(records) ? records : [];
    collectorApprovalRecords = rows;
    updateCollectorApprovalBatchState(rows);
    const validIds = new Set(rows.map((record) => String(record?.id || '').trim()).filter(Boolean));
    [...collectorApprovalSelectedIds].forEach((id) => {
      if (!validIds.has(id)) collectorApprovalSelectedIds.delete(id);
    });
    updateCollectorApprovalSelectionState();
    populateCollectorApprovalFilter(rows);
    if (!collectorApprovalList) return;
    collectorApprovalList.innerHTML = '';
    if (!rows.length) {
      if (collectorApprovalSummaryAmount) collectorApprovalSummaryAmount.textContent = 'PHP 0.00';
      if (collectorApprovalSummaryPayments) collectorApprovalSummaryPayments.textContent = '0';
      if (collectorApprovalSummaryCollectors) collectorApprovalSummaryCollectors.textContent = '0';
      if (collectorApprovalSummaryOldest) collectorApprovalSummaryOldest.textContent = '—';
      if (collectorApprovalsEmptyState) {
        collectorApprovalsEmptyState.style.display = 'flex';
        const emptyCopy = collectorApprovalsEmptyState.querySelector('p');
        if (emptyCopy) emptyCopy.textContent = 'No customer payments await approval.';
      }
      if (collectorApprovalPagination) collectorApprovalPagination.hidden = true;
      return;
    }

    const searchQuery = String(collectorApprovalSearch?.value || '').trim().toLowerCase();
    const collectorKey = String(collectorApprovalCollectorFilter?.value || '').trim();
    const dateKey = String(collectorApprovalDateFilter?.value || '').trim();
    const filteredRows = rows
      .filter((record) => {
        if (collectorKey && getCollectorApprovalGroupKey(record) !== collectorKey) return false;
        if (dateKey && collectorApprovalDateKey(record?.recordedAt || record?.date) !== dateKey) return false;
        if (!searchQuery) return true;
        return [
          record?.customerName,
          record?.accountNumber,
          record?.reference,
          record?.area,
          record?.paymentMethod,
          getCollectorApprovalGroupName(record),
        ].some((value) => String(value || '').toLowerCase().includes(searchQuery));
      })
      .sort((left, right) => {
        const leftTime = getCollectorApprovalTime(left) || Number.POSITIVE_INFINITY;
        const rightTime = getCollectorApprovalTime(right) || Number.POSITIVE_INFINITY;
        return leftTime - rightTime;
      });

    const filteredTotal = filteredRows.reduce((sum, record) => sum + Math.abs(Number(record?.amount) || 0), 0);
    const filteredCollectors = new Set(filteredRows.map(getCollectorApprovalGroupKey));
    const oldestRecord = filteredRows.find((record) => getCollectorApprovalTime(record));
    if (collectorApprovalSummaryAmount) collectorApprovalSummaryAmount.textContent = `PHP ${fmtMoney(filteredTotal)}`;
    if (collectorApprovalSummaryPayments) collectorApprovalSummaryPayments.textContent = String(filteredRows.length);
    if (collectorApprovalSummaryCollectors) collectorApprovalSummaryCollectors.textContent = String(filteredCollectors.size);
    if (collectorApprovalSummaryOldest) collectorApprovalSummaryOldest.textContent = oldestRecord ? getCollectorApprovalAge(oldestRecord).label : '—';

    if (!filteredRows.length) {
      if (collectorApprovalsEmptyState) {
        collectorApprovalsEmptyState.style.display = 'flex';
        const emptyCopy = collectorApprovalsEmptyState.querySelector('p');
        if (emptyCopy) emptyCopy.textContent = 'No pending payments match these filters.';
      }
      if (collectorApprovalPagination) collectorApprovalPagination.hidden = true;
      return;
    }
    if (collectorApprovalsEmptyState) collectorApprovalsEmptyState.style.display = 'none';

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / collectorApprovalPageSize));
    collectorApprovalPage = Math.min(Math.max(1, collectorApprovalPage), totalPages);
    const startIndex = (collectorApprovalPage - 1) * collectorApprovalPageSize;
    const pageRows = filteredRows.slice(startIndex, startIndex + collectorApprovalPageSize);
    if (collectorApprovalPagination) collectorApprovalPagination.hidden = false;
    if (collectorApprovalPageSummary) {
      collectorApprovalPageSummary.textContent = `Showing ${startIndex + 1}-${startIndex + pageRows.length} of ${filteredRows.length}`;
    }
    if (collectorApprovalPageIndicator) collectorApprovalPageIndicator.textContent = `Page ${collectorApprovalPage} of ${totalPages}`;
    if (collectorApprovalPreviousPage) collectorApprovalPreviousPage.disabled = collectorApprovalPage <= 1;
    if (collectorApprovalNextPage) collectorApprovalNextPage.disabled = collectorApprovalPage >= totalPages;

    const allApprovalGroupsByKey = new Map(buildCollectorApprovalGroups(rows).map((group) => [group.key, group]));
    buildCollectorApprovalGroups(pageRows).forEach((group) => {
      const fullGroup = allApprovalGroupsByKey.get(group.key) || group;
      const shownCopy = group.records.length < fullGroup.records.length ? ` - ${group.records.length} shown` : '';
      const collapsed = collectorApprovalCollapsedGroups.has(group.key);
      const groupCard = document.createElement('article');
      groupCard.className = 'collector-approval-group-card';
      groupCard.setAttribute('role', 'listitem');
      groupCard.innerHTML = `
        <div class="collector-approval-group-card__header">
          <button type="button" class="collector-approval-group-toggle" data-collector-approval-toggle="${escapeHtml(group.key)}" aria-expanded="${collapsed ? 'false' : 'true'}">
            <span class="avatar avatar-sm bg-warning-lt text-warning" aria-hidden="true"><i class="ti ti-user-dollar"></i></span>
            <span class="collector-approval-group__copy">
              <strong>${escapeHtml(group.name)}</strong>
              <span>${fullGroup.records.length} pending - PHP ${escapeHtml(fmtMoney(fullGroup.total))}${escapeHtml(shownCopy)}</span>
            </span>
            <i class="ti ti-chevron-${collapsed ? 'down' : 'up'} collector-approval-group-chevron" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-success btn-sm" data-collector-approval-collector-action="approve" data-collector-key="${escapeHtml(group.key)}" title="Approve all ${fullGroup.records.length} pending payments for ${escapeHtml(group.name)}">
            <i class="ti ti-checks" aria-hidden="true"></i>
            <span>Approve All</span>
          </button>
        </div>
        <div class="collector-approval-group-card__body"${collapsed ? ' hidden' : ''}></div>
      `;
      const groupBody = groupCard.querySelector('.collector-approval-group-card__body');
      group.records.forEach((record) => {
        const paymentItem = document.createElement('div');
        const age = getCollectorApprovalAge(record);
        paymentItem.className = `collector-approval-payment-item${age.isOld ? ' is-old' : ''}`;
        const id = String(record?.id || '').trim();
        const clientName = record?.customerName || record?.accountNumber || 'Client';
        const accountNumber = String(record?.accountNumber || '').trim();
        const area = String(record?.area || '').trim();
        const ageBadge = age.isOld
          ? `<span class="badge bg-warning-lt text-warning">${escapeHtml(age.label)} pending</span>`
          : '';

        paymentItem.innerHTML = `
          <label class="collector-approval-payment-select" title="Select ${escapeHtml(clientName)}">
            <input class="form-check-input" type="checkbox" data-collector-approval-select="${escapeHtml(id)}" aria-label="Select payment from ${escapeHtml(clientName)}"${collectorApprovalSelectedIds.has(id) ? ' checked' : ''}${id ? '' : ' disabled'}>
          </label>
          <div class="collector-approval-payment-field collector-approval-payment-client">
            <span>Client</span>
            <strong>${escapeHtml(clientName)}</strong>
            <small>${escapeHtml([accountNumber ? `#${accountNumber}` : '', area].filter(Boolean).join(' - ') || 'Client account')}</small>
          </div>
          <div class="collector-approval-payment-field collector-approval-payment-date">
            <span>Date</span>
            <strong>${escapeHtml(formatCollectorPaymentDate(record?.recordedAt || record?.date))}</strong>
            ${ageBadge}
          </div>
          <div class="collector-approval-payment-field collector-approval-payment-amount">
            <span>Amount</span>
            <strong>PHP ${escapeHtml(fmtMoney(record?.amount))}</strong>
          </div>
          <details class="collector-approval-action-menu">
            <summary class="btn btn-ghost-secondary btn-sm btn-icon" title="Payment actions" aria-label="Actions for payment from ${escapeHtml(clientName)}">
              <i class="ti ti-dots-vertical" aria-hidden="true"></i>
            </summary>
            <div class="collector-approval-action-menu__dropdown">
              <button type="button" class="dropdown-item text-danger" data-collector-approval-action="reject" data-entry-id="${escapeHtml(id)}">
                <i class="ti ti-x" aria-hidden="true"></i>
                <span>Reject Payment</span>
              </button>
            </div>
          </details>
        `;
        groupBody?.appendChild(paymentItem);
      });
      collectorApprovalList.appendChild(groupCard);
    });
  }

  function renderCollectorApprovalNotice(message, tone = 'danger') {
    collectorApprovalRecords = [];
    collectorApprovalSelectedIds.clear();
    updateCollectorApprovalBatchState([]);
    updateCollectorApprovalSelectionState();
    populateCollectorApprovalFilter([]);
    if (!collectorApprovalList) return;
    const className = tone === 'muted' ? 'text-secondary' : 'text-danger';
    collectorApprovalList.innerHTML = `<div class="text-center ${className} py-3">${escapeHtml(message)}</div>`;
    if (collectorApprovalSummaryAmount) collectorApprovalSummaryAmount.textContent = 'PHP 0.00';
    if (collectorApprovalSummaryPayments) collectorApprovalSummaryPayments.textContent = '0';
    if (collectorApprovalSummaryCollectors) collectorApprovalSummaryCollectors.textContent = '0';
    if (collectorApprovalSummaryOldest) collectorApprovalSummaryOldest.textContent = '—';
    if (collectorApprovalPagination) collectorApprovalPagination.hidden = true;
    if (collectorApprovalsEmptyState) collectorApprovalsEmptyState.style.display = 'none';
  }

  function getCollectorApprovalErrorMessage(status, payload = {}) {
    if (status === 401) return 'Please log in again as admin to load customer payment approvals.';
    if (status === 403) return payload?.error || 'Admin access is required to review collector payments.';
    if (status === 404) return 'Collector approval API is not active yet. Restart the server and refresh this page.';
    return payload?.error || payload?.message || 'Failed to load customer payment approvals.';
  }

  function shouldPreserveCollectorDataOnError(preserveOnError, status) {
    return Boolean(preserveOnError) && ![401, 403].includes(Number(status || 0));
  }

  async function loadCollectorApprovals({ preserveOnError = false } = {}) {
    if (!collectorApprovalList) return false;
    if (collectorApprovalRefresh) collectorApprovalRefresh.disabled = true;
    try {
      const res = await fetch('/api/collector/payments/approvals', { credentials: 'include', cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        const error = new Error(getCollectorApprovalErrorMessage(res.status, payload));
        error.status = res.status;
        throw error;
      }
      renderCollectorApprovals(payload.records || []);
      return true;
    } catch (err) {
      console.warn('Failed to load collector payment approvals', err);
      const status = Number(err?.status || 0);
      if (!shouldPreserveCollectorDataOnError(preserveOnError, status)) {
        const tone = [401, 403, 404].includes(status) ? 'muted' : 'danger';
        renderCollectorApprovalNotice(err?.message || 'Failed to load customer payment approvals.', tone);
      }
      return false;
    } finally {
      if (collectorApprovalRefresh) collectorApprovalRefresh.disabled = false;
    }
  }

  function normalizeCollectorRemittanceStatus(value = '') {
    const status = String(value || 'pending').trim().toLowerCase();
    if (status === 'remitted' || status === 'approved' || status === 'confirmed') return 'remitted';
    if (status === 'rejected' || status === 'declined' || status === 'cancelled') return 'rejected';
    return 'pending';
  }

  function collectorRemittanceStatusMeta(value = '') {
    const status = normalizeCollectorRemittanceStatus(value);
    if (status === 'remitted') return { label: 'Remitted', badge: 'bg-green-lt text-green' };
    if (status === 'rejected') return { label: 'Rejected', badge: 'bg-danger-lt text-danger' };
    return { label: 'Pending Review', badge: 'bg-warning-lt text-warning' };
  }

  function collectorRemittancePaymentStatusMeta(value = '') {
    const status = String(value || 'pending_approval').trim().toLowerCase();
    if (status === 'approved') return { label: 'Approved', badge: 'bg-green-lt text-green' };
    if (status === 'rejected') return { label: 'Rejected', badge: 'bg-danger-lt text-danger' };
    return { label: 'Pending Approval', badge: 'bg-warning-lt text-warning' };
  }

  function collectorRemittanceSummary(record = {}) {
    const summary = record?.paymentSummary || {};
    const payments = Array.isArray(record?.payments) ? record.payments : [];
    return {
      count: Number(summary.count ?? payments.length) || 0,
      pending: Number(summary.pending || 0),
      approved: Number(summary.approved || 0),
      rejected: Number(summary.rejected || 0),
      pendingAmount: Number(summary.pendingAmount || 0),
      approvedAmount: Number(summary.approvedAmount || 0),
      rejectedAmount: Number(summary.rejectedAmount || record?.rejectedTotalAmount || 0),
      totalAmount: Number(summary.totalAmount || record?.originalTotalAmount || record?.totalAmount || 0)
    };
  }

  function collectorRemittanceVerifiedAmount(record = {}) {
    const summary = collectorRemittanceSummary(record);
    return Number(summary.approvedAmount.toFixed(2));
  }

  function collectorRemittanceConfirmationState(record = {}) {
    const summary = collectorRemittanceSummary(record);
    if (summary.pending > 0) {
      return {
        allowed: false,
        reason: `${summary.pending} customer payment${summary.pending === 1 ? ' still needs' : 's still need'} approval or rejection.`
      };
    }
    if (summary.approved < 1) {
      return { allowed: false, reason: 'This batch has no approved customer payments to remit.' };
    }
    return { allowed: true, reason: '' };
  }

  function collectorRemittanceDate(record = {}) {
    return record?.collectionDate || record?.submittedAt || record?.updatedAt || '';
  }

  function renderCollectorRemittances() {
    if (!collectorRemittanceList) return;
    const counts = { pending: 0, remitted: 0, rejected: 0 };
    collectorRemittanceRecords.forEach((record) => {
      counts[normalizeCollectorRemittanceStatus(record?.status)] += 1;
    });
    if (collectorRemittancePendingCount) collectorRemittancePendingCount.textContent = String(counts.pending);
    if (collectorRemittanceCompletedCount) collectorRemittanceCompletedCount.textContent = String(counts.remitted);
    if (collectorRemittanceRejectedCount) collectorRemittanceRejectedCount.textContent = String(counts.rejected);
    if (collectorRemittanceCount) {
      collectorRemittanceCount.textContent = counts.pending === 1 ? '1 pending' : `${counts.pending} pending`;
    }
    collectorRemittanceFilterButtons.forEach((button) => {
      const active = button.getAttribute('data-collector-remittance-filter') === collectorRemittanceFilter;
      button.classList.toggle('btn-primary', active);
      button.classList.toggle('btn-outline-secondary', !active);
      button.setAttribute('aria-pressed', String(active));
    });

    const filtered = collectorRemittanceRecords
      .filter((record) => normalizeCollectorRemittanceStatus(record?.status) === collectorRemittanceFilter)
      .sort((left, right) => {
        const leftTime = Date.parse(left?.updatedAt || left?.submittedAt || collectorRemittanceDate(left)) || 0;
        const rightTime = Date.parse(right?.updatedAt || right?.submittedAt || collectorRemittanceDate(right)) || 0;
        return rightTime - leftTime;
      });
    const visibleTotal = filtered.reduce((sum, record) => (
      sum + (collectorRemittanceFilter === 'pending'
        ? collectorRemittanceVerifiedAmount(record)
        : Number(record?.totalAmount || 0))
    ), 0);
    if (collectorRemittanceTotal) collectorRemittanceTotal.textContent = `PHP ${fmtMoney(visibleTotal)}`;
    collectorRemittanceList.innerHTML = '';
    if (collectorRemittanceEmptyState) collectorRemittanceEmptyState.style.display = filtered.length ? 'none' : 'flex';

    filtered.forEach((record) => {
      const recordId = String(record?.id || '').trim();
      const statusMeta = collectorRemittanceStatusMeta(record?.status);
      const summary = collectorRemittanceSummary(record);
      const collectorName = String(record?.collectorName || record?.submittedBy?.name || record?.submittedBy?.username || 'Collector').trim();
      const submittedAt = formatCollectorPaymentDate(record?.submittedAt || collectorRemittanceDate(record));
      const reviewedAt = record?.reviewedAt ? formatCollectorPaymentDate(record.reviewedAt) : '';
      const reviewer = String(record?.reviewedBy?.name || record?.reviewedBy?.username || '').trim();
      const verifiedAmount = collectorRemittanceVerifiedAmount(record);
      const confirmationState = collectorRemittanceConfirmationState(record);
      const paymentRows = (Array.isArray(record?.payments) ? record.payments : []).map((payment) => {
        const paymentStatus = collectorRemittancePaymentStatusMeta(payment?.status);
        const identity = String(payment?.customerName || payment?.accountNumber || 'Payment').trim();
        const reference = String(payment?.reference || payment?.paymentEntryId || 'No reference').trim();
        return `
          <div class="collector-remittance-payment-row">
            <div>
              <strong>${escapeHtml(identity)}</strong>
              <small>${escapeHtml(reference)}</small>
            </div>
            <span class="badge ${paymentStatus.badge}">${paymentStatus.label}</span>
            <strong>PHP ${fmtMoney(payment?.amount)}</strong>
          </div>
        `;
      }).join('');
      const card = document.createElement('article');
      card.className = 'collector-remittance-record';
      card.setAttribute('role', 'listitem');
      card.innerHTML = `
        <div class="collector-remittance-record__header">
          <div>
            <strong>${escapeHtml(collectorName)}</strong>
            <small>${escapeHtml(submittedAt || 'Date unavailable')} &middot; ${summary.count} payment${summary.count === 1 ? '' : 's'}</small>
          </div>
          <span class="badge ${statusMeta.badge}">${statusMeta.label}</span>
        </div>
        <div class="collector-remittance-record__totals">
          <div><span>${collectorRemittanceFilter === 'pending' ? 'Approved cash' : 'Confirmed'}</span><strong>PHP ${fmtMoney(collectorRemittanceFilter === 'pending' ? verifiedAmount : record?.totalAmount)}</strong></div>
          <div><span>Pending approval</span><strong>${summary.pending}</strong></div>
          <div><span>Approved</span><strong>${summary.approved}</strong></div>
          <div><span>Rejected</span><strong>${summary.rejected}</strong></div>
        </div>
        <details class="collector-remittance-payment-details">
          <summary>View payment breakdown</summary>
          <div>${paymentRows || '<p class="text-secondary mb-0">No payment details are available.</p>'}</div>
        </details>
        ${(reviewedAt || record?.adminNote) ? `
          <div class="collector-remittance-review-audit">
            ${reviewedAt ? `<span>Reviewed ${escapeHtml(reviewedAt)}${reviewer ? ` by ${escapeHtml(reviewer)}` : ''}</span>` : ''}
            ${record?.adminNote ? `<span>Note: ${escapeHtml(record.adminNote)}</span>` : ''}
          </div>
        ` : ''}
        ${normalizeCollectorRemittanceStatus(record?.status) === 'pending' && !confirmationState.allowed ? `
          <div class="collector-remittance-gate text-warning" role="status">
            <i class="ti ti-lock" aria-hidden="true"></i>
            <span>${escapeHtml(confirmationState.reason)}</span>
          </div>
        ` : ''}
        ${normalizeCollectorRemittanceStatus(record?.status) === 'pending' ? `
          <div class="collector-remittance-record__actions">
            <button class="btn btn-outline-danger btn-sm" type="button" data-collector-remittance-action="reject" data-remittance-id="${escapeHtml(recordId)}">
              <i class="ti ti-x" aria-hidden="true"></i><span>Reject</span>
            </button>
            <button class="btn btn-success btn-sm" type="button" data-collector-remittance-action="confirm" data-remittance-id="${escapeHtml(recordId)}"${confirmationState.allowed ? '' : ` disabled aria-disabled="true" title="${escapeHtml(confirmationState.reason)}"`}>
              <i class="ti ti-check" aria-hidden="true"></i><span>Confirm Remitted</span>
            </button>
          </div>
        ` : ''}
      `;
      collectorRemittanceList.appendChild(card);
    });
  }

  function renderCollectorRemittanceNotice(message, tone = 'danger') {
    collectorRemittanceRecords = [];
    if (!collectorRemittanceList) return;
    collectorRemittanceList.innerHTML = `<div class="text-center text-${tone} py-3">${escapeHtml(message)}</div>`;
    if (collectorRemittanceCount) collectorRemittanceCount.textContent = 'Unavailable';
    if (collectorRemittanceTotal) collectorRemittanceTotal.textContent = 'PHP 0.00';
    if (collectorRemittanceEmptyState) collectorRemittanceEmptyState.style.display = 'none';
  }

  async function loadCollectorRemittances({ preserveOnError = false } = {}) {
    if (!collectorRemittanceList) return false;
    if (collectorRemittanceRefresh) collectorRemittanceRefresh.disabled = true;
    try {
      const response = await fetch('/api/collector/payments/remittances', {
        credentials: 'include',
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        const error = new Error(payload?.error || payload?.message || 'Failed to load remittances.');
        error.status = response.status;
        throw error;
      }
      collectorRemittanceRecords = Array.isArray(payload?.records) ? payload.records : [];
      renderCollectorRemittances();
      return true;
    } catch (error) {
      console.warn('Failed to load collector remittances', error);
      const status = Number(error?.status || 0);
      if (!shouldPreserveCollectorDataOnError(preserveOnError, status)) {
        const tone = [401, 403, 404].includes(status) ? 'secondary' : 'danger';
        renderCollectorRemittanceNotice(error?.message || 'Failed to load remittances.', tone);
      }
      return false;
    } finally {
      if (collectorRemittanceRefresh) collectorRemittanceRefresh.disabled = false;
    }
  }

  function setCollectorRemittanceReviewMessage(message = '', tone = '') {
    if (!collectorRemittanceReviewMessage) return;
    collectorRemittanceReviewMessage.textContent = message;
    collectorRemittanceReviewMessage.className = `modal-message${tone ? ` text-${tone}` : ''}`;
  }

  function openCollectorRemittanceReview(record, action, triggerButton = null) {
    if (!record?.id || !collectorRemittanceReviewModal || !collectorRemittanceReviewForm) return;
    const rejecting = action === 'reject';
    const summary = collectorRemittanceSummary(record);
    const confirmationState = collectorRemittanceConfirmationState(record);
    if (!rejecting && !confirmationState.allowed) {
      toast(confirmationState.reason, 'danger');
      return;
    }
    collectorRemittanceReviewForm.reset();
    if (collectorRemittanceReviewId) collectorRemittanceReviewId.value = String(record.id);
    if (collectorRemittanceReviewAction) collectorRemittanceReviewAction.value = rejecting ? 'reject' : 'confirm';
    if (collectorRemittanceReviewTitle) collectorRemittanceReviewTitle.textContent = rejecting ? 'Reject Remittance' : 'Confirm Remitted';
    if (collectorRemittanceReviewSubtitle) {
      collectorRemittanceReviewSubtitle.textContent = rejecting
        ? 'Return this batch to the collector with a required reason.'
        : 'All customer payments are decided. Confirm that the received funds match the approved amount.';
    }
    if (collectorRemittanceReviewSummary) {
      const collectorName = String(record?.collectorName || record?.submittedBy?.name || 'Collector').trim();
      collectorRemittanceReviewSummary.className = `alert ${rejecting ? 'alert-danger' : 'alert-success'} collector-remittance-review-summary`;
      collectorRemittanceReviewSummary.textContent = `${collectorName} - ${summary.approved} approved payment${summary.approved === 1 ? '' : 's'} - PHP ${fmtMoney(collectorRemittanceVerifiedAmount(record))} verified cash`;
    }
    if (collectorRemittanceReviewPayments) {
      collectorRemittanceReviewPayments.innerHTML = (Array.isArray(record?.payments) ? record.payments : []).map((payment) => {
        const statusMeta = collectorRemittancePaymentStatusMeta(payment?.status);
        return `
          <div class="collector-remittance-review-payment">
            <div><strong>${escapeHtml(payment?.customerName || payment?.accountNumber || 'Payment')}</strong><small>${escapeHtml(payment?.reference || payment?.paymentEntryId || 'No reference')}</small></div>
            <span class="badge ${statusMeta.badge}">${statusMeta.label}</span>
            <strong>PHP ${fmtMoney(payment?.amount)}</strong>
          </div>
        `;
      }).join('');
    }
    if (collectorRemittanceReviewNoteLabel) {
      collectorRemittanceReviewNoteLabel.innerHTML = rejecting
        ? 'Rejection reason'
        : 'Admin note <span class="text-secondary">(optional)</span>';
    }
    if (collectorRemittanceReviewNote) {
      collectorRemittanceReviewNote.required = rejecting;
      collectorRemittanceReviewNote.placeholder = rejecting
        ? 'Explain the amount or payment that needs correction.'
        : 'Example: Cash and electronic totals verified.';
    }
    if (collectorRemittanceReviewSubmit) {
      collectorRemittanceReviewSubmit.className = `btn ${rejecting ? 'btn-danger' : 'btn-success'} btn-sm`;
      collectorRemittanceReviewSubmit.innerHTML = rejecting
        ? '<i class="ti ti-x" aria-hidden="true"></i><span>Reject Remittance</span>'
        : '<i class="ti ti-check" aria-hidden="true"></i><span>Confirm Remitted</span>';
    }
    collectorRemittanceReviewTrigger = triggerButton;
    setCollectorRemittanceReviewMessage('');
    collectorRemittanceReviewModal.classList.add('show');
    collectorRemittanceReviewModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => (rejecting ? collectorRemittanceReviewNote : collectorRemittanceReviewSubmit)?.focus(), 50);
  }

  function closeCollectorRemittanceReviewDialog() {
    if (!collectorRemittanceReviewModal) return;
    collectorRemittanceReviewModal.classList.remove('show');
    collectorRemittanceReviewModal.setAttribute('aria-hidden', 'true');
    collectorRemittanceReviewForm?.reset();
    if (collectorRemittanceReviewId) collectorRemittanceReviewId.value = '';
    if (collectorRemittanceReviewAction) collectorRemittanceReviewAction.value = '';
    if (collectorRemittanceReviewSubmit) collectorRemittanceReviewSubmit.disabled = false;
    setCollectorRemittanceReviewMessage('');
    collectorRemittanceReviewTrigger?.focus?.();
    collectorRemittanceReviewTrigger = null;
  }

  async function submitCollectorRemittanceDecision() {
    const remittanceId = String(collectorRemittanceReviewId?.value || '').trim();
    const action = String(collectorRemittanceReviewAction?.value || '').trim();
    const note = String(collectorRemittanceReviewNote?.value || '').trim();
    if (!remittanceId || !['confirm', 'reject'].includes(action)) return false;
    if (action === 'reject' && !note) {
      setCollectorRemittanceReviewMessage('Rejection reason is required.', 'danger');
      collectorRemittanceReviewNote?.focus();
      return false;
    }
    if (collectorRemittanceReviewSubmit) collectorRemittanceReviewSubmit.disabled = true;
    setCollectorRemittanceReviewMessage(action === 'confirm' ? 'Confirming remittance...' : 'Rejecting remittance...');
    try {
      const response = await fetch(`/api/collector/payments/remittances/${encodeURIComponent(remittanceId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ note })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload?.error || payload?.message || `Failed to ${action} remittance.`);
      }
      closeCollectorRemittanceReviewDialog();
      await Promise.all([loadCollectorRemittances(), loadReport()]);
      toast(action === 'confirm'
        ? 'Cash remittance confirmed.'
        : 'Remittance rejected and returned to the collector.', 'ok');
      return true;
    } catch (error) {
      setCollectorRemittanceReviewMessage(error?.message || `Failed to ${action} remittance.`, 'danger');
      return false;
    } finally {
      if (collectorRemittanceReviewSubmit) collectorRemittanceReviewSubmit.disabled = false;
    }
  }

  function isActiveCollectorPriority(record = {}) {
    return String(record?.status || '').trim().toLowerCase() === 'active';
  }

  function collectorPriorityLabel(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Normal';
  }

  function collectorPriorityBadgeClass(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'urgent') return 'bg-danger-lt text-danger';
    if (normalized === 'high') return 'bg-orange-lt text-orange';
    if (normalized === 'low') return 'bg-secondary-lt text-secondary';
    return 'bg-primary-lt text-primary';
  }

  function priorityCustomerBalance(customer = {}) {
    const billing = customer?.collectorBillingRecord || {};
    const candidates = [
      billing.paymentBreakdownEndingBalance,
      billing.endingBalance,
      billing.balance,
      customer.paymentBreakdownEndingBalance,
      customer.endingBalance,
      customer.currentBalance,
      customer.balance
    ];
    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined || candidate === '') continue;
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function compareCollectorPriorities(left = {}, right = {}) {
    if (collectorPriorityView === 'history') {
      return String(right?.updatedAt || right?.createdAt || '')
        .localeCompare(String(left?.updatedAt || left?.createdAt || ''));
    }
    const order = { urgent: 0, high: 1, normal: 2, low: 3 };
    const priorityOrder = (order[String(left?.priority || '').toLowerCase()] ?? 9)
      - (order[String(right?.priority || '').toLowerCase()] ?? 9);
    if (priorityOrder) return priorityOrder;
    const dateOrder = String(left?.collectionDate || '').localeCompare(String(right?.collectionDate || ''));
    if (dateOrder) return dateOrder;
    const balanceOrder = Number(right?.amountDue || 0) - Number(left?.amountDue || 0);
    if (balanceOrder) return balanceOrder;
    return String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || ''));
  }

  function renderCollectorPriorities() {
    if (!collectorPriorityList) return;
    const activeCount = collectorPriorityRecords.filter(isActiveCollectorPriority).length;
    const historyCount = Math.max(0, collectorPriorityRecords.length - activeCount);
    const showingHistory = collectorPriorityView === 'history';
    const rows = collectorPriorityRecords
      .filter((record) => showingHistory ? !isActiveCollectorPriority(record) : isActiveCollectorPriority(record))
      .sort(compareCollectorPriorities);
    const pageCount = Math.max(1, Math.ceil(rows.length / collectorPriorityPageSize));
    collectorPriorityPage = Math.min(Math.max(collectorPriorityPage, 1), pageCount);
    const pageStart = (collectorPriorityPage - 1) * collectorPriorityPageSize;
    const pageRows = rows.slice(pageStart, pageStart + collectorPriorityPageSize);
    if (collectorPriorityCount) collectorPriorityCount.textContent = `${activeCount} active`;
    if (collectorPriorityHistoryToggle) {
      collectorPriorityHistoryToggle.setAttribute('aria-pressed', String(showingHistory));
      collectorPriorityHistoryToggle.title = showingHistory ? 'Return to active priority clients' : 'View priority history';
    }
    if (collectorPriorityHistoryToggleLabel) {
      collectorPriorityHistoryToggleLabel.textContent = showingHistory ? 'View Active' : 'View History';
    }
    if (collectorPriorityHistoryCount) {
      collectorPriorityHistoryCount.textContent = String(showingHistory ? activeCount : historyCount);
    }
    collectorPriorityList.innerHTML = '';
    if (collectorPriorityEmptyState) collectorPriorityEmptyState.style.display = rows.length ? 'none' : 'flex';
    if (collectorPriorityEmptyState) {
      const copy = collectorPriorityEmptyState.querySelector('p');
      if (copy) copy.textContent = showingHistory ? 'No priority history yet.' : 'No active priority clients.';
    }
    if (collectorPriorityPagination) collectorPriorityPagination.hidden = rows.length <= collectorPriorityPageSize;
    if (collectorPriorityPageSummary) {
      const first = rows.length ? pageStart + 1 : 0;
      const last = Math.min(pageStart + collectorPriorityPageSize, rows.length);
      collectorPriorityPageSummary.textContent = rows.length
        ? `Showing ${first}-${last} of ${rows.length} ${showingHistory ? 'history records' : 'active priorities'}`
        : `No ${showingHistory ? 'history records' : 'active priorities'}`;
    }
    if (collectorPriorityPageIndicator) collectorPriorityPageIndicator.textContent = `Page ${collectorPriorityPage} of ${pageCount}`;
    if (collectorPriorityPreviousPage) collectorPriorityPreviousPage.disabled = collectorPriorityPage <= 1;
    if (collectorPriorityNextPage) collectorPriorityNextPage.disabled = collectorPriorityPage >= pageCount;

    pageRows.forEach((record) => {
      const active = isActiveCollectorPriority(record);
      const tr = document.createElement('tr');
      const recordId = String(record?.id || '').trim();
      const balance = record?.amountDue === null || record?.amountDue === undefined || record?.amountDue === ''
        ? Number.NaN
        : Number(record.amountDue);
      const historyLabel = String(record?.historyType || record?.status || 'History').trim();
      tr.className = active ? '' : 'collector-priority-history-row';
      tr.innerHTML = `
        <td data-label="Priority">
          <span class="badge ${collectorPriorityBadgeClass(record?.priority)}">${escapeHtml(collectorPriorityLabel(record?.priority))}</span>
          ${active ? '' : `<span class="collector-priority-history-label">${escapeHtml(historyLabel)}</span>`}
        </td>
        <td data-label="Collection">
          <strong>${escapeHtml(formatCollectorPaymentDate(record?.collectionDate))}</strong>
          ${record?.expiresOn ? `<span class="collector-priority-cell-meta">Expires ${escapeHtml(formatCollectorPaymentDate(record.expiresOn))}</span>` : ''}
        </td>
        <td data-label="Client">
          <strong title="${escapeHtml(record?.customerName || '')}">${escapeHtml(record?.customerName || 'Client')}</strong>
          <span class="collector-priority-cell-meta" title="${escapeHtml(record?.accountNumber || '')}">${escapeHtml(record?.accountNumber || '')}${record?.area ? ` · ${escapeHtml(record.area)}` : ''}</span>
        </td>
        <td data-label="Collection scope"><span class="badge bg-green-lt text-green"><i class="ti ti-users" aria-hidden="true"></i> Anyone</span></td>
        <td data-label="Balance"><strong class="${Number.isFinite(balance) && balance > 0 ? 'text-danger' : 'text-secondary'}">${Number.isFinite(balance) ? `PHP ${fmtMoney(balance)}` : 'Checking'}</strong></td>
        <td data-label="Reason"><span class="collector-priority-reason" title="${escapeHtml(record?.reason || '')}">${escapeHtml(record?.reason || 'No reason')}</span></td>
        <td data-label="Actions" class="text-center">
          <div class="btn-list flex-nowrap justify-content-center collector-priority-actions">
            <button class="btn btn-outline-secondary btn-sm btn-icon" type="button" data-collector-priority-action="view" data-record-id="${escapeHtml(recordId)}" title="View priority" aria-label="View priority"><i class="ti ti-eye" aria-hidden="true"></i></button>
            ${active ? `
              <button class="btn btn-outline-primary btn-sm btn-icon" type="button" data-collector-priority-action="edit" data-record-id="${escapeHtml(recordId)}" title="Edit priority" aria-label="Edit priority"><i class="ti ti-pencil" aria-hidden="true"></i></button>
              <button class="btn btn-outline-danger btn-sm btn-icon" type="button" data-collector-priority-action="delete" data-record-id="${escapeHtml(recordId)}" title="Cancel priority" aria-label="Cancel priority"><i class="ti ti-trash" aria-hidden="true"></i></button>
            ` : ''}
          </div>
        </td>
      `;
      collectorPriorityList.appendChild(tr);
    });
  }

  function renderCollectorPriorityNotice(message, tone = 'danger') {
    if (!collectorPriorityList) return;
    collectorPriorityRecords = [];
    collectorPriorityList.innerHTML = `<tr><td colspan="7" class="text-center text-${tone} py-3">${escapeHtml(message)}</td></tr>`;
    if (collectorPriorityCount) collectorPriorityCount.textContent = 'Unavailable';
    if (collectorPriorityEmptyState) collectorPriorityEmptyState.style.display = 'none';
    if (collectorPriorityPagination) collectorPriorityPagination.hidden = true;
  }

  async function loadCollectorPriorities({ preserveOnError = false } = {}) {
    if (!collectorPriorityList) return false;
    if (collectorPriorityRefresh) collectorPriorityRefresh.disabled = true;
    try {
      const response = await fetch('/api/collector/payments/priorities?status=all&limit=1000', {
        credentials: 'include',
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        const error = new Error(payload?.error || payload?.message || 'Failed to load priority clients.');
        error.status = response.status;
        throw error;
      }
      collectorPriorityRecords = Array.isArray(payload?.records) ? payload.records : [];
      renderCollectorPriorities();
      return true;
    } catch (error) {
      console.warn('Failed to load collector priority assignments', error);
      const status = Number(error?.status || 0);
      if (!shouldPreserveCollectorDataOnError(preserveOnError, status)) {
        const tone = [401, 403, 404].includes(status) ? 'secondary' : 'danger';
        renderCollectorPriorityNotice(error?.message || 'Failed to load priority clients.', tone);
      }
      return false;
    } finally {
      if (collectorPriorityRefresh) collectorPriorityRefresh.disabled = false;
    }
  }

  function setCollectorPriorityMessage(message = '', tone = 'info') {
    if (!collectorPriorityMessage) return;
    const colors = {
      info: 'var(--app-muted, #64748b)',
      success: 'var(--tblr-success, #2fb344)',
      danger: 'var(--tblr-danger, #d63939)'
    };
    collectorPriorityMessage.style.color = colors[tone] || colors.info;
    collectorPriorityMessage.textContent = message;
  }

  function visibleCollectorPriorityCustomers() {
    const search = String(collectorPriorityCustomerSearch?.value || '').trim().toLowerCase();
    if (!search) return collectorPriorityCustomerCandidates;
    return collectorPriorityCustomerCandidates.filter((customer) => (
      [getClientDisplayName(customer), getClientAccountNumber(customer), getClientArea(customer)]
        .some((value) => String(value || '').toLowerCase().includes(search))
    ));
  }

  function selectedCollectorPriorityAccounts() {
    return collectorPriorityCustomerCandidates
      .map((customer) => getClientAccountNumber(customer))
      .filter((accountNumber) => collectorPrioritySelectedAccounts.has(accountNumber));
  }

  function renderCollectorPriorityCustomerPicker() {
    if (!collectorPriorityCustomerList) return;
    const visible = visibleCollectorPriorityCustomers();
    const selectedCount = collectorPrioritySelectedAccounts.size;
    if (collectorPrioritySelectedCount) collectorPrioritySelectedCount.textContent = `${selectedCount} selected`;
    if (collectorPrioritySelectAllVisible) {
      collectorPrioritySelectAllVisible.disabled = collectorPrioritySelectionLocked || !visible.length;
    }
    if (collectorPriorityClearSelected) {
      collectorPriorityClearSelected.disabled = collectorPrioritySelectionLocked || !selectedCount;
    }
    collectorPriorityCustomerList.innerHTML = visible.length
      ? visible.map((customer) => {
          const accountNumber = getClientAccountNumber(customer);
          const balance = priorityCustomerBalance(customer);
          const checked = collectorPrioritySelectedAccounts.has(accountNumber);
          return `
            <label class="collector-priority-client-option${checked ? ' is-selected' : ''}">
              <input class="form-check-input" type="checkbox" data-collector-priority-account="${escapeHtml(accountNumber)}"${checked ? ' checked' : ''}${collectorPrioritySelectionLocked ? ' disabled' : ''}>
              <span class="collector-priority-client-option__rank" aria-hidden="true">${escapeHtml(String(customer._priorityRank || ''))}</span>
              <span class="collector-priority-client-option__identity">
                <strong>${escapeHtml(getClientDisplayName(customer))}</strong>
                <small>${escapeHtml(accountNumber)}${getClientArea(customer) ? ` · ${escapeHtml(getClientArea(customer))}` : ''}</small>
              </span>
              <strong class="collector-priority-client-option__balance">${balance === null ? 'Unavailable' : `PHP ${fmtMoney(balance)}`}</strong>
            </label>
          `;
        }).join('')
      : '<div class="collector-priority-client-picker__empty">No unpaid clients match this search.</div>';
  }

  function prepareCollectorPriorityCustomers(record = null) {
    const selectedAccount = String(record?.accountNumber || '').trim();
    const activeAccounts = new Set(collectorPriorityRecords
      .filter((item) => isActiveCollectorPriority(item) && String(item?.id || '') !== String(record?.id || ''))
      .map((item) => String(item?.accountNumber || '').trim())
      .filter(Boolean));
    const candidates = clientReviewCustomers.filter((customer) => {
      const accountNumber = getClientAccountNumber(customer);
      const balance = priorityCustomerBalance(customer);
      if (!accountNumber || activeAccounts.has(accountNumber)) return false;
      return accountNumber === selectedAccount || (balance !== null && balance > 0.009);
    });
    if (selectedAccount && !candidates.some((customer) => getClientAccountNumber(customer) === selectedAccount)) {
      candidates.push({
        accountNumber: selectedAccount,
        name: record?.customerName || 'Priority Client',
        area: record?.area || '',
        paymentBreakdownEndingBalance: record?.amountDue
      });
    }
    candidates.sort((left, right) => {
      const balanceOrder = Number(priorityCustomerBalance(right) || 0) - Number(priorityCustomerBalance(left) || 0);
      return balanceOrder || compareClientRecords(left, right);
    });
    collectorPriorityCustomerCandidates = candidates.map((customer, index) => ({
      ...customer,
      _priorityRank: index + 1
    }));
    collectorPrioritySelectedAccounts.clear();
    if (selectedAccount) collectorPrioritySelectedAccounts.add(selectedAccount);
    if (collectorPriorityCustomerSearch) collectorPriorityCustomerSearch.value = '';
    if (collectorPriorityCustomerHint) {
      collectorPriorityCustomerHint.textContent = record
        ? 'The client is locked while editing; priority details still apply to the shared queue.'
        : 'Unpaid clients are sorted from highest balance to lowest. Existing active priorities are excluded.';
    }
    renderCollectorPriorityCustomerPicker();
  }

  async function openCollectorPriorityModal(record = null, options = {}) {
    if (!collectorPriorityModal || !collectorPriorityForm) return;
    collectorPriorityForm.reset();
    const editing = Boolean(record?.id);
    collectorPriorityViewMode = Boolean(options.viewOnly && editing);
    collectorPrioritySelectionLocked = editing;
    if (collectorPriorityRecordId) collectorPriorityRecordId.value = editing ? String(record.id) : '';
    if (collectorPriorityModalTitle) {
      collectorPriorityModalTitle.textContent = collectorPriorityViewMode
        ? 'Priority Assignment Details'
        : (editing ? 'Edit Priority Client' : 'Assign Priority Client');
    }
    if (collectorPriorityLevel) collectorPriorityLevel.value = editing ? String(record.priority || 'normal').toLowerCase() : 'normal';
    if (collectorPriorityDate) collectorPriorityDate.value = editing ? String(record.collectionDate || '').slice(0, 10) : collectorScheduleToday();
    if (collectorPriorityExpires) collectorPriorityExpires.value = editing ? String(record.expiresOn || '').slice(0, 10) : '';
    if (collectorPriorityReason) collectorPriorityReason.value = editing ? String(record.reason || '') : '';
    if (collectorPrioritySave) collectorPrioritySave.hidden = collectorPriorityViewMode;
    setCollectorPriorityMessage('Loading unpaid clients by outstanding balance...');
    collectorPriorityModal.classList.add('show');
    collectorPriorityModal.setAttribute('aria-hidden', 'false');

    try {
      await loadClientReviewCustomers(true);
      prepareCollectorPriorityCustomers(record);
      if (collectorPriorityCustomerSearch) collectorPriorityCustomerSearch.disabled = collectorPrioritySelectionLocked;
      [collectorPriorityLevel, collectorPriorityDate, collectorPriorityExpires, collectorPriorityReason]
        .forEach((control) => { if (control) control.disabled = collectorPriorityViewMode; });
      setCollectorPriorityMessage(collectorPriorityViewMode
        ? `${record.historyType || record.status || 'Active'} assignment · Last updated ${formatCollectorPaymentDate(record.updatedAt)}`
        : 'Shared priority assignment loaded.');
      setCollectorPriorityMessage(collectorPriorityViewMode
        ? `${record.historyType || record.status || 'Active'} assignment · Last updated ${formatCollectorPaymentDate(record.updatedAt)}`
        : (editing
          ? 'Changes update the shared queue after collectors tap Sync.'
          : 'One priority, date, expiration, and instruction will be applied to every selected client.'));
      setTimeout(() => (collectorPrioritySelectionLocked ? collectorPriorityLevel : collectorPriorityCustomerSearch)?.focus(), 50);
    } catch (error) {
      setCollectorPriorityMessage(error?.message || 'Unable to load unpaid clients.', 'danger');
    }
  }

  function closeCollectorPriorityEditor() {
    if (!collectorPriorityModal) return;
    collectorPriorityModal.classList.remove('show');
    collectorPriorityModal.setAttribute('aria-hidden', 'true');
    collectorPriorityViewMode = false;
    collectorPrioritySelectionLocked = false;
    collectorPriorityCustomerCandidates = [];
    collectorPrioritySelectedAccounts.clear();
    if (collectorPrioritySave) collectorPrioritySave.hidden = false;
    if (collectorPriorityCustomerSearch) collectorPriorityCustomerSearch.disabled = false;
    [collectorPriorityLevel, collectorPriorityDate, collectorPriorityExpires, collectorPriorityReason]
      .forEach((control) => { if (control) control.disabled = false; });
    setCollectorPriorityMessage('');
  }

  async function saveCollectorPriority() {
    if (collectorPriorityViewMode || !collectorPriorityForm?.reportValidity()) return;
    const recordId = String(collectorPriorityRecordId?.value || '').trim();
    const accountNumbers = selectedCollectorPriorityAccounts();
    if (!accountNumbers.length) {
      setCollectorPriorityMessage('Select at least one unpaid client.', 'danger');
      collectorPriorityCustomerSearch?.focus();
      return;
    }
    const payload = {
      ...(recordId ? { accountNumber: accountNumbers[0] } : { accountNumbers }),
      priority: String(collectorPriorityLevel?.value || '').trim(),
      collectionDate: String(collectorPriorityDate?.value || '').trim(),
      expiresOn: String(collectorPriorityExpires?.value || '').trim(),
      reason: String(collectorPriorityReason?.value || '').trim()
    };
    if (collectorPrioritySave) collectorPrioritySave.disabled = true;
    setCollectorPriorityMessage(recordId ? 'Updating priority assignment...' : `Creating ${accountNumbers.length} priority assignment(s)...`);
    try {
      const response = await fetch(recordId
        ? `/api/collector/payments/priorities/${encodeURIComponent(recordId)}`
        : '/api/collector/payments/priorities', {
        method: recordId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result?.error || result?.message || 'Failed to save priority assignment.');
      closeCollectorPriorityEditor();
      collectorPriorityView = 'active';
      collectorPriorityPage = 1;
      await loadCollectorPriorities();
      const savedCount = Number(result?.count || accountNumbers.length);
      toast(recordId ? 'Priority assignment updated.' : `${savedCount} priority client${savedCount === 1 ? '' : 's'} assigned.`, 'ok');
    } catch (error) {
      setCollectorPriorityMessage(error?.message || 'Failed to save priority assignment.', 'danger');
    } finally {
      if (collectorPrioritySave) collectorPrioritySave.disabled = false;
    }
  }

  async function deleteCollectorPriority(record, triggerButton = null) {
    if (!record?.id) return;
    const clientName = String(record.customerName || record.accountNumber || 'this client').trim();
    const confirmed = window.appConfirm
      ? await window.appConfirm(`Cancel the priority assignment for ${clientName}? It will disappear from Android after the collector's next Sync.`, {
        title: 'Cancel Priority Assignment',
        okText: 'Cancel Assignment',
        type: 'danger'
      })
      : window.confirm(`Cancel the priority assignment for ${clientName}?`);
    if (!confirmed) return;
    if (triggerButton) triggerButton.disabled = true;
    try {
      const response = await fetch(`/api/collector/payments/priorities/${encodeURIComponent(record.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ reason: 'Cancelled by Admin from Collectors page' })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result?.error || result?.message || 'Failed to cancel priority assignment.');
      await loadCollectorPriorities();
      toast('Priority assignment cancelled.', 'ok');
    } catch (error) {
      toast(error?.message || 'Failed to cancel priority assignment.', 'danger');
      if (triggerButton) triggerButton.disabled = false;
    }
  }

  function isActiveCollectorReschedule(record = {}) {
    return String(record?.status || '').trim().toLowerCase() === 'rescheduled';
  }

  function isPartialPaymentCollectorReschedule(record = {}) {
    const type = String(record?.followUpType || record?.source || '').trim().toLowerCase();
    return ['partial_payment', 'partial-payment', 'partial payment'].includes(type)
      || String(record?.result || '').trim().toLowerCase() === 'partial payment';
  }

  function collectorSchedulePaymentStatusLabel(record = {}) {
    const status = String(record?.paymentStatusAtScheduling || '').trim().toLowerCase();
    if (status === 'approved') return 'Approved';
    if (status === 'rejected') return 'Rejected';
    return 'Pending approval';
  }

  function getCollectorRescheduleName(record = {}) {
    const direct = String(record?.collectorName || record?.collectorUsername || '').trim();
    if (direct) return direct;
    const collectorId = String(record?.collectorId || '').trim();
    return collectorId ? getCollectorName(collectorId) : 'Collector';
  }

  function populateCollectorRescheduleFilter() {
    if (!collectorRescheduleCollectorFilter) return;
    const previous = collectorRescheduleCollectorFilter.value;
    const options = new Map();
    collectorAccountsCache.forEach((account) => {
      const id = getCollectorId(account);
      if (id) options.set(id, getCollectorName(id));
    });
    collectorRescheduleRecords.forEach((record) => {
      const id = String(record?.collectorId || '').trim();
      if (id) options.set(id, getCollectorRescheduleName(record));
    });
    collectorRescheduleCollectorFilter.innerHTML = '<option value="">All collectors</option>';
    [...options.entries()]
      .sort((left, right) => left[1].localeCompare(right[1], undefined, { sensitivity: 'base', numeric: true }))
      .forEach(([id, name]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        collectorRescheduleCollectorFilter.appendChild(option);
      });
    collectorRescheduleCollectorFilter.value = options.has(previous) ? previous : '';
  }

  function collectorRescheduleStatusLabel(record = {}) {
    if (isActiveCollectorReschedule(record)) return 'Active';
    return String(record?.historyType || record?.status || 'History').trim() || 'History';
  }

  function collectorRescheduleUrgency(record = {}) {
    if (!isActiveCollectorReschedule(record)) return '';
    const scheduleDate = String(record?.rescheduledDate || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) return '';
    const today = collectorScheduleToday();
    if (scheduleDate < today) return 'overdue';
    if (scheduleDate === today) return 'today';
    return 'upcoming';
  }

  function countCollectorRescheduleFilters() {
    let count = 0;
    if (String(collectorRescheduleSearch?.value || '').trim()) count += 1;
    if (String(collectorRescheduleCollectorFilter?.value || '').trim()) count += 1;
    if (String(collectorRescheduleStatusFilter?.value || 'active').trim().toLowerCase() !== 'active') count += 1;
    if (String(collectorRescheduleDateFilter?.value || '').trim()) count += 1;
    return count;
  }

  function updateCollectorRescheduleFilterToggle() {
    if (!collectorRescheduleFiltersToggle || !collectorRescheduleFiltersPanel) return;
    const expanded = !collectorRescheduleFiltersPanel.hidden;
    const activeFilterCount = countCollectorRescheduleFilters();
    collectorRescheduleFiltersToggle.setAttribute('aria-expanded', String(expanded));
    collectorRescheduleFiltersToggle.setAttribute('aria-label', expanded ? 'Hide schedule filters' : 'Show schedule filters');
    collectorRescheduleFiltersToggle.title = expanded ? 'Hide schedule filters' : 'Show schedule filters';
    collectorRescheduleFiltersToggle.classList.toggle('btn-primary', expanded);
    collectorRescheduleFiltersToggle.classList.toggle('btn-outline-primary', !expanded && activeFilterCount > 0);
    collectorRescheduleFiltersToggle.classList.toggle('btn-outline-secondary', !expanded && activeFilterCount === 0);
    if (collectorRescheduleActiveFilterCount) {
      collectorRescheduleActiveFilterCount.textContent = String(activeFilterCount);
      collectorRescheduleActiveFilterCount.hidden = activeFilterCount === 0;
    }
  }

  function renderCollectorReschedules() {
    if (!collectorRescheduleList) return;
    updateCollectorRescheduleFilterToggle();
    const searchQuery = String(collectorRescheduleSearch?.value || '').trim().toLowerCase();
    const collectorId = String(collectorRescheduleCollectorFilter?.value || '').trim();
    const status = String(collectorRescheduleStatusFilter?.value || 'active').trim().toLowerCase();
    const scheduleDateFilter = String(collectorRescheduleDateFilter?.value || '').trim();
    const rows = collectorRescheduleRecords
      .filter((record) => {
        if (collectorId && String(record?.collectorId || '').trim() !== collectorId) return false;
        if (scheduleDateFilter && String(record?.rescheduledDate || '').trim().slice(0, 10) !== scheduleDateFilter) return false;
        if (status !== 'all' && (status === 'active') !== isActiveCollectorReschedule(record)) return false;
        if (!searchQuery) return true;
        const searchText = [
          record?.customerName,
          record?.accountNumber,
          record?.area,
          getCollectorRescheduleName(record),
          record?.result,
          record?.notes,
          record?.collectorNote,
          record?.paymentReference
        ].map((value) => String(value || '').trim()).join(' ').toLowerCase();
        return searchText.includes(searchQuery);
      })
      .sort((left, right) => {
        const leftActive = isActiveCollectorReschedule(left);
        const rightActive = isActiveCollectorReschedule(right);
        if (leftActive !== rightActive) return leftActive ? -1 : 1;
        const leftDate = String(left?.rescheduledDate || '').slice(0, 10);
        const rightDate = String(right?.rescheduledDate || '').slice(0, 10);
        return leftActive ? leftDate.localeCompare(rightDate) : rightDate.localeCompare(leftDate);
      });

    const activeCount = rows.filter(isActiveCollectorReschedule).length;
    const allActiveCount = collectorRescheduleRecords.filter(isActiveCollectorReschedule).length;
    const priorityCounts = rows.reduce((counts, record) => {
      const urgency = collectorRescheduleUrgency(record);
      if (urgency && Object.prototype.hasOwnProperty.call(counts, urgency)) counts[urgency] += 1;
      return counts;
    }, { overdue: 0, today: 0, upcoming: 0 });
    if (collectorRescheduleOverdueCount) collectorRescheduleOverdueCount.textContent = String(priorityCounts.overdue);
    if (collectorRescheduleTodayCount) collectorRescheduleTodayCount.textContent = String(priorityCounts.today);
    if (collectorRescheduleUpcomingCount) collectorRescheduleUpcomingCount.textContent = String(priorityCounts.upcoming);
    if (collectorStatsReschedules) collectorStatsReschedules.textContent = String(allActiveCount);
    if (collectorRescheduleCount) {
      collectorRescheduleCount.textContent = status === 'active'
        ? `${activeCount} active`
        : `${rows.length} record${rows.length === 1 ? '' : 's'}`;
    }
    collectorRescheduleList.innerHTML = '';
    if (!rows.length) {
      if (collectorReschedulesEmptyState) collectorReschedulesEmptyState.style.display = 'flex';
      if (collectorReschedulePagination) collectorReschedulePagination.hidden = true;
      return;
    }
    if (collectorReschedulesEmptyState) collectorReschedulesEmptyState.style.display = 'none';

    const totalPages = Math.max(1, Math.ceil(rows.length / collectorReschedulePageSize));
    collectorReschedulePage = Math.min(Math.max(1, collectorReschedulePage), totalPages);
    const startIndex = (collectorReschedulePage - 1) * collectorReschedulePageSize;
    const pageRows = rows.slice(startIndex, startIndex + collectorReschedulePageSize);
    if (collectorReschedulePagination) collectorReschedulePagination.hidden = false;
    if (collectorReschedulePageSummary) {
      collectorReschedulePageSummary.textContent = `Showing ${startIndex + 1}-${startIndex + pageRows.length} of ${rows.length}`;
    }
    if (collectorReschedulePageIndicator) {
      collectorReschedulePageIndicator.textContent = `Page ${collectorReschedulePage} of ${totalPages}`;
    }
    if (collectorReschedulePreviousPage) collectorReschedulePreviousPage.disabled = collectorReschedulePage <= 1;
    if (collectorRescheduleNextPage) collectorRescheduleNextPage.disabled = collectorReschedulePage >= totalPages;

    pageRows.forEach((record) => {
      const active = isActiveCollectorReschedule(record);
      const urgency = collectorRescheduleUrgency(record);
      const tr = document.createElement('tr');
      tr.className = ['collector-reschedule-row', urgency ? `is-${urgency}` : '', active ? '' : 'is-history'].filter(Boolean).join(' ');
      if (urgency) tr.setAttribute('data-schedule-priority', urgency);
      const accountNumber = String(record?.accountNumber || '').trim();
      const area = String(record?.area || '').trim();
      const scheduleDate = formatCollectorPaymentDate(record?.rescheduledDate);
      const preferredTime = String(record?.preferredTime || '').trim();
      const result = String(record?.result || '').trim();
      const partialPayment = isPartialPaymentCollectorReschedule(record);
      const notes = String(partialPayment ? (record?.collectorNote ?? record?.notes) : record?.notes).trim();
      const amountPaid = Math.abs(Number(record?.amountPaid) || 0);
      const remainingBalance = Math.abs(Number(record?.remainingBalance) || 0);
      const paymentReference = String(record?.paymentReference || '').trim();
      const statusLabel = collectorRescheduleStatusLabel(record);
      const customerName = String(record?.customerName || accountNumber || 'Client').trim();
      const collectorName = getCollectorRescheduleName(record);
      const accountMeta = [accountNumber ? `#${accountNumber}` : '', area].filter(Boolean).join(' - ') || 'Client account';
      const urgencyBadge = urgency === 'overdue'
        ? '<span class="badge bg-danger-lt text-danger">Overdue</span>'
        : urgency === 'today'
          ? '<span class="badge bg-warning-lt text-warning">Today</span>'
          : urgency === 'upcoming'
            ? '<span class="badge bg-azure-lt text-azure">Upcoming</span>'
            : '';
      const recordId = String(record?.id || '').trim();
      const actions = recordId
        ? `
          <div class="btn-list flex-nowrap justify-content-center collector-reschedule-actions">
            <button class="btn btn-outline-secondary btn-sm btn-icon" type="button" data-collector-reschedule-action="view" data-record-id="${escapeHtml(recordId)}" title="View follow-up" aria-label="View follow-up">
              <i class="ti ti-eye" aria-hidden="true"></i>
            </button>
            ${active ? `
              <button class="btn btn-outline-primary btn-sm btn-icon" type="button" data-collector-reschedule-action="edit" data-record-id="${escapeHtml(recordId)}" title="Edit follow-up" aria-label="Edit follow-up">
                <i class="ti ti-edit" aria-hidden="true"></i>
              </button>
              <button class="btn btn-outline-danger btn-sm btn-icon" type="button" data-collector-reschedule-action="delete" data-record-id="${escapeHtml(recordId)}" title="Delete follow-up" aria-label="Delete follow-up">
                <i class="ti ti-trash" aria-hidden="true"></i>
              </button>
            ` : ''}
          </div>
        `
        : '<span class="text-secondary">&mdash;</span>';
      const detailTitle = partialPayment
        ? `Partial payment${amountPaid ? ` · PHP ${fmtMoney(amountPaid)} paid` : ''}`
        : (result || 'Collection follow-up');
      const detailText = partialPayment
        ? [
          remainingBalance ? `Remaining PHP ${fmtMoney(remainingBalance)}` : '',
          paymentReference ? `Ref ${paymentReference}` : '',
          notes || 'No optional note'
        ].filter(Boolean).join(' · ')
        : (notes || 'No notes');
      tr.innerHTML = `
        <td data-label="Schedule">
          <div class="collector-approval-copy">
            <strong>${escapeHtml(scheduleDate)}</strong>
            <span>${escapeHtml(preferredTime || 'Any time')}</span>
          </div>
        </td>
        <td data-label="Client">
          <div class="collector-approval-copy">
            <strong title="${escapeHtml(customerName)}">${escapeHtml(customerName)}</strong>
            <span title="${escapeHtml(accountMeta)}">${escapeHtml(accountMeta)}</span>
            <span class="collector-reschedule-compact-meta" title="${escapeHtml(notes)}">${escapeHtml([collectorName, result || 'Collection follow-up'].filter(Boolean).join(' - '))}</span>
          </div>
        </td>
        <td data-label="Collector">
          <div class="collector-approval-copy">
            <strong title="${escapeHtml(collectorName)}">${escapeHtml(collectorName)}</strong>
            <span>${escapeHtml(formatCollectorPaymentDate(record?.createdAt))}</span>
          </div>
        </td>
        <td data-label="Follow-up details">
          <div class="collector-approval-copy collector-reschedule-details">
            <strong title="${escapeHtml(detailTitle)}">${escapeHtml(detailTitle)}</strong>
            <span title="${escapeHtml(detailText)}">${escapeHtml(detailText)}</span>
          </div>
        </td>
        <td data-label="Status"><div class="collector-reschedule-status">${partialPayment ? '<span class="badge bg-warning-lt text-warning">Partial</span>' : ''}<span class="badge ${active ? 'bg-primary-lt text-primary' : 'bg-secondary-lt text-secondary'}">${escapeHtml(statusLabel)}</span>${urgencyBadge}</div></td>
        <td class="text-center" data-label="Actions">${actions}</td>
      `;
      collectorRescheduleList.appendChild(tr);
    });
  }

  function renderCollectorRescheduleNotice(message, tone = 'danger') {
    collectorRescheduleRecords = [];
    populateCollectorRescheduleFilter();
    if (!collectorRescheduleList) return;
    const className = tone === 'muted' ? 'text-secondary' : 'text-danger';
    collectorRescheduleList.innerHTML = `<tr class="collector-reschedule-notice"><td colspan="6" class="text-center ${className} py-3">${escapeHtml(message)}</td></tr>`;
    if (collectorRescheduleCount) collectorRescheduleCount.textContent = 'Unavailable';
    if (collectorRescheduleOverdueCount) collectorRescheduleOverdueCount.textContent = '0';
    if (collectorRescheduleTodayCount) collectorRescheduleTodayCount.textContent = '0';
    if (collectorRescheduleUpcomingCount) collectorRescheduleUpcomingCount.textContent = '0';
    if (collectorReschedulePagination) collectorReschedulePagination.hidden = true;
    if (collectorStatsReschedules) collectorStatsReschedules.textContent = '—';
    if (collectorReschedulesEmptyState) collectorReschedulesEmptyState.style.display = 'none';
  }

  async function loadCollectorReschedules({ preserveOnError = false } = {}) {
    if (!collectorRescheduleList) return false;
    if (collectorRescheduleRefresh) collectorRescheduleRefresh.disabled = true;
    try {
      const response = await fetch('/api/collector/payments/reschedules?status=all&limit=1000', {
        credentials: 'include',
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        const error = new Error(payload?.error || payload?.message || 'Failed to load rescheduled clients.');
        error.status = response.status;
        throw error;
      }
      collectorRescheduleRecords = Array.isArray(payload?.records) ? payload.records : [];
      populateCollectorRescheduleFilter();
      renderCollectorReschedules();
      return true;
    } catch (error) {
      console.warn('Failed to load collector reschedules', error);
      const status = Number(error?.status || 0);
      if (!shouldPreserveCollectorDataOnError(preserveOnError, status)) {
        const tone = [401, 403, 404].includes(status) ? 'muted' : 'danger';
        renderCollectorRescheduleNotice(error?.message || 'Failed to load rescheduled clients.', tone);
      }
      return false;
    } finally {
      if (collectorRescheduleRefresh) collectorRescheduleRefresh.disabled = false;
    }
  }

  function collectorScheduleToday() {
    const now = new Date();
    const local = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 10);
  }

  function setCollectorScheduleMessage(message = '', tone = 'info') {
    if (!collectorScheduleMessage) return;
    const colors = {
      info: 'var(--app-muted, #64748b)',
      success: 'var(--tblr-success, #2fb344)',
      danger: 'var(--tblr-danger, #d63939)'
    };
    collectorScheduleMessage.style.color = colors[tone] || colors.info;
    collectorScheduleMessage.textContent = message;
  }

  function findCollectorScheduleCustomer(accountNumber = '') {
    const wanted = String(accountNumber || '').trim();
    return clientReviewCustomers.find((customer) => getClientAccountNumber(customer) === wanted) || null;
  }

  function assignedCollectorIdsForArea(area = '') {
    const wanted = normalizeAreaKey(area);
    const match = Object.entries(normalizeAssignments(assignmentsByArea || {}))
      .find(([name]) => normalizeAreaKey(name) === wanted);
    return match ? match[1].map((id) => String(id || '').trim()).filter(Boolean) : [];
  }

  function populateCollectorScheduleCustomers(selectedAccountNumber = '', fallbackRecord = null) {
    if (!collectorScheduleCustomer) return;
    const selected = String(selectedAccountNumber || '').trim();
    const byAccount = new Map();
    clientReviewCustomers.forEach((customer) => {
      const accountNumber = getClientAccountNumber(customer);
      if (accountNumber) byAccount.set(accountNumber, customer);
    });
    collectorScheduleCustomer.innerHTML = '<option value="">Select client</option>';
    [...byAccount.entries()]
      .sort((left, right) => getClientDisplayName(left[1]).localeCompare(getClientDisplayName(right[1]), undefined, { sensitivity: 'base', numeric: true }))
      .forEach(([accountNumber, customer]) => {
        const option = document.createElement('option');
        const area = getClientArea(customer);
        option.value = accountNumber;
        option.textContent = `${getClientDisplayName(customer)} (#${accountNumber})${area ? ` - ${area}` : ''}`;
        collectorScheduleCustomer.appendChild(option);
      });
    if (selected && !byAccount.has(selected) && fallbackRecord) {
      const option = document.createElement('option');
      option.value = selected;
      option.textContent = `${fallbackRecord.customerName || 'Client'} (#${selected})${fallbackRecord.area ? ` - ${fallbackRecord.area}` : ''}`;
      collectorScheduleCustomer.appendChild(option);
    }
    collectorScheduleCustomer.value = selected;
  }

  function populateCollectorScheduleCollectors(selectedCollectorId = '', fallbackRecord = null) {
    if (!collectorScheduleCollector) return;
    const selected = String(selectedCollectorId || '').trim();
    const customer = findCollectorScheduleCustomer(collectorScheduleCustomer?.value);
    const area = getClientArea(customer) || String(fallbackRecord?.area || '').trim();
    const assignedIds = new Set(assignedCollectorIdsForArea(area));
    const candidates = getDisplayCollectors().filter((account) => assignedIds.has(getCollectorId(account)));
    collectorScheduleCollector.innerHTML = '<option value="">Select collector</option>';
    candidates.forEach((account) => {
      const id = getCollectorId(account);
      const option = document.createElement('option');
      option.value = id;
      option.textContent = getCollectorName(id);
      collectorScheduleCollector.appendChild(option);
    });
    if (selected && !candidates.some((account) => getCollectorId(account) === selected) && fallbackRecord) {
      const option = document.createElement('option');
      option.value = selected;
      option.textContent = getCollectorRescheduleName(fallbackRecord);
      collectorScheduleCollector.appendChild(option);
    }
    collectorScheduleCollector.value = selected;
    collectorScheduleCollector.disabled = Boolean(collectorScheduleRecordId?.value) || !candidates.length;
    if (!collectorScheduleRecordId?.value && !candidates.length && area) {
      setCollectorScheduleMessage('Assign a collector to this client area before creating the schedule.', 'danger');
    } else if (!collectorScheduleRecordId?.value) {
      setCollectorScheduleMessage('');
    }
  }

  function renderCollectorSchedulePaymentDetails(record = null) {
    const partialPayment = isPartialPaymentCollectorReschedule(record || {});
    if (collectorSchedulePaymentDetails) collectorSchedulePaymentDetails.hidden = !partialPayment;
    if (!partialPayment || !record) return;
    if (collectorSchedulePaymentReference) {
      collectorSchedulePaymentReference.textContent = String(record.paymentReference || record.paymentEntryId || 'Not available');
    }
    if (collectorScheduleAmountPaid) collectorScheduleAmountPaid.textContent = `PHP ${fmtMoney(record.amountPaid)}`;
    if (collectorScheduleRemainingBalance) collectorScheduleRemainingBalance.textContent = `PHP ${fmtMoney(record.remainingBalance)}`;
    if (collectorSchedulePaymentStatus) collectorSchedulePaymentStatus.textContent = collectorSchedulePaymentStatusLabel(record);
    if (collectorScheduleAuditSummary) {
      const creator = String(record.createdByName || record.collectorName || 'Collector app').trim();
      const createdAt = formatCollectorPaymentDate(record.createdAt);
      const updatedBy = String(record.updatedByName || '').trim();
      const updatedAt = updatedBy ? formatCollectorPaymentDate(record.updatedAt) : '';
      collectorScheduleAuditSummary.textContent = [
        `${creator} · ${createdAt}`,
        updatedBy ? `Last edited by ${updatedBy}${updatedAt ? ` · ${updatedAt}` : ''}` : ''
      ].filter(Boolean).join(' · ');
    }
  }

  async function openCollectorScheduleModal(record = null, options = {}) {
    if (!collectorScheduleModal || !collectorScheduleForm) return;
    collectorScheduleForm.reset();
    const editing = Boolean(record?.id);
    const partialPayment = isPartialPaymentCollectorReschedule(record || {});
    collectorScheduleViewMode = Boolean(options.viewOnly && editing);
    if (collectorScheduleRecordId) collectorScheduleRecordId.value = editing ? String(record.id) : '';
    if (collectorScheduleModalTitle) {
      collectorScheduleModalTitle.textContent = collectorScheduleViewMode
        ? 'Follow-up Details'
        : editing
          ? (partialPayment ? 'Edit Partial-Payment Follow-up' : 'Edit Collector Schedule')
          : 'Create Collector Schedule';
    }
    if (collectorScheduleModalSubtitle) {
      collectorScheduleModalSubtitle.textContent = collectorScheduleViewMode
        ? 'Review the schedule, linked payment snapshot, and latest audit information.'
        : editing
          ? 'Changes appear on the assigned collector device after the next Sync.'
        : 'Assign a client follow-up that will appear after the collector taps Sync in Android.';
    }
    if (collectorScheduleDate) collectorScheduleDate.value = editing ? String(record.rescheduledDate || '').slice(0, 10) : collectorScheduleToday();
    if (collectorScheduleTime) collectorScheduleTime.value = editing ? String(record.preferredTime || '') : '';
    if (collectorScheduleResult) collectorScheduleResult.value = editing ? String(record.result || '') : 'Collection follow-up';
    if (collectorScheduleNotes) {
      collectorScheduleNotes.value = editing
        ? String(partialPayment ? (record.collectorNote ?? record.notes ?? '') : (record.notes || ''))
        : '';
      collectorScheduleNotes.required = !partialPayment && !collectorScheduleViewMode;
      collectorScheduleNotes.disabled = collectorScheduleViewMode;
      collectorScheduleNotes.placeholder = partialPayment
        ? 'Optional note from the collector or Admin'
        : 'Add the information the collector needs for this visit.';
    }
    if (collectorScheduleNotesLabel) collectorScheduleNotesLabel.textContent = partialPayment ? 'Optional note' : 'Instructions or notes';
    if (collectorScheduleNotesHint) {
      collectorScheduleNotesHint.textContent = partialPayment
        ? 'Optional. Admin changes synchronize to the Collector app.'
        : 'Required for Admin-created collection schedules.';
    }
    if (collectorScheduleResultLabel) collectorScheduleResultLabel.textContent = partialPayment ? 'Follow-up type' : 'Follow-up reason';
    if (collectorScheduleDate) collectorScheduleDate.disabled = collectorScheduleViewMode;
    if (collectorScheduleTime) {
      collectorScheduleTime.disabled = collectorScheduleViewMode;
      collectorScheduleTime.required = partialPayment && !collectorScheduleViewMode;
    }
    if (collectorScheduleResult) collectorScheduleResult.disabled = collectorScheduleViewMode || partialPayment;
    if (collectorScheduleSave) collectorScheduleSave.hidden = collectorScheduleViewMode;
    if (collectorScheduleCancelLabel) collectorScheduleCancelLabel.textContent = collectorScheduleViewMode ? 'Close' : 'Cancel';
    renderCollectorSchedulePaymentDetails(record);
    if (collectorScheduleCustomer) collectorScheduleCustomer.disabled = true;
    if (collectorScheduleCollector) collectorScheduleCollector.disabled = true;
    setCollectorScheduleMessage(collectorScheduleViewMode ? '' : 'Loading clients and assignments...');
    collectorScheduleModal.classList.add('show');
    collectorScheduleModal.setAttribute('aria-hidden', 'false');

    try {
      await Promise.all([
        loadClientReviewCustomers(),
        collectorAccountsCache.length ? Promise.resolve() : loadCollectors(null)
      ]);
      const accountNumber = editing ? String(record.accountNumber || '').trim() : '';
      populateCollectorScheduleCustomers(accountNumber, record);
      if (collectorScheduleCustomer) collectorScheduleCustomer.disabled = editing || collectorScheduleViewMode;
      populateCollectorScheduleCollectors(editing ? String(record.collectorId || '').trim() : '', record);
      if (editing && collectorScheduleCollector) collectorScheduleCollector.disabled = true;
      if (!editing && !collectorScheduleViewMode) setCollectorScheduleMessage('Select a client to see collectors assigned to its area.');
      setTimeout(() => {
        if (collectorScheduleViewMode) closeCollectorScheduleModal?.focus();
        else if (editing) collectorScheduleDate?.focus();
        else collectorScheduleCustomer?.focus();
      }, 50);
    } catch (error) {
      setCollectorScheduleMessage(error?.message || 'Unable to load clients and collectors.', 'danger');
    }
  }

  function closeCollectorScheduleEditor() {
    if (!collectorScheduleModal) return;
    collectorScheduleModal.classList.remove('show');
    collectorScheduleModal.setAttribute('aria-hidden', 'true');
    collectorScheduleViewMode = false;
    if (collectorScheduleSave) collectorScheduleSave.hidden = false;
    if (collectorScheduleCancelLabel) collectorScheduleCancelLabel.textContent = 'Cancel';
    if (collectorSchedulePaymentDetails) collectorSchedulePaymentDetails.hidden = true;
    setCollectorScheduleMessage('');
  }

  async function saveCollectorSchedule() {
    if (collectorScheduleViewMode) return;
    if (!collectorScheduleForm?.reportValidity()) return;
    const recordId = String(collectorScheduleRecordId?.value || '').trim();
    const existingRecord = collectorRescheduleRecords.find((record) => String(record?.id || '').trim() === recordId) || null;
    const partialPayment = isPartialPaymentCollectorReschedule(existingRecord || {});
    const payload = {
      accountNumber: String(collectorScheduleCustomer?.value || '').trim(),
      collectorId: String(collectorScheduleCollector?.value || '').trim(),
      rescheduledDate: String(collectorScheduleDate?.value || '').trim(),
      preferredTime: String(collectorScheduleTime?.value || '').trim(),
      result: partialPayment ? 'Partial payment' : String(collectorScheduleResult?.value || '').trim(),
      notes: String(collectorScheduleNotes?.value || '').trim(),
      ...(partialPayment ? {
        followUpType: 'partial_payment',
        collectorNote: String(collectorScheduleNotes?.value || '').trim()
      } : {})
    };
    if (!payload.collectorId) {
      setCollectorScheduleMessage('Select a collector assigned to this client area.', 'danger');
      return;
    }
    if (collectorScheduleSave) collectorScheduleSave.disabled = true;
    setCollectorScheduleMessage(recordId ? 'Updating schedule...' : 'Creating schedule...');
    try {
      const response = await fetch(recordId
        ? `/api/collector/payments/reschedules/${encodeURIComponent(recordId)}`
        : '/api/collector/payments/reschedules', {
        method: recordId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        throw new Error(result?.error || result?.message || 'Failed to save collector schedule.');
      }
      closeCollectorScheduleEditor();
      await loadCollectorReschedules();
      toast(recordId ? 'Collector schedule updated.' : 'Collector schedule created.', 'ok');
    } catch (error) {
      setCollectorScheduleMessage(error?.message || 'Failed to save collector schedule.', 'danger');
    } finally {
      if (collectorScheduleSave) collectorScheduleSave.disabled = false;
    }
  }

  async function deleteCollectorSchedule(record, triggerButton = null) {
    if (!record?.id) return;
    const clientName = String(record.customerName || record.accountNumber || 'this client').trim();
    const confirmed = window.appConfirm
      ? await window.appConfirm(`Delete the active schedule for ${clientName}? The collector will receive the removal after the next Sync.`, {
        title: 'Delete Collector Schedule',
        okText: 'Delete Schedule',
        type: 'danger'
      })
      : window.confirm(`Delete the active schedule for ${clientName}?`);
    if (!confirmed) return;
    if (triggerButton) triggerButton.disabled = true;
    try {
      const response = await fetch(`/api/collector/payments/reschedules/${encodeURIComponent(record.id)}`, {
        method: 'DELETE',
        credentials: 'include',
        cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        throw new Error(result?.error || result?.message || 'Failed to delete collector schedule.');
      }
      await loadCollectorReschedules();
      toast('Collector schedule deleted.', 'ok');
    } catch (error) {
      toast(error?.message || 'Failed to delete collector schedule.', 'danger');
      if (triggerButton) triggerButton.disabled = false;
    }
  }

  async function approveCollectorPaymentsBatch(triggerBtn = null, collectorKey = '') {
    const normalizedCollectorKey = String(collectorKey || '').trim();
    const rows = collectorApprovalRecords
      .filter((record) => String(record?.id || '').trim())
      .filter((record) => !normalizedCollectorKey || getCollectorApprovalGroupKey(record) === normalizedCollectorKey);
    if (!rows.length) {
      toast('No customer payments await approval.', 'danger');
      return;
    }
    const collectorName = getCollectorApprovalGroupName(rows[0]);
    const confirmed = window.appConfirm
      ? await window.appConfirm(buildCollectorApprovalBatchMessage(rows), {
        title: `Approve ${collectorName}`,
        okText: 'Approve Collector',
        type: 'success'
      })
      : window.confirm(buildCollectorApprovalBatchMessage(rows));
    if (!confirmed) return;
    if (triggerBtn) triggerBtn.disabled = true;
    try {
      const res = await fetch('/api/collector/payments/approvals/approve-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ entryIds: rows.map((record) => String(record.id).trim()) }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload?.error || 'Failed to approve customer payments.');
      }
      const approvedCount = Number(payload?.approved || (Array.isArray(payload?.records) ? payload.records.length : 0));
      const skippedCount = Number(payload?.skipped || 0);
      const skippedText = skippedCount ? ` ${skippedCount} skipped.` : '';
      toast(
        approvedCount
          ? `Approved ${approvedCount} pending payment${approvedCount === 1 ? '' : 's'} for ${collectorName}.${skippedText}`
          : 'No customer payments were approved.',
        approvedCount ? 'ok' : 'danger'
      );
      await Promise.all([
        loadCollectorApprovals(),
        loadCollectorRemittances(),
        loadAssignmentsAndReport(),
      ]);
    } catch (err) {
      toast(err?.message || 'Failed to approve customer payments.', 'danger');
      if (triggerBtn) triggerBtn.disabled = false;
    }
  }

  async function approveSelectedCollectorPayments(triggerBtn = null) {
    const rows = collectorApprovalRecords.filter((record) => {
      const id = String(record?.id || '').trim();
      return id && collectorApprovalSelectedIds.has(id);
    });
    if (!rows.length) {
      collectorApprovalSelectedIds.clear();
      updateCollectorApprovalSelectionState();
      toast('Select at least one pending payment.', 'danger');
      return;
    }
    const total = rows.reduce((sum, record) => sum + Math.abs(Number(record?.amount) || 0), 0);
    const visibleRows = rows.slice(0, 10).map(formatCollectorApprovalBatchLine);
    const remaining = rows.length - visibleRows.length;
    const message = [
      `Approve ${rows.length} selected pending payment${rows.length === 1 ? '' : 's'}?`,
      '',
      'Paid Client - Amount - Reference',
      ...visibleRows,
      ...(remaining > 0 ? [`+${remaining} more payment${remaining === 1 ? '' : 's'}`] : []),
      '',
      `Total: PHP ${fmtMoney(total)}`,
    ].join('\n');
    const confirmed = window.appConfirm
      ? await window.appConfirm(message, {
        title: 'Approve Selected Payments',
        okText: 'Approve Selected',
        type: 'success',
      })
      : window.confirm(message);
    if (!confirmed) return;
    if (triggerBtn) triggerBtn.disabled = true;
    try {
      const res = await fetch('/api/collector/payments/approvals/approve-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ entryIds: rows.map((record) => String(record.id).trim()) }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload?.error || 'Failed to approve selected collector payments.');
      }
      const approvedCount = Number(payload?.approved || (Array.isArray(payload?.records) ? payload.records.length : 0));
      const skippedCount = Number(payload?.skipped || 0);
      collectorApprovalSelectedIds.clear();
      updateCollectorApprovalSelectionState();
      toast(
        approvedCount
          ? `Approved ${approvedCount} selected payment${approvedCount === 1 ? '' : 's'}.${skippedCount ? ` ${skippedCount} skipped.` : ''}`
          : 'No selected collector payments were approved.',
        approvedCount ? 'ok' : 'danger'
      );
      await Promise.all([
        loadCollectorApprovals(),
        loadCollectorRemittances(),
        loadAssignmentsAndReport(),
      ]);
    } catch (err) {
      toast(err?.message || 'Failed to approve selected collector payments.', 'danger');
      if (triggerBtn) triggerBtn.disabled = false;
    }
  }

  function setCollectorPaymentRejectMessage(message = '', tone = '') {
    if (!collectorPaymentRejectMessage) return;
    collectorPaymentRejectMessage.textContent = message;
    collectorPaymentRejectMessage.className = `modal-message${tone ? ` text-${tone}` : ''}`;
  }

  function openCollectorPaymentRejectDialog(entryId, triggerBtn = null) {
    const safeEntryId = String(entryId || '').trim();
    if (!safeEntryId || !collectorPaymentRejectModal || !collectorPaymentRejectForm) return;
    const record = collectorApprovalRecords.find((item) => String(item?.id || '').trim() === safeEntryId);
    collectorPaymentRejectForm.reset();
    if (collectorPaymentRejectEntryId) collectorPaymentRejectEntryId.value = safeEntryId;
    if (collectorPaymentRejectSummary) {
      const clientName = String(record?.customerName || record?.accountNumber || 'Client').trim();
      const reference = String(record?.reference || 'No reference').trim();
      collectorPaymentRejectSummary.textContent = `${clientName} · PHP ${fmtMoney(record?.amount)} · ${reference}`;
    }
    collectorPaymentRejectTrigger = triggerBtn;
    setCollectorPaymentRejectMessage('');
    collectorPaymentRejectModal.classList.add('show');
    collectorPaymentRejectModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => collectorPaymentRejectReason?.focus(), 50);
  }

  function closeCollectorPaymentRejectDialog() {
    if (!collectorPaymentRejectModal) return;
    collectorPaymentRejectModal.classList.remove('show');
    collectorPaymentRejectModal.setAttribute('aria-hidden', 'true');
    collectorPaymentRejectForm?.reset();
    if (collectorPaymentRejectEntryId) collectorPaymentRejectEntryId.value = '';
    if (collectorPaymentRejectSubmit) collectorPaymentRejectSubmit.disabled = false;
    setCollectorPaymentRejectMessage('');
    collectorPaymentRejectTrigger?.focus?.();
    collectorPaymentRejectTrigger = null;
  }

  async function submitCollectorPaymentDecision(entryId, action, options = {}) {
    const safeEntryId = String(entryId || '').trim();
    const safeAction = String(action || '').trim().toLowerCase();
    const triggerBtn = options.triggerBtn || null;
    if (!safeEntryId || !['approve', 'reject'].includes(safeAction)) return false;
    if (triggerBtn) triggerBtn.disabled = true;
    try {
      const res = await fetch(`/api/collector/payments/approvals/${encodeURIComponent(safeEntryId)}/${safeAction}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify(safeAction === 'reject' ? { reason: String(options.reason || '').trim() } : {}),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload?.error || `Failed to ${safeAction} collector payment.`);
      }
      toast(safeAction === 'approve' ? 'Collector payment approved.' : 'Collector payment rejected.', 'ok');
      await Promise.all([
        loadCollectorApprovals(),
        loadCollectorRemittances(),
        loadAssignmentsAndReport(),
      ]);
      return true;
    } catch (err) {
      if (safeAction === 'reject' && collectorPaymentRejectModal?.classList.contains('show')) {
        setCollectorPaymentRejectMessage(err?.message || 'Failed to reject collector payment.', 'danger');
      } else {
        toast(err?.message || `Failed to ${safeAction} collector payment.`, 'danger');
      }
      if (triggerBtn) triggerBtn.disabled = false;
      return false;
    }
  }

  async function reviewCollectorPayment(entryId, action, triggerBtn = null) {
    const safeEntryId = String(entryId || '').trim();
    const safeAction = String(action || '').trim().toLowerCase();
    if (!safeEntryId || !['approve', 'reject'].includes(safeAction)) return;
    if (safeAction === 'reject') {
      openCollectorPaymentRejectDialog(safeEntryId, triggerBtn);
      return;
    }
    const confirmed = window.appConfirm
      ? await window.appConfirm('Approve this collector payment and post it to the official billing record?', {
        title: 'Approve Payment',
        okText: 'Approve Payment',
        type: 'success'
      })
      : window.confirm('Approve this collector payment and post it to the official billing record?');
    if (!confirmed) return;
    await submitCollectorPaymentDecision(safeEntryId, 'approve', { triggerBtn });
  }

  function hasAccountRole(account, role) {
    const wanted = String(role || '').trim().toLowerCase();
    const values = Array.isArray(account?.roles)
      ? account.roles
      : String(account?.role || '').split(/[,/|;]+|\s+\+\s+|\s+and\s+/i);
    return values.some((value) => String(value || '').trim().toLowerCase() === wanted);
  }

  function isCollectorRole(account) {
    return hasAccountRole(account, 'collector');
  }

  function filterCollectorAccounts(list) {
    return (list || []).filter(isCollectorRole);
  }

  function isPrepaidRecord(record) {
    const explicit = String(record?.planCategory || record?.planType || '').trim().toLowerCase();
    if (explicit === 'prepaid') return true;
    if (explicit === 'postpaid') return false;
    const billing = String(record?.planBilling || '').trim().toLowerCase();
    if (billing.includes('prepaid')) return true;
    if (billing.includes('postpaid')) return false;
    return false;
  }

  function isReportableCollectorPaymentEntry(entry = {}) {
    const status = String(entry?.status || entry?.paymentStatus || '').trim().toLowerCase();
    return ![
      'pending_approval',
      'pending-approval',
      'pending approval',
      'rejected',
      'cancelled',
      'canceled',
      'void',
      'voided',
    ].includes(status);
  }

  // Simple toast
  function toast(msg, type = 'ok') {
    if (!assignMessage) return;
    const variant = type === 'ok' ? 'success' : 'danger';
    assignMessage.innerHTML = `<div class="toast ${variant} show">${msg}</div>`;
    setTimeout(() => (assignMessage.innerHTML = ''), 3200);
  }

  function setModalMessage(text, type = 'info') {
    if (!assignmentModalMessage) return;
    const map = {
      info: '#475569',
      success: '#16a34a',
      danger: '#dc2626',
    };
    assignmentModalMessage.style.color = map[type] || map.info;
    assignmentModalMessage.textContent = text || '';
  }

  // Build counts of areas per collector from assignmentsByArea
  function buildAreaCounts() {
    const counts = {};
    Object.values(assignmentsByArea || {}).forEach((value) => {
      const ids = Array.isArray(value) ? value : [value];
      ids.forEach((collectorId) => {
        const key = String(collectorId);
        if (!key) return;
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    return counts;
  }

  function normalizeAssignments(assignments = {}) {
    const normalized = {};
    Object.entries(assignments || {}).forEach(([area, value]) => {
      const ids = (Array.isArray(value) ? value : [value]).map((id) => String(id || '').trim()).filter(Boolean);
      normalized[area] = [...new Set(ids)];
    });
    return normalized;
  }

  function getCollectorsForArea(area) {
    return normalizeAssignments(assignmentsByArea)[area] || [];
  }

  function getSelectedModalAreas() {
    return Array.from(modalSelectedAreas).filter(Boolean);
  }

  function getAreaAssignmentInfo(area) {
    const collectorIds = getCollectorsForArea(area);
    return {
      collectorIds,
      collectorNames: collectorIds.map(getCollectorName).filter(Boolean),
    };
  }

  function getVisibleAssignmentAreas() {
    const collectorId = String(modalCollectorSelect?.value || '').trim();
    const query = String(assignmentAreaSearch?.value || '').trim().toLowerCase();
    return availableAreas.filter((area) => {
      const areaText = String(area || '');
      const assignedIds = getCollectorsForArea(area);
      const isSelected = modalSelectedAreas.has(area);
      const isAssigned = assignedIds.length > 0;
      const matchesSearch = !query || areaText.toLowerCase().includes(query);
      if (!matchesSearch) return false;
      if (activeAssignmentFilter === 'selected') return isSelected;
      if (activeAssignmentFilter === 'unassigned') return !isAssigned;
      if (activeAssignmentFilter === 'assigned') return isAssigned;
      return true;
    }).sort((left, right) => {
      const leftSelected = modalSelectedAreas.has(left) ? 0 : 1;
      const rightSelected = modalSelectedAreas.has(right) ? 0 : 1;
      if (collectorId && leftSelected !== rightSelected) return leftSelected - rightSelected;
      return String(left).localeCompare(String(right), undefined, { sensitivity: 'base', numeric: true });
    });
  }

  function syncModalSelectedAreasWithCollector() {
    const collectorId = String(modalCollectorSelect?.value || '').trim();
    modalSelectedAreas = collectorId
      ? new Set(
          Object.entries(normalizeAssignments(assignmentsByArea))
            .filter(([, ids]) => ids.includes(collectorId))
            .map(([area]) => area)
        )
      : new Set();
  }

  function updateAreaCount() {
    const count = getSelectedModalAreas().length;
    if (assignmentAreaCount) assignmentAreaCount.textContent = `${count} selected`;
    if (assignmentSaveBtn) {
      assignmentSaveBtn.innerHTML = `<i class="ti ti-device-floppy"></i> Save ${count} assignment${count === 1 ? '' : 's'}`;
      assignmentSaveBtn.disabled = !String(modalCollectorSelect?.value || '').trim();
    }
    if (assignmentClearSelectedBtn) assignmentClearSelectedBtn.disabled = count === 0;
  }

  function syncAssignmentFilterTabs() {
    assignmentFilterTabs?.querySelectorAll('[data-assignment-filter]').forEach((button) => {
      const isActive = button.dataset.assignmentFilter === activeAssignmentFilter;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function renderAreaChecklist() {
    if (!assignmentAreaList) return;
    const collectorId = String(modalCollectorSelect?.value || '').trim();
    const visibleAreas = getVisibleAssignmentAreas();
    assignmentAreaList.innerHTML = visibleAreas.length
      ? visibleAreas.map((area) => {
          const { collectorIds, collectorNames } = getAreaAssignmentInfo(area);
          const checked = modalSelectedAreas.has(area);
          const assignedToCurrent = collectorId && collectorIds.includes(collectorId);
          const assignedCopy = collectorNames.length ? collectorNames.join(', ') : 'Unassigned';
          const assignedChips = collectorNames.length
            ? collectorNames.map((name) => `<span class="badge bg-secondary-lt text-secondary">${escapeHtml(name)}</span>`).join('')
            : '<span class="badge bg-secondary-lt text-secondary is-empty">No collector assigned</span>';
          return `
            <label class="list-group-item assignment-area-option${checked ? ' is-selected' : ''}${assignedToCurrent ? ' is-current' : ''}">
              <span class="form-check">
                <input class="form-check-input" type="checkbox" value="${escapeHtml(area)}" ${checked ? 'checked' : ''} ${collectorId ? '' : 'disabled'}>
                <span class="form-check-label assignment-area-option__body">
                  <span class="assignment-area-option__title">${escapeHtml(area)}</span>
                  <span class="assignment-area-option__meta">Assigned:</span>
                  <span class="assignment-area-option__assignees" title="${escapeHtml(assignedCopy)}">${assignedChips}</span>
                </span>
              </span>
            </label>
          `;
        }).join('')
      : '<p class="assignment-area-empty">No areas match this filter.</p>';
    if (assignmentSelectAllVisibleBtn) {
      assignmentSelectAllVisibleBtn.disabled = !collectorId || visibleAreas.length === 0;
    }
    updateAreaCount();
    renderAssignmentClientReview();
  }

  function buildCollectorTotals(reportCache) {
    const totals = {};
    const cache = reportCache || loadReport.lastReport || {};
    Object.keys(cache).forEach((collectorId) => {
      const months = cache[collectorId] || {};
      let total = 0;
      Object.values(months).forEach((amount) => {
        total += Number(amount || 0);
      });
      totals[collectorId] = total;
    });
    return totals;
  }

  async function ensureAreaStats(areaNames, monthKey) {
    // reset cache if month changes
    if (ensureAreaStats.currentMonth && ensureAreaStats.currentMonth !== monthKey) {
      areaTotalsCache = {};
    }
    ensureAreaStats.currentMonth = monthKey;
    const requestedAreas = Array.isArray(areaNames) ? areaNames : [];
    const missingTotals = requestedAreas.some((area) => areaTotalsCache[area] === undefined);
    const missingUnpaid = requestedAreas.some((area) => areaUnpaidCache[area] === undefined);
    if (!missingTotals && !missingUnpaid) {
      return { totals: areaTotalsCache, unpaid: areaUnpaidCache };
    }
    if (!areaStatsPromise) {
      areaStatsPromise = calculateAreaStatsFromRecords(monthKey)
        .then(({ totals, unpaid }) => {
          areaTotalsCache = { ...areaTotalsCache, ...totals };
          areaUnpaidCache = { ...areaUnpaidCache, ...unpaid };
          return { totals: areaTotalsCache, unpaid: areaUnpaidCache };
        })
        .catch((err) => {
          console.warn('Failed to compute area stats fallback', err);
          return { totals: areaTotalsCache, unpaid: areaUnpaidCache };
        })
        .finally(() => {
          areaStatsPromise = null;
        });
    }
    await areaStatsPromise;
    requestedAreas.forEach((area) => {
      if (areaTotalsCache[area] === undefined) areaTotalsCache[area] = 0;
      if (areaUnpaidCache[area] === undefined) areaUnpaidCache[area] = 0;
    });
    return { totals: areaTotalsCache, unpaid: areaUnpaidCache };
  }

  async function calculateAreaStatsFromRecords(monthKey) {
    try {
      const res = await fetch('/api/payment-records', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch payment records');
      const payload = await res.json();
      const records = Array.isArray(payload.records) ? payload.records : [];
      const totals = {};
      const unpaid = {};
      records.forEach((record) => {
        if (isPrepaidRecord(record)) return;
        if (record?.complimentaryAccount?.active === true || record?.billingSummary?.complimentaryAccount?.active === true) return;
        const area = String(record?.area || '').trim();
        if (!area) return;
        const balance = Math.max(Number(record?.balance) || 0, 0);
        unpaid[area] = (unpaid[area] || 0) + balance;
        const assignedIds = getCollectorsForArea(area);
        (record.history || []).forEach((entry) => {
          if (!isReportableCollectorPaymentEntry(entry)) return;
          const direction = String(entry.direction || '').toLowerCase();
          if (direction !== 'credit') return;
          const recordedCollectorId = String(entry?.recordedBy?.id || '').trim();
          if (assignedIds.length && !assignedIds.includes(recordedCollectorId)) return;
          const date = entry.date || entry.recordedAt;
          if (!date) return;
          const d = new Date(date);
          if (Number.isNaN(d.getTime())) return;
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (monthKey && key !== monthKey) return;
          totals[area] = (totals[area] || 0) + Number(entry.amount || 0);
        });
      });
      return { totals, unpaid };
    } catch (err) {
      console.warn('Unable to build area stats from records', err);
      return { totals: {}, unpaid: {} };
    }
  }

  function renderCollectorAreasModalBody(collectorId) {
    if (!collectorAreasModalBody) return;
    const safeCollectorId = String(collectorId || '').trim();
    const collectorAreaMap = buildCollectorAreaMap();
    const areas = collectorAreaMap[safeCollectorId] || [];
    const monthKey = loadReport.currentMonthKey || getCurrentMonthKey();
    const monthLabel = formatMonthLabel(monthKey);
    const currentTotal = getCollectorMonthTotal(safeCollectorId, areas, monthKey);

    if (collectorAreasModalTitle) {
      collectorAreasModalTitle.textContent = getCollectorName(safeCollectorId);
    }
    if (collectorAreasModalSubtitle) {
      collectorAreasModalSubtitle.textContent = `${areaCountLabel(areas.length)} - ${monthLabel} - PHP ${fmtMoney(currentTotal)} collected`;
    }
    if (collectorAreasEditBtn) {
      collectorAreasEditBtn.setAttribute('data-collector-id', safeCollectorId);
    }

    collectorAreasModalBody.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'collector-area-breakdown collector-area-breakdown--modal';

    const head = document.createElement('div');
    head.className = 'collector-area-breakdown__head';

    const title = document.createElement('strong');
    title.textContent = 'Assigned areas';

    const meta = document.createElement('span');
    meta.textContent = `${areaCountLabel(areas.length)} - ${monthLabel}`;
    head.append(title, meta);
    wrap.appendChild(head);

    if (!areas.length) {
      const empty = document.createElement('p');
      empty.className = 'collector-area-empty';
      empty.textContent = 'No assigned areas yet.';
      wrap.appendChild(empty);
    } else {
      const table = document.createElement('table');
      table.className = 'table table-vcenter table-sm collector-area-table';

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      ['Area', 'Current Month Collected', 'Action'].forEach((label) => {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      areas.forEach((area) => {
        const areaRow = document.createElement('tr');

        const areaCell = document.createElement('td');
        areaCell.textContent = area;

        const amountCell = document.createElement('td');
        amountCell.className = 'collector-area-amount';
        amountCell.textContent = `PHP ${fmtMoney(getCollectorAreaAmount(collectorId, area, monthKey))}`;

        const actionCell = document.createElement('td');
        actionCell.className = 'collector-area-actions';
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-icon btn-sm btn-outline-danger';
        removeBtn.innerHTML = '<i class="ti ti-trash"></i>';
        removeBtn.title = `Remove ${area}`;
        removeBtn.setAttribute('data-assign-action', 'delete');
        removeBtn.setAttribute('data-area', area);
        removeBtn.setAttribute('data-collector-id', collectorId);
        actionCell.appendChild(removeBtn);

        areaRow.append(areaCell, amountCell, actionCell);
        tbody.appendChild(areaRow);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
    }

    collectorAreasModalBody.appendChild(wrap);
  }

  function openCollectorAreasModal(collectorId) {
    if (!collectorAreasModal) return;
    activeCollectorAreasId = String(collectorId || '').trim();
    renderCollectorAreasModalBody(activeCollectorAreasId);
    collectorAreasModal.classList.add('show');
    collectorAreasModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      closeCollectorAreasModalBtn?.focus();
    }, 50);
  }

  function closeCollectorAreasModal() {
    if (!collectorAreasModal) return;
    collectorAreasModal.classList.remove('show');
    collectorAreasModal.setAttribute('aria-hidden', 'true');
    activeCollectorAreasId = '';
  }

  async function renderAssignments() {
    if (!assignmentList) return;
    assignmentList.innerHTML = '';

    const allCollectors = getDisplayCollectors();
    const collectorAreaMap = buildCollectorAreaMap();
    const monthKey = loadReport.currentMonthKey || getCurrentMonthKey();
    let searchQuery = String(assignmentSearch?.value || '').trim().toLowerCase();

    if (assignmentSearchWrap) assignmentSearchWrap.hidden = allCollectors.length <= 5;
    if (allCollectors.length <= 5 && searchQuery && assignmentSearch) {
      assignmentSearch.value = '';
      searchQuery = '';
    }
    if (assignmentSearchClear) assignmentSearchClear.hidden = !searchQuery;

    const collectors = searchQuery
      ? allCollectors.filter((collector) => {
          const collectorId = getCollectorId(collector);
          const searchText = [
            collectorId,
            getCollectorName(collectorId),
            ...(collectorAreaMap[collectorId] || [])
          ].join(' ').toLowerCase();
          return searchText.includes(searchQuery);
        })
      : allCollectors;

    const overallTotals = allCollectors.reduce((totals, collector) => {
      const collectorId = getCollectorId(collector);
      const areas = collectorAreaMap[collectorId] || [];
      totals.areas += areas.length;
      totals.collected += getCollectorMonthTotal(collectorId, areas, monthKey);
      return totals;
    }, { areas: 0, collected: 0 });
    updateAssignmentSummaryStats(allCollectors.length, overallTotals.areas, overallTotals.collected);

    if (!allCollectors.length) {
      if (assignmentsEmptyState) {
        assignmentsEmptyState.style.display = 'flex';
        const emptyCopy = assignmentsEmptyState.querySelector('p');
        if (emptyCopy) emptyCopy.textContent = 'No collector accounts yet.';
      }
      if (assignmentCount) assignmentCount.textContent = '0 collectors';
      return;
    }

    if (!collectors.length) {
      if (assignmentsEmptyState) {
        assignmentsEmptyState.style.display = 'flex';
        const emptyCopy = assignmentsEmptyState.querySelector('p');
        if (emptyCopy) emptyCopy.textContent = 'No collectors match this search.';
      }
      if (assignmentCount) assignmentCount.textContent = `0 of ${allCollectors.length}`;
      return;
    }

    if (assignmentsEmptyState) assignmentsEmptyState.style.display = 'none';

    collectors.forEach((collector, index) => {
      const collectorId = getCollectorId(collector);
      if (!collectorId) return;
      const areas = collectorAreaMap[collectorId] || [];
      const currentTotal = getCollectorMonthTotal(collectorId, areas, monthKey);
      const collectorName = getCollectorName(collectorId);
      const visibleAreas = areas.slice(0, 3);
      const remainingAreaCount = Math.max(0, areas.length - visibleAreas.length);
      const areaBadges = areas.length
        ? `${visibleAreas.map((area) => `<span class="badge bg-primary-lt text-primary">${escapeHtml(area)}</span>`).join('')}${remainingAreaCount ? `<span class="badge bg-secondary-lt text-secondary">+${remainingAreaCount} more</span>` : ''}`
        : '<span class="badge bg-warning-lt text-warning"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Unassigned</span>';

      const card = document.createElement('article');
      card.className = `collector-assignment-item${areas.length ? '' : ' is-unassigned'}`;
      card.setAttribute('role', 'listitem');
      card.innerHTML = `
        <div class="collector-assignment-item__header">
          <div class="collector-assignment-identity">
            <span class="avatar avatar-sm bg-primary-lt text-primary collector-avatar collector-avatar--tone-${(index % 4) + 1}" aria-hidden="true">${escapeHtml(getCollectorInitials(collectorId))}</span>
            <span class="collector-assignment-identity__copy">
              <strong>${escapeHtml(collectorName)}</strong>
              <small>ID ${escapeHtml(collectorId)}</small>
            </span>
          </div>
          <button class="btn btn-icon btn-sm btn-ghost-secondary" type="button" data-assign-action="edit-collector" data-collector-id="${escapeHtml(collectorId)}" title="Edit ${escapeHtml(collectorName)}" aria-label="Edit ${escapeHtml(collectorName)}">
            <i class="ti ti-edit" aria-hidden="true"></i>
          </button>
        </div>
        <div class="collector-assignment-metrics">
          <div class="collector-assignment-metric">
            <span>Assigned Areas</span>
            <strong>${escapeHtml(areaCountLabel(areas.length))}</strong>
          </div>
          <div class="collector-assignment-metric">
            <span>Collected This Month</span>
            <strong class="${currentTotal ? 'text-success' : 'text-secondary'}">PHP ${escapeHtml(fmtMoney(currentTotal))}</strong>
          </div>
        </div>
        <div class="collector-assignment-areas" aria-label="Assigned areas">${areaBadges}</div>
        <button class="btn btn-outline-primary btn-sm w-100 collector-assignment-view" type="button" data-assign-action="view-collector-areas" data-collector-id="${escapeHtml(collectorId)}" aria-haspopup="dialog">
          <i class="ti ti-eye" aria-hidden="true"></i>
          <span>View Details</span>
        </button>
      `;
      assignmentList.appendChild(card);
    });

    if (assignmentCount) {
      assignmentCount.textContent = searchQuery
        ? `${collectors.length} of ${allCollectors.length}`
        : (collectors.length === 1 ? '1 collector' : `${collectors.length} collectors`);
    }
  }

  function formatMonthLabel(key) {
    if (!key) return 'No data';
    const parts = key.split('-').map(Number);
    if (parts.length < 2) return key;
    const [y, m] = parts;
    return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'short', year: 'numeric' });
  }

  function renderMonthlySummary(report) {
    if (!monthlySummary) return;
    monthlySummary.innerHTML = '';

    const entries = Object.entries(report || {});
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-copy';
      empty.textContent = 'No collection data yet.';
      monthlySummary.appendChild(empty);
      return;
    }

    const areaCounts = buildAreaCounts();
    const dataset = entries
      .map(([collectorId, months]) => {
        const orderedMonths = Object.keys(months || {}).sort();
        const latestMonth = orderedMonths[orderedMonths.length - 1] || null;
        let total = 0;
        Object.values(months || {}).forEach((val) => {
          total += Number(val || 0);
        });
        return {
          collectorId,
          total,
          latestMonth,
          areaCount: areaCounts[String(collectorId)] || 0,
        };
      })
      .sort((a, b) => b.total - a.total);

    const highlight = dataset[0];
    if (highlight) {
      const highlightBlock = document.createElement('div');
      highlightBlock.className = 'monthly-highlight';
      const pill = document.createElement('p');
      pill.className = 'pill';
      pill.textContent = 'Pinaka-aktibong collector';
      const title = document.createElement('h4');
      title.textContent = getCollectorName(highlight.collectorId);
      const amount = document.createElement('p');
      amount.className = 'highlight-amount';
      amount.textContent = `PHP ${fmtMoney(highlight.total)}`;
      const caption = document.createElement('p');
      caption.className = 'highlight-caption';
      const areaText =
        highlight.areaCount > 0
          ? ` - ${highlight.areaCount === 1 ? '1 area' : `${highlight.areaCount} areas`}`
          : '';
      caption.textContent = `Total collected${areaText}`;
      highlightBlock.append(pill, title, amount, caption);
      monthlySummary.appendChild(highlightBlock);
    }

    const list = document.createElement('ul');
    list.className = 'monthly-list';
    dataset.forEach((entry) => {
      const li = document.createElement('li');
      const left = document.createElement('div');
      const name = document.createElement('span');
      name.className = 'collector-name';
      name.textContent = getCollectorName(entry.collectorId);
      const monthLabel = document.createElement('span');
      monthLabel.className = 'month-label';
      monthLabel.textContent = entry.latestMonth
        ? `Latest month: ${formatMonthLabel(entry.latestMonth)}`
        : 'No month data';
      const areaLabel = document.createElement('span');
      areaLabel.className = 'month-label';
      areaLabel.textContent = entry.areaCount
        ? `${entry.areaCount === 1 ? '1 area' : `${entry.areaCount} areas`} assigned`
        : 'No assigned areas';
      left.append(name, monthLabel, areaLabel);

      const amount = document.createElement('strong');
      amount.className = 'monthly-amount';
      amount.textContent = `PHP ${fmtMoney(entry.total)}`;
      li.append(left, amount);
      list.appendChild(li);
    });
    monthlySummary.appendChild(list);
  }

  function renderReportTable(report) {
    if (!reportContainer) return;
    const entries = Object.entries(report || {});
    if (!entries.length) {
      reportContainer.innerHTML = '<p class="empty-copy">No collection data yet.</p>';
      return;
    }

    const monthSet = new Set();
    entries.forEach(([, months]) => {
      Object.keys(months || {}).forEach((month) => monthSet.add(month));
    });
    const monthList = Array.from(monthSet).sort();

    const table = document.createElement('table');
    table.className = 'report-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const collectorHead = document.createElement('th');
    collectorHead.textContent = 'Collector';
    headerRow.appendChild(collectorHead);
    monthList.forEach((month) => {
      const th = document.createElement('th');
      th.textContent = month;
      headerRow.appendChild(th);
    });
    const totalHead = document.createElement('th');
    totalHead.textContent = 'Total';
    headerRow.appendChild(totalHead);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    entries.forEach(([collectorId, months]) => {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = getCollectorName(collectorId);
      row.appendChild(nameCell);
      let total = 0;
      monthList.forEach((month) => {
        const value = Number((months || {})[month] || 0);
        total += value;
        const cell = document.createElement('td');
        cell.textContent = fmtMoney(value);
        row.appendChild(cell);
      });
      const totalCell = document.createElement('td');
      totalCell.textContent = fmtMoney(total);
      row.appendChild(totalCell);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    reportContainer.innerHTML = '';
    reportContainer.appendChild(table);
  }

  async function fetchCollectorAccounts() {
    try {
      const res = await fetch('/api/accounts', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return [];
      const payload = await res.json();
      if (Array.isArray(payload?.accounts)) return payload.accounts;
      if (Array.isArray(payload)) return payload;
      return [];
    } catch {
      return [];
    }
  }

  async function fetchCoverageAreas() {
    try {
      const res = await fetch('/api/coverage', { cache: 'no-store', credentials: 'include' });
      if (!res.ok) return [];
      const data = await res.json();
      return (Array.isArray(data) ? data : []).map((area) => area?.name || area?.areaName || area?.area || area?.label).filter(Boolean);
    } catch {
      return [];
    }
  }

  async function loadAreas() {
    let areaNames = await fetchCoverageAreas();
    if (!areaNames.length) {
      const res = await fetch('/api/collectors/areas', { credentials: 'include', cache: 'no-store' });
      if (res.ok) {
        const payload = await res.json();
        const fallback = Array.isArray(payload) ? payload : payload.areas || [];
        areaNames = fallback;
      }
    }
    availableAreas = Array.from(new Set((areaNames || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    renderAreaChecklist();
  }

  async function loadCollectors(targetSelect = modalCollectorSelect) {
    const res = await fetch('/api/collectors', { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load collectors');
    const payload = await res.json();
    const inlineAccounts = filterCollectorAccounts(payload.accounts || []);
    const settingsAccounts = filterCollectorAccounts(await fetchCollectorAccounts());

    const normalizedInline = inlineAccounts
      .map((acc) => ({ ...acc, _id: storeAccount(acc) }))
      .filter((acc) => acc._id);

    const normalizedSettings = settingsAccounts
      .map((acc) => ({ ...acc, _id: storeAccount(acc) }))
      .filter((acc) => acc._id);

    assignmentsByArea = normalizeAssignments(
      (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.assignments) || {}
    );
    areaTotalsCache = {};
    areaUnpaidCache = {};
    if (targetSelect) {
      targetSelect.innerHTML = '';
    }

    const collectorAccounts = normalizedSettings.length ? normalizedSettings : normalizedInline;
    collectorAccountsCache = collectorAccounts
      .map((acc) => ({ ...acc, _id: getCollectorId(acc) }))
      .filter((acc) => acc._id);
    populateCollectorRescheduleFilter();

    if (targetSelect) {
      if (!collectorAccountsCache.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Add a collector role account first';
        targetSelect.appendChild(opt);
        targetSelect.disabled = true;
      } else {
        targetSelect.disabled = false;
        collectorAccountsCache.forEach((acc) => {
          const opt = document.createElement('option');
          opt.value = acc._id;
          const role = acc.role || 'Collector';
          const label = acc.name || acc.username || acc.accountId || acc._id;
          opt.textContent = `${label} (${role})`;
          targetSelect.appendChild(opt);
        });
      }
    }
    renderAssignments().catch(() => {});
  }

  async function loadReport({ showLoading = true } = {}) {
    if (showLoading && reportContainer) reportContainer.textContent = 'Loading...';
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;

    const response = await fetch('/api/collectors/report', { credentials: 'include', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Failed to load report');
    const report = data.report || {};
    loadReport.currentMonthKey = monthKey;
    loadReport.lastReport = report;
    collectorAreaReportCache = data.collectorAreaReport || {};
    areaReportCache = data.areaReport || {};
    const accountsMap = data.accountsMap || {};

    rememberAccountsMap(accountsMap);

    const totals = Object.entries(report)
      .map(([collectorId, months]) => {
        const total = Number((months && months[monthKey]) || 0);
        const collectorName = (accountsMap && accountsMap[collectorId] && (accountsMap[collectorId].name || accountsMap[collectorId].username)) || getCollectorName(collectorId);
        const areasAssigned = Object.values(normalizeAssignments(assignmentsByArea || {}))
          .filter((ids) => ids.includes(String(collectorId))).length;
        return { collectorId, collectorName, total, areasAssigned };
      })
      .filter((r) => r.total > 0);

    if (reportContainer) {
    if (!totals.length) {
      reportContainer.innerHTML = `<p class="empty-copy">No collections recorded this month.</p>`;
    } else {
      const totalAll = totals.reduce((s, r) => s + (r.total || 0), 0);
      reportContainer.innerHTML = `
        <div class="table-responsive collector-report-table-wrapper">
          <table class="table table-vcenter table-sm collectors-table collector-report-table">
            <thead>
              <tr>
                <th class="text-center" style="width:80px">ID</th>
                <th>Collector</th>
                <th>Area</th>
                <th class="text-center" style="width:160px">Total Collected</th>
              </tr>
            </thead>
            <tbody>
              ${totals
                .map((r, i) => `
                <tr>
                  <td class="text-center">${i + 1}</td>
                  <td>${r.collectorName}</td>
                  <td>${r.areasAssigned ? r.areasAssigned + ' area(s)' : '—'}</td>
                  <td class="text-center">PHP ${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r.total)}</td>
                </tr>
              `)
                .join('')}
              <tr>
                <td></td>
                <td class="fw-semibold">Total</td>
                <td></td>
                <td class="fw-semibold text-center">PHP ${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalAll)}</td>
              </tr>
            </tbody>
          </table>
          <div class="card-footer assignment-footer">
            <div class="footer-summary">Showing ${totals.length} assignments</div>
          </div>
        </div>
      `;
    }
    }

    if (monthlySummary && !totals.length) {
      monthlySummary.innerHTML = `<p class="empty-copy">Waiting for the report.</p>`;
      renderAssignments().catch(() => {});
      return;
    }
    if (!monthlySummary) {
      renderAssignments().catch(() => {});
      return;
    }
    const sorted = [...totals].sort((a, b) => (b.total || 0) - (a.total || 0));
    const top = sorted[0];
    const sum = sorted.reduce((s, r) => s + (r.total || 0), 0);
    const monthLabel = new Date(year, month - 1, 1).toLocaleString(undefined, { month: 'short', year: 'numeric' });

    monthlySummary.innerHTML = `
      <div class="monthly-highlight">
        <p class="pill">Total Collections (${monthLabel})</p>
        <h4>PHP ${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(sum)}</h4>
        <p class="highlight-caption">Top: <strong>${top.collectorName}</strong> (PHP ${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(top.total)})</p>
      </div>
      <ul class="monthly-list">
        ${sorted
          .map(
            (r) => `
          <li>
            <div>
              <span class="collector-name">${r.collectorName}</span>
              <span class="month-label">${monthLabel}</span>
            </div>
            <span class="monthly-amount">PHP ${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r.total)}</span>
          </li>
        `
          )
          .join('')}
      </ul>
    `;
    renderAssignments().catch(() => {});
  }

  async function requestUnassign(area, collectorId = '') {
    const suffix = collectorId ? `?collectorId=${encodeURIComponent(collectorId)}` : '';
    const attempts = [
      {
        url: `/api/collectors/assign/${encodeURIComponent(area)}${suffix}`,
        options: { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'include', cache: 'no-store' },
      },
      {
        url: '/api/collectors/assign',
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          cache: 'no-store',
          body: JSON.stringify({ area, collectorId: null }),
        },
      },
    ];
    let lastError;
    for (const attempt of attempts) {
      try {
        const res = await fetch(attempt.url, attempt.options);
        const payload = await res.json().catch(() => ({}));
        if (res.ok) return payload;
        lastError = payload?.error || 'Failed to remove assignment';
      } catch (err) {
        lastError = err.message;
      }
    }
    throw new Error(lastError || 'Failed to remove assignment');
  }

  async function removeAssignment(area, collectorId, triggerBtn) {
    if (!area) return;
    const confirmed = window.appConfirm
      ? await window.appConfirm(`Remove ${area} from ${getCollectorName(collectorId)}?`, { title: 'Remove Assignment' })
      : window.confirm(`Remove ${area} from ${getCollectorName(collectorId)}?`);
    if (!confirmed) return;
    if (triggerBtn) triggerBtn.disabled = true;
    if (assignMessage) assignMessage.textContent = 'Removing assignment...';
    try {
      const payload = await requestUnassign(area, collectorId);
      assignmentsByArea = normalizeAssignments(payload.assignments || assignmentsByArea);
      if (assignMessage) assignMessage.textContent = payload.message || 'Assignment removed.';
      await loadAssignmentsAndReport();
      if (activeCollectorAreasId) {
        renderCollectorAreasModalBody(activeCollectorAreasId);
      }
    } catch (err) {
      if (assignMessage) assignMessage.textContent = err.message || 'Failed to remove assignment';
      if (triggerBtn) triggerBtn.disabled = false;
    }
  }

  async function loadAssignmentsAndReport({ showLoading = true } = {}) {
    try {
      await loadCollectors();
      await loadReport({ showLoading });
      return true;
    } catch (err) {
      console.warn('Failed to refresh collectors/report', err);
      return false;
    }
  }

  function formatCollectorAutoRefreshTime(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
    return value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function setCollectorAutoRefreshStatus(message) {
    const label = collectorAutoRefreshStatus?.querySelector('span');
    if (label) label.textContent = message;
  }

  function collectorAutoRefreshPauseReason() {
    if (document.hidden) return 'page is in the background';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    if (document.querySelector('.modal.show, dialog[open], [role="dialog"][aria-hidden="false"]')) {
      return 'dialog is open';
    }
    if (collectorApprovalSelectedIds.size) return 'payment selection in progress';
    const activeElement = document.activeElement;
    if (activeElement && activeElement !== document.body
        && activeElement.matches?.('input, select, textarea, [contenteditable="true"]')
        && (Date.now() - collectorLastFieldInteractionAt) < 5000) {
      return 'editing in progress';
    }
    const refreshButtons = [
      collectorApprovalRefresh,
      collectorRemittanceRefresh,
      collectorPriorityRefresh,
      collectorRescheduleRefresh
    ].filter(Boolean);
    if (refreshButtons.some((button) => button.disabled)) return 'refresh already in progress';
    return '';
  }

  function markCollectorWorkspaceUpdated({ partial = false } = {}) {
    collectorAutoRefreshLastUpdatedAt = new Date();
    const time = formatCollectorAutoRefreshTime(collectorAutoRefreshLastUpdatedAt);
    const transport = collectorLiveConnected ? 'live updates connected' : '30-second fallback active';
    setCollectorAutoRefreshStatus(`${partial ? 'Partly updated' : 'Updated'} ${time} · ${transport}`);
  }

  async function refreshCollectorSections(topics, { automatic = false, fallback = false } = {}) {
    if (collectorAutoRefreshInFlight) return false;
    if (automatic) {
      const pauseReason = collectorAutoRefreshPauseReason();
      if (pauseReason) {
        const lastUpdated = formatCollectorAutoRefreshTime(collectorAutoRefreshLastUpdatedAt);
        const mode = fallback ? 'Fallback refresh' : 'Live update';
        setCollectorAutoRefreshStatus(`${mode} waiting: ${pauseReason}${lastUpdated ? ` · last updated ${lastUpdated}` : ''}`);
        return false;
      }
    }

    const requestedTopics = [...new Set((Array.isArray(topics) ? topics : [topics])
      .map((topic) => String(topic || '').trim().toLowerCase())
      .filter((topic) => COLLECTOR_LIVE_TOPICS.has(topic)))];
    if (!requestedTopics.length) return false;

    const loaders = {
      approvals: () => loadCollectorApprovals({ preserveOnError: automatic }),
      remittances: () => loadCollectorRemittances({ preserveOnError: automatic }),
      priorities: () => loadCollectorPriorities({ preserveOnError: automatic }),
      reschedules: () => loadCollectorReschedules({ preserveOnError: automatic }),
      assignments: () => loadAssignmentsAndReport({ showLoading: !automatic })
    };
    const labels = {
      approvals: 'payment approvals',
      remittances: 'remittances',
      priorities: 'priority clients',
      reschedules: 'reschedules',
      assignments: 'assignments and totals'
    };

    collectorAutoRefreshInFlight = true;
    setCollectorAutoRefreshStatus(fallback
      ? 'Live connection unavailable · checking all sections…'
      : `${automatic ? 'Live updating' : 'Refreshing'} ${requestedTopics.map((topic) => labels[topic]).join(', ')}…`);
    try {
      const results = await Promise.all(requestedTopics.map((topic) => loaders[topic]()));
      const succeeded = results.filter(Boolean).length;
      if (succeeded) {
        markCollectorWorkspaceUpdated({ partial: succeeded < results.length });
        return true;
      }
      const lastUpdated = formatCollectorAutoRefreshTime(collectorAutoRefreshLastUpdatedAt);
      setCollectorAutoRefreshStatus(`Refresh unavailable · keeping current data${lastUpdated ? ` · last updated ${lastUpdated}` : ''}`);
      return false;
    } finally {
      collectorAutoRefreshInFlight = false;
    }
  }

  async function refreshCollectorWorkspace({ automatic = false, fallback = false } = {}) {
    return refreshCollectorSections([...COLLECTOR_LIVE_TOPICS], { automatic, fallback });
  }

  async function runCollectorManualRefresh(loader) {
    setCollectorAutoRefreshStatus('Refreshing section…');
    try {
      const updated = await loader();
      if (updated) {
        markCollectorWorkspaceUpdated();
      } else {
        const lastUpdated = formatCollectorAutoRefreshTime(collectorAutoRefreshLastUpdatedAt);
        setCollectorAutoRefreshStatus(`Refresh unavailable${lastUpdated ? ` · last updated ${lastUpdated}` : ''}`);
      }
      return updated;
    } catch (error) {
      const lastUpdated = formatCollectorAutoRefreshTime(collectorAutoRefreshLastUpdatedAt);
      setCollectorAutoRefreshStatus(`Refresh unavailable${lastUpdated ? ` · last updated ${lastUpdated}` : ''}`);
      throw error;
    }
  }

  function stopCollectorFallbackRefresh() {
    if (collectorAutoRefreshTimer === null) return;
    window.clearInterval(collectorAutoRefreshTimer);
    collectorAutoRefreshTimer = null;
  }

  function startCollectorFallbackRefresh() {
    if (collectorAutoRefreshTimer !== null) return;
    collectorAutoRefreshTimer = window.setInterval(() => {
      if (collectorLiveConnected) return;
      refreshCollectorWorkspace({ automatic: true, fallback: true }).catch((error) => {
        console.warn('Failed to run Collector live-update fallback', error);
      });
    }, COLLECTOR_FALLBACK_REFRESH_INTERVAL_MS);
  }

  function scheduleCollectorLiveFlush(delay = COLLECTOR_LIVE_UPDATE_DEBOUNCE_MS) {
    if (collectorLiveFlushTimer !== null) window.clearTimeout(collectorLiveFlushTimer);
    collectorLiveFlushTimer = window.setTimeout(() => {
      collectorLiveFlushTimer = null;
      flushCollectorLiveUpdates().catch((error) => {
        console.warn('Failed to apply Collector live update', error);
      });
    }, delay);
  }

  function queueCollectorLiveTopics(topics) {
    (Array.isArray(topics) ? topics : [topics]).forEach((topic) => {
      const normalized = String(topic || '').trim().toLowerCase();
      if (COLLECTOR_LIVE_TOPICS.has(normalized)) collectorLivePendingTopics.add(normalized);
    });
    if (collectorLivePendingTopics.size) scheduleCollectorLiveFlush();
  }

  async function flushCollectorLiveUpdates() {
    if (!collectorLivePendingTopics.size) return false;
    const pauseReason = collectorAutoRefreshPauseReason();
    if (collectorAutoRefreshInFlight || pauseReason) {
      const reason = pauseReason || 'another update is in progress';
      setCollectorAutoRefreshStatus(`Live update waiting: ${reason}`);
      if (!document.hidden && navigator.onLine !== false) scheduleCollectorLiveFlush(1000);
      return false;
    }

    const topics = [...collectorLivePendingTopics];
    collectorLivePendingTopics.clear();
    return refreshCollectorSections(topics, { automatic: true });
  }

  function closeCollectorLiveSource() {
    if (!collectorLiveEventSource) return;
    collectorLiveEventSource.close();
    collectorLiveEventSource = null;
    collectorLiveConnected = false;
  }

  function scheduleCollectorLiveReconnect() {
    if (collectorLiveReconnectTimer !== null || navigator.onLine === false) return;
    collectorLiveReconnectTimer = window.setTimeout(() => {
      collectorLiveReconnectTimer = null;
      connectCollectorLiveUpdates();
    }, COLLECTOR_LIVE_RECONNECT_INTERVAL_MS);
  }

  function connectCollectorLiveUpdates() {
    if (typeof window.EventSource !== 'function') {
      setCollectorAutoRefreshStatus('Live updates unsupported · 30-second fallback active');
      startCollectorFallbackRefresh();
      return;
    }
    if (navigator.onLine === false) {
      setCollectorAutoRefreshStatus('Offline · 30-second fallback waiting');
      startCollectorFallbackRefresh();
      return;
    }
    if (collectorLiveEventSource) return;
    if (collectorLiveReconnectTimer !== null) {
      window.clearTimeout(collectorLiveReconnectTimer);
      collectorLiveReconnectTimer = null;
    }

    const source = new window.EventSource('/api/collectors/events', { withCredentials: true });
    collectorLiveEventSource = source;
    setCollectorAutoRefreshStatus('Connecting live updates…');

    source.addEventListener('open', () => {
      if (collectorLiveEventSource !== source) return;
      collectorLiveConnected = true;
      stopCollectorFallbackRefresh();
      const lastUpdated = formatCollectorAutoRefreshTime(collectorAutoRefreshLastUpdatedAt);
      setCollectorAutoRefreshStatus(`Live updates connected${lastUpdated ? ` · last updated ${lastUpdated}` : ''}`);
    });

    source.addEventListener('collector-ready', (event) => {
      if (collectorLiveEventSource !== source) return;
      try {
        const payload = JSON.parse(event.data || '{}');
        const version = Number(payload.version);
        if (Number.isFinite(version)) {
          if (collectorLiveLastVersion !== null && version !== collectorLiveLastVersion) {
            queueCollectorLiveTopics([...COLLECTOR_LIVE_TOPICS]);
          }
          collectorLiveLastVersion = version;
        }
      } catch (_) {}
    });

    source.addEventListener('collector-update', (event) => {
      if (collectorLiveEventSource !== source) return;
      try {
        const payload = JSON.parse(event.data || '{}');
        const version = Number(payload.version);
        if (Number.isFinite(version)) collectorLiveLastVersion = version;
        queueCollectorLiveTopics(payload.topics || []);
      } catch (error) {
        console.warn('Ignored malformed Collector live update', error);
      }
    });

    source.addEventListener('error', () => {
      if (collectorLiveEventSource !== source) return;
      closeCollectorLiveSource();
      setCollectorAutoRefreshStatus('Live connection interrupted · 30-second fallback active');
      startCollectorFallbackRefresh();
      scheduleCollectorLiveReconnect();
    });
  }

  async function handleAssign() {
    const collectorId = modalCollectorSelect && modalCollectorSelect.value;
    const areas = getSelectedModalAreas();
    if (!collectorId) {
      setModalMessage('Select a collector.', 'danger');
      return;
    }
    setModalMessage('Saving assignments...', 'info');
    try {
      const res = await fetch('/api/collectors/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ areas, collectorId }),
      });
      if (!res.ok) throw new Error('Failed to assign');
      const payload = await res.json();
      assignmentsByArea = normalizeAssignments(payload.assignments || assignmentsByArea);
      const savedCount = areas.length;
      setModalMessage('Assignments saved!', 'success');
      toast(savedCount ? `${savedCount} assignment${savedCount === 1 ? '' : 's'} saved.` : 'Collector assignments cleared.', 'ok');
      closeAssignmentModal();
      await loadAssignmentsAndReport();
    } catch (err) {
      setModalMessage(err.message || 'Failed to assign', 'danger');
    }
  }

  function openAssignmentModal(preselectCollectorId = '') {
    if (!assignmentModal) return;
    const initialCollectorId =
      typeof preselectCollectorId === 'string' || typeof preselectCollectorId === 'number'
        ? String(preselectCollectorId).trim()
        : '';
    assignmentForm?.reset();
    if (assignmentAreaSearch) assignmentAreaSearch.value = '';
    modalSelectedAreas = new Set();
    activeAssignmentFilter = 'all';
    syncAssignmentFilterTabs();
    setModalMessage('');
    renderAssignmentClientReview();
    assignmentModal.classList.add('show');
    assignmentModal.setAttribute('aria-hidden', 'false');
    loadClientReviewCustomers().catch(() => {});
    loadCollectors()
      .then(() => {
        if (initialCollectorId && modalCollectorSelect) {
          modalCollectorSelect.value = initialCollectorId;
        }
        syncModalSelectedAreasWithCollector();
      })
      .then(() => loadAreas())
      .then(() => renderAreaChecklist())
      .catch(() => {});
    setTimeout(() => {
      modalCollectorSelect?.focus();
    }, 50);
  }

  function closeAssignmentModal() {
    if (!assignmentModal) return;
    assignmentModal.classList.remove('show');
    assignmentModal.setAttribute('aria-hidden', 'true');
    setModalMessage('');
  }

  newAssignmentBtn?.addEventListener('click', openAssignmentModal);
  closeAssignmentModalBtn?.addEventListener('click', closeAssignmentModal);
  cancelAssignmentModalBtn?.addEventListener('click', closeAssignmentModal);
  closeCollectorAreasModalBtn?.addEventListener('click', closeCollectorAreasModal);
  collectorAreasDoneBtn?.addEventListener('click', closeCollectorAreasModal);
  collectorAreasEditBtn?.addEventListener('click', () => {
    const collectorId = String(activeCollectorAreasId || collectorAreasEditBtn.getAttribute('data-collector-id') || '').trim();
    if (!collectorId) return;
    closeCollectorAreasModal();
    openAssignmentModal(collectorId);
  });
  modalCollectorSelect?.addEventListener('change', () => {
    syncModalSelectedAreasWithCollector();
    renderAreaChecklist();
  });
  assignmentAreaSearch?.addEventListener('input', renderAreaChecklist);
  assignmentFilterTabs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-assignment-filter]');
    if (!button) return;
    activeAssignmentFilter = button.dataset.assignmentFilter || 'all';
    syncAssignmentFilterTabs();
    renderAreaChecklist();
  });
  assignmentSelectAllVisibleBtn?.addEventListener('click', () => {
    if (!String(modalCollectorSelect?.value || '').trim()) {
      setModalMessage('Select a collector first.', 'danger');
      return;
    }
    getVisibleAssignmentAreas().forEach((area) => modalSelectedAreas.add(area));
    renderAreaChecklist();
  });
  assignmentClearSelectedBtn?.addEventListener('click', () => {
    modalSelectedAreas.clear();
    renderAreaChecklist();
  });
  assignmentAreaList?.addEventListener('change', (event) => {
    const input = event.target.closest('input[type="checkbox"]');
    if (!input) return;
    if (input.checked) modalSelectedAreas.add(input.value);
    else modalSelectedAreas.delete(input.value);
    renderAreaChecklist();
  });
  assignmentModal?.addEventListener('click', (e) => {
    if (e.target === assignmentModal) closeAssignmentModal();
  });
  collectorAreasModal?.addEventListener('click', (e) => {
    if (e.target === collectorAreasModal) closeCollectorAreasModal();
  });

  assignmentForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const unlock = window.withSubmitLock ? window.withSubmitLock(assignmentForm, { label: 'Saving...' }) : null;
    if (window.withSubmitLock && !unlock) return;
    handleAssign()
      .catch(() => {})
      .finally(() => {
        if (unlock) unlock();
      });
  });

  const resetCollectorApprovalPageAndRender = () => {
    collectorApprovalPage = 1;
    renderCollectorApprovals(collectorApprovalRecords);
  };
  collectorApprovalFiltersToggle?.addEventListener('click', () => {
    if (!collectorApprovalFiltersPanel) return;
    const willOpen = collectorApprovalFiltersPanel.hidden;
    collectorApprovalFiltersPanel.hidden = !willOpen;
    collectorApprovalFiltersToggle.setAttribute('aria-expanded', String(willOpen));
    collectorApprovalFiltersToggle.setAttribute('aria-label', willOpen ? 'Hide payment filters' : 'Show payment filters');
    collectorApprovalFiltersToggle.title = willOpen ? 'Hide payment filters' : 'Show payment filters';
    collectorApprovalFiltersToggle.querySelector('.ti')?.classList.toggle('ti-filter-off', willOpen);
    collectorApprovalFiltersToggle.querySelector('.ti')?.classList.toggle('ti-filter', !willOpen);
    if (willOpen) collectorApprovalSearch?.focus();
  });
  collectorApprovalSearch?.addEventListener('input', resetCollectorApprovalPageAndRender);
  collectorApprovalCollectorFilter?.addEventListener('change', resetCollectorApprovalPageAndRender);
  collectorApprovalDateFilter?.addEventListener('change', resetCollectorApprovalPageAndRender);
  collectorApprovalClearFilters?.addEventListener('click', () => {
    if (collectorApprovalSearch) collectorApprovalSearch.value = '';
    if (collectorApprovalCollectorFilter) collectorApprovalCollectorFilter.value = '';
    if (collectorApprovalDateFilter) collectorApprovalDateFilter.value = '';
    resetCollectorApprovalPageAndRender();
    collectorApprovalSearch?.focus();
  });
  collectorApprovalRefresh?.addEventListener('click', () => {
    collectorApprovalPage = 1;
    runCollectorManualRefresh(loadCollectorApprovals).catch(() => {});
  });
  collectorApprovalPreviousPage?.addEventListener('click', () => {
    if (collectorApprovalPage <= 1) return;
    collectorApprovalPage -= 1;
    renderCollectorApprovals(collectorApprovalRecords);
  });
  collectorApprovalNextPage?.addEventListener('click', () => {
    collectorApprovalPage += 1;
    renderCollectorApprovals(collectorApprovalRecords);
  });
  collectorApprovalApproveSelected?.addEventListener('click', () => {
    approveSelectedCollectorPayments(collectorApprovalApproveSelected).catch(() => {});
  });
  closeCollectorPaymentRejectModal?.addEventListener('click', closeCollectorPaymentRejectDialog);
  cancelCollectorPaymentRejectModal?.addEventListener('click', closeCollectorPaymentRejectDialog);
  collectorPaymentRejectForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!collectorPaymentRejectForm.reportValidity()) return;
    const entryId = String(collectorPaymentRejectEntryId?.value || '').trim();
    const reason = String(collectorPaymentRejectReason?.value || '').trim();
    if (!reason) {
      setCollectorPaymentRejectMessage('Rejection reason is required.', 'danger');
      collectorPaymentRejectReason?.focus();
      return;
    }
    const rejected = await submitCollectorPaymentDecision(entryId, 'reject', {
      reason,
      triggerBtn: collectorPaymentRejectSubmit
    });
    if (rejected) closeCollectorPaymentRejectDialog();
  });

  collectorRemittanceFilterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      collectorRemittanceFilter = button.getAttribute('data-collector-remittance-filter') || 'pending';
      renderCollectorRemittances();
    });
  });
  collectorRemittanceRefresh?.addEventListener('click', () => runCollectorManualRefresh(loadCollectorRemittances).catch(() => {}));
  closeCollectorRemittanceReviewModal?.addEventListener('click', closeCollectorRemittanceReviewDialog);
  cancelCollectorRemittanceReviewModal?.addEventListener('click', closeCollectorRemittanceReviewDialog);
  collectorRemittanceReviewForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!collectorRemittanceReviewForm.reportValidity()) return;
    submitCollectorRemittanceDecision().catch(() => {});
  });

  collectorPriorityHistoryToggle?.addEventListener('click', () => {
    collectorPriorityView = collectorPriorityView === 'history' ? 'active' : 'history';
    collectorPriorityPage = 1;
    renderCollectorPriorities();
  });
  collectorPriorityPreviousPage?.addEventListener('click', () => {
    if (collectorPriorityPage <= 1) return;
    collectorPriorityPage -= 1;
    renderCollectorPriorities();
  });
  collectorPriorityNextPage?.addEventListener('click', () => {
    collectorPriorityPage += 1;
    renderCollectorPriorities();
  });
  collectorPriorityRefresh?.addEventListener('click', () => runCollectorManualRefresh(loadCollectorPriorities).catch(() => {}));
  collectorPriorityCreate?.addEventListener('click', () => openCollectorPriorityModal().catch(() => {}));
  collectorPriorityCustomerSearch?.addEventListener('input', renderCollectorPriorityCustomerPicker);
  collectorPrioritySelectAllVisible?.addEventListener('click', () => {
    if (collectorPrioritySelectionLocked) return;
    visibleCollectorPriorityCustomers().forEach((customer) => {
      const accountNumber = getClientAccountNumber(customer);
      if (accountNumber) collectorPrioritySelectedAccounts.add(accountNumber);
    });
    renderCollectorPriorityCustomerPicker();
  });
  collectorPriorityClearSelected?.addEventListener('click', () => {
    if (collectorPrioritySelectionLocked) return;
    collectorPrioritySelectedAccounts.clear();
    renderCollectorPriorityCustomerPicker();
  });
  collectorPriorityCustomerList?.addEventListener('change', (event) => {
    const input = event.target.closest('[data-collector-priority-account]');
    if (!input || collectorPrioritySelectionLocked) return;
    const accountNumber = String(input.getAttribute('data-collector-priority-account') || '').trim();
    if (!accountNumber) return;
    if (input.checked) collectorPrioritySelectedAccounts.add(accountNumber);
    else collectorPrioritySelectedAccounts.delete(accountNumber);
    renderCollectorPriorityCustomerPicker();
  });
  closeCollectorPriorityModal?.addEventListener('click', closeCollectorPriorityEditor);
  cancelCollectorPriorityModal?.addEventListener('click', closeCollectorPriorityEditor);
  collectorPriorityForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveCollectorPriority().catch(() => {});
  });

  const resetCollectorReschedulePageAndRender = () => {
    collectorReschedulePage = 1;
    renderCollectorReschedules();
  };
  collectorRescheduleFiltersToggle?.addEventListener('click', () => {
    if (!collectorRescheduleFiltersPanel) return;
    collectorRescheduleFiltersPanel.hidden = !collectorRescheduleFiltersPanel.hidden;
    updateCollectorRescheduleFilterToggle();
    if (!collectorRescheduleFiltersPanel.hidden) collectorRescheduleSearch?.focus();
  });
  collectorRescheduleSearch?.addEventListener('input', resetCollectorReschedulePageAndRender);
  collectorRescheduleCollectorFilter?.addEventListener('change', resetCollectorReschedulePageAndRender);
  collectorRescheduleStatusFilter?.addEventListener('change', resetCollectorReschedulePageAndRender);
  collectorRescheduleDateFilter?.addEventListener('change', resetCollectorReschedulePageAndRender);
  collectorRescheduleClearFilters?.addEventListener('click', () => {
    if (collectorRescheduleSearch) collectorRescheduleSearch.value = '';
    if (collectorRescheduleCollectorFilter) collectorRescheduleCollectorFilter.value = '';
    if (collectorRescheduleStatusFilter) collectorRescheduleStatusFilter.value = 'active';
    if (collectorRescheduleDateFilter) collectorRescheduleDateFilter.value = '';
    resetCollectorReschedulePageAndRender();
    collectorRescheduleSearch?.focus();
  });
  collectorRescheduleRefresh?.addEventListener('click', () => {
    collectorReschedulePage = 1;
    runCollectorManualRefresh(loadCollectorReschedules).catch(() => {});
  });
  collectorReschedulePreviousPage?.addEventListener('click', () => {
    if (collectorReschedulePage <= 1) return;
    collectorReschedulePage -= 1;
    renderCollectorReschedules();
  });
  collectorRescheduleNextPage?.addEventListener('click', () => {
    collectorReschedulePage += 1;
    renderCollectorReschedules();
  });
  collectorRescheduleCreate?.addEventListener('click', () => openCollectorScheduleModal().catch(() => {}));
  assignmentSearch?.addEventListener('input', () => renderAssignments().catch(() => {}));
  assignmentSearchClear?.addEventListener('click', () => {
    if (!assignmentSearch) return;
    assignmentSearch.value = '';
    assignmentSearch.focus();
    renderAssignments().catch(() => {});
  });
  collectorScheduleCustomer?.addEventListener('change', () => populateCollectorScheduleCollectors());
  closeCollectorScheduleModal?.addEventListener('click', closeCollectorScheduleEditor);
  cancelCollectorScheduleModal?.addEventListener('click', closeCollectorScheduleEditor);
  collectorScheduleModal?.addEventListener('click', (event) => {
    if (event.target === collectorScheduleModal) closeCollectorScheduleEditor();
  });
  collectorScheduleForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveCollectorSchedule().catch(() => {});
  });

  document.addEventListener('click', (event) => {
    const remittanceActionButton = event.target.closest('[data-collector-remittance-action]');
    if (remittanceActionButton) {
      const remittanceId = remittanceActionButton.getAttribute('data-remittance-id') || '';
      const action = remittanceActionButton.getAttribute('data-collector-remittance-action') || '';
      const record = collectorRemittanceRecords.find((item) => String(item?.id || '') === remittanceId);
      if (record && ['confirm', 'reject'].includes(action)) {
        openCollectorRemittanceReview(record, action, remittanceActionButton);
      }
      return;
    }

    const priorityActionButton = event.target.closest('[data-collector-priority-action]');
    if (priorityActionButton) {
      const recordId = priorityActionButton.getAttribute('data-record-id') || '';
      const action = priorityActionButton.getAttribute('data-collector-priority-action') || '';
      const record = collectorPriorityRecords.find((item) => String(item?.id || '') === recordId);
      if (!record) return;
      if (action === 'view') {
        openCollectorPriorityModal(record, { viewOnly: true }).catch(() => {});
      } else if (action === 'edit') {
        openCollectorPriorityModal(record).catch(() => {});
      } else if (action === 'delete') {
        deleteCollectorPriority(record, priorityActionButton).catch(() => {});
      }
      return;
    }

    const scheduleActionButton = event.target.closest('[data-collector-reschedule-action]');
    if (scheduleActionButton) {
      const recordId = scheduleActionButton.getAttribute('data-record-id') || '';
      const action = scheduleActionButton.getAttribute('data-collector-reschedule-action') || '';
      const record = collectorRescheduleRecords.find((item) => String(item?.id || '') === recordId);
      if (!record) return;
      if (action === 'view') {
        openCollectorScheduleModal(record, { viewOnly: true }).catch(() => {});
      } else if (action === 'edit') {
        openCollectorScheduleModal(record).catch(() => {});
      } else if (action === 'delete') {
        deleteCollectorSchedule(record, scheduleActionButton).catch(() => {});
      }
      return;
    }

    const collectorApprovalToggle = event.target.closest('[data-collector-approval-toggle]');
    if (collectorApprovalToggle) {
      const collectorKey = collectorApprovalToggle.getAttribute('data-collector-approval-toggle') || '';
      if (collectorApprovalCollapsedGroups.has(collectorKey)) collectorApprovalCollapsedGroups.delete(collectorKey);
      else collectorApprovalCollapsedGroups.add(collectorKey);
      renderCollectorApprovals(collectorApprovalRecords);
      return;
    }

    const collectorApprovalBtn = event.target.closest('[data-collector-approval-collector-action]');
    if (collectorApprovalBtn) {
      const collectorKey = collectorApprovalBtn.getAttribute('data-collector-key') || '';
      approveCollectorPaymentsBatch(collectorApprovalBtn, collectorKey).catch(() => {});
      return;
    }

    const approvalBtn = event.target.closest('[data-collector-approval-action]');
    if (!approvalBtn) return;
    const entryId = approvalBtn.getAttribute('data-entry-id') || '';
    const action = approvalBtn.getAttribute('data-collector-approval-action') || '';
    reviewCollectorPayment(entryId, action, approvalBtn).catch(() => {});
  });

  document.addEventListener('change', (event) => {
    const selectionInput = event.target.closest('[data-collector-approval-select]');
    if (!selectionInput) return;
    const entryId = String(selectionInput.getAttribute('data-collector-approval-select') || '').trim();
    if (!entryId) return;
    if (selectionInput.checked) collectorApprovalSelectedIds.add(entryId);
    else collectorApprovalSelectedIds.delete(entryId);
    updateCollectorApprovalSelectionState();
  });

  // Delegate delete/remove actions similar to Plans page: confirm then remove
  document.addEventListener('click', (event) => {
    const actionBtn = event.target.closest('[data-assign-action]');
    if (!actionBtn) return;
    const action = actionBtn.getAttribute('data-assign-action');
    if (action === 'view-collector-areas') {
      const collectorId = actionBtn.getAttribute('data-collector-id') || '';
      openCollectorAreasModal(collectorId);
      return;
    }
    if (action === 'edit-collector') {
      const collectorId = actionBtn.getAttribute('data-collector-id') || '';
      openAssignmentModal(collectorId);
      return;
    }
    if (action === 'delete') {
      const area = actionBtn.getAttribute('data-area');
      const collectorId = actionBtn.getAttribute('data-collector-id') || '';
      if (!area) return;
      // call the same removeAssignment flow used elsewhere
      removeAssignment(area, collectorId, actionBtn).catch(() => {});
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && collectorLivePendingTopics.size) scheduleCollectorLiveFlush(0);
  });
  document.addEventListener('input', () => { collectorLastFieldInteractionAt = Date.now(); }, true);
  document.addEventListener('change', () => { collectorLastFieldInteractionAt = Date.now(); }, true);
  window.addEventListener('online', () => {
    connectCollectorLiveUpdates();
    if (collectorLivePendingTopics.size) scheduleCollectorLiveFlush(0);
  });
  window.addEventListener('offline', () => {
    closeCollectorLiveSource();
    if (collectorLiveReconnectTimer !== null) {
      window.clearTimeout(collectorLiveReconnectTimer);
      collectorLiveReconnectTimer = null;
    }
    setCollectorAutoRefreshStatus('Offline · live updates waiting');
    startCollectorFallbackRefresh();
  });
  window.addEventListener('beforeunload', () => {
    stopCollectorFallbackRefresh();
    closeCollectorLiveSource();
    if (collectorLiveReconnectTimer !== null) window.clearTimeout(collectorLiveReconnectTimer);
    if (collectorLiveFlushTimer !== null) window.clearTimeout(collectorLiveFlushTimer);
  });

  loadAreas().catch(() => {});
  refreshCollectorWorkspace()
    .catch(() => {
      if (monthlySummary) monthlySummary.innerHTML = '<p class="empty-copy">Could not load the report.</p>';
    })
    .finally(connectCollectorLiveUpdates);
})();
