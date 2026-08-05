// Collectors workspace sidebar + reporting logic
(function () {
  const assignMessage = document.getElementById('assignMessage');
  const reportContainer = document.getElementById('reportContainer');
  const collectorApprovalList = document.getElementById('collectorApprovalList');
  const collectorApprovalCount = document.getElementById('collectorApprovalCount');
  const collectorApprovalTotal = document.getElementById('collectorApprovalTotal');
  const collectorApprovalsEmptyState = document.getElementById('collectorApprovalsEmptyState');
  const collectorRescheduleList = document.getElementById('collectorRescheduleList');
  const collectorRescheduleCount = document.getElementById('collectorRescheduleCount');
  const collectorReschedulesEmptyState = document.getElementById('collectorReschedulesEmptyState');
  const collectorRescheduleCollectorFilter = document.getElementById('collectorRescheduleCollectorFilter');
  const collectorRescheduleStatusFilter = document.getElementById('collectorRescheduleStatusFilter');
  const collectorRescheduleRefresh = document.getElementById('collectorRescheduleRefresh');
  const collectorRescheduleCreate = document.getElementById('collectorRescheduleCreate');
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
  const collectorScheduleNotes = document.getElementById('collectorScheduleNotes');
  const collectorScheduleMessage = document.getElementById('collectorScheduleMessage');
  const collectorScheduleSave = document.getElementById('collectorScheduleSave');
  const closeCollectorScheduleModal = document.getElementById('closeCollectorScheduleModal');
  const cancelCollectorScheduleModal = document.getElementById('cancelCollectorScheduleModal');
  const assignmentList = document.getElementById('assignmentList');
  const assignmentCount = document.getElementById('assignmentCount');
  const monthlySummary = document.getElementById('monthlySummary');
  const assignmentsEmptyState = document.getElementById('assignmentsEmptyState');
  const assignmentsFooter = document.getElementById('assignmentsFooter');
  const assignmentsSummary = document.getElementById('assignmentsSummary');
  const collectorStatsCollectors = document.getElementById('collectorStatsCollectors');
  const collectorStatsAreas = document.getElementById('collectorStatsAreas');
  const collectorStatsCollected = document.getElementById('collectorStatsCollected');
  const assignmentsFooterCollected = document.getElementById('assignmentsFooterCollected');
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
  let collectorRescheduleRecords = [];
  let areaStatsPromise = null;
  let collectorAreaReportCache = {};
  let areaReportCache = {};
  let activeCollectorAreasId = '';

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
    if (assignmentsFooterCollected) assignmentsFooterCollected.textContent = `PHP ${fmtMoney(safeCollectedTotal)}`;
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
    const areaTotal = (areas || []).reduce((sum, area) => sum + getCollectorAreaAmount(collectorId, area, monthKey), 0);
    if (Object.keys(collectorAreaReportCache[String(collectorId)] || {}).length > 0) return areaTotal;
    const monthlyTotal = Number(loadReport.lastReport?.[String(collectorId)]?.[monthKey] || 0);
    return monthlyTotal || areaTotal || 0;
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

  async function loadClientReviewCustomers() {
    if (clientReviewLoaded) return clientReviewCustomers;
    if (clientReviewPromise) return clientReviewPromise;
    clientReviewLoading = true;
    clientReviewError = '';
    renderAssignmentClientReview();

    clientReviewPromise = fetch('/api/customers', { credentials: 'include', cache: 'no-store' })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || payload?.message || 'Unable to load clients for review.');
        }
        clientReviewCustomers = Array.isArray(payload?.customers)
          ? payload.customers
          : (Array.isArray(payload) ? payload : []);
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
    if (!collectorApprovalCount) return;
    collectorApprovalCount.textContent = count === 1 ? '1 pending' : `${count} pending`;
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

  function buildCollectorApprovalGroups(records = []) {
    const byKey = new Map();
    (Array.isArray(records) ? records : []).forEach((record) => {
      const key = getCollectorApprovalGroupKey(record);
      const existing = byKey.get(key) || {
        key,
        name: getCollectorApprovalGroupName(record),
        records: [],
        total: 0,
        latestTime: 0,
      };
      const time = new Date(record?.recordedAt || record?.date || '').getTime();
      existing.records.push(record);
      existing.total += Math.abs(Number(record?.amount) || 0);
      if (Number.isFinite(time)) existing.latestTime = Math.max(existing.latestTime, time);
      byKey.set(key, existing);
    });
    return [...byKey.values()].sort((left, right) => {
      if (right.latestTime !== left.latestTime) return right.latestTime - left.latestTime;
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
    if (!collectorApprovalList) return;
    collectorApprovalList.innerHTML = '';
    if (!rows.length) {
      if (collectorApprovalsEmptyState) collectorApprovalsEmptyState.style.display = 'flex';
      return;
    }
    if (collectorApprovalsEmptyState) collectorApprovalsEmptyState.style.display = 'none';
    buildCollectorApprovalGroups(rows).forEach((group) => {
      const groupRow = document.createElement('tr');
      groupRow.className = 'collector-approval-group-row';
      groupRow.innerHTML = `
        <td colspan="5">
          <div class="collector-approval-group">
            <div class="collector-approval-group__copy">
              <strong>${escapeHtml(group.name)}</strong>
              <span>${group.records.length} pending - PHP ${fmtMoney(group.total)}</span>
            </div>
            <button type="button" class="btn btn-success btn-sm" data-collector-approval-collector-action="approve" data-collector-key="${escapeHtml(group.key)}">
              <i class="ti ti-checks" aria-hidden="true"></i>
              <span>Approve Collector</span>
            </button>
          </div>
        </td>
      `;
      collectorApprovalList.appendChild(groupRow);
      group.records.forEach((record) => {
        const tr = document.createElement('tr');
        tr.className = 'collector-approval-payment-row';
        const id = String(record?.id || '').trim();
        const clientName = record?.customerName || record?.accountNumber || 'Client';
        const accountNumber = String(record?.accountNumber || '').trim();
        const area = String(record?.area || '').trim();
        const reference = String(record?.reference || '').trim();
        const paymentMethod = String(record?.paymentMethod || '').trim();

        tr.innerHTML = `
          <td>
            <div class="collector-approval-copy">
              <strong>${escapeHtml(formatCollectorPaymentDate(record?.recordedAt || record?.date))}</strong>
            </div>
          </td>
          <td>
            <div class="collector-approval-copy">
              <strong>${escapeHtml(clientName)}</strong>
              <span>${escapeHtml([accountNumber ? `#${accountNumber}` : '', area].filter(Boolean).join(' - ') || 'Client account')}</span>
            </div>
          </td>
          <td class="text-end collector-approval-amount">PHP ${fmtMoney(record?.amount)}</td>
          <td>
            <div class="collector-approval-copy">
              <strong>${escapeHtml(reference || 'No reference')}</strong>
              <span>${escapeHtml(paymentMethod || 'Payment')}</span>
            </div>
          </td>
          <td class="text-center">
            <div class="btn-list justify-content-center">
              <button type="button" class="btn btn-outline-danger btn-sm btn-icon" title="Reject payment" aria-label="Reject payment" data-collector-approval-action="reject" data-entry-id="${escapeHtml(id)}">
                <i class="ti ti-x" aria-hidden="true"></i>
              </button>
            </div>
          </td>
        `;
        collectorApprovalList.appendChild(tr);
      });
    });
  }

  function renderCollectorApprovalNotice(message, tone = 'danger') {
    collectorApprovalRecords = [];
    updateCollectorApprovalBatchState([]);
    if (!collectorApprovalList) return;
    const className = tone === 'muted' ? 'text-secondary' : 'text-danger';
    collectorApprovalList.innerHTML = `
      <tr>
        <td colspan="5" class="text-center ${className} py-3">${escapeHtml(message)}</td>
      </tr>
    `;
    if (collectorApprovalsEmptyState) collectorApprovalsEmptyState.style.display = 'none';
  }

  function getCollectorApprovalErrorMessage(status, payload = {}) {
    if (status === 401) return 'Please log in again as admin to load pending collector payments.';
    if (status === 403) return payload?.error || 'Admin access is required to review collector payments.';
    if (status === 404) return 'Collector approval API is not active yet. Restart the server and refresh this page.';
    return payload?.error || payload?.message || 'Failed to load pending collector payments.';
  }

  async function loadCollectorApprovals() {
    if (!collectorApprovalList) return;
    try {
      const res = await fetch('/api/collector/payments/approvals', { credentials: 'include', cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        const error = new Error(getCollectorApprovalErrorMessage(res.status, payload));
        error.status = res.status;
        throw error;
      }
      renderCollectorApprovals(payload.records || []);
    } catch (err) {
      console.warn('Failed to load collector payment approvals', err);
      const status = Number(err?.status || 0);
      const tone = [401, 403, 404].includes(status) ? 'muted' : 'danger';
      renderCollectorApprovalNotice(err?.message || 'Failed to load pending collector payments.', tone);
    }
  }

  function isActiveCollectorReschedule(record = {}) {
    return String(record?.status || '').trim().toLowerCase() === 'rescheduled';
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

  function renderCollectorReschedules() {
    if (!collectorRescheduleList) return;
    const collectorId = String(collectorRescheduleCollectorFilter?.value || '').trim();
    const status = String(collectorRescheduleStatusFilter?.value || 'active').trim().toLowerCase();
    const rows = collectorRescheduleRecords.filter((record) => {
      if (collectorId && String(record?.collectorId || '').trim() !== collectorId) return false;
      if (status === 'all') return true;
      return status === 'active' ? isActiveCollectorReschedule(record) : !isActiveCollectorReschedule(record);
    });

    const activeCount = rows.filter(isActiveCollectorReschedule).length;
    if (collectorRescheduleCount) {
      collectorRescheduleCount.textContent = status === 'active'
        ? `${activeCount} active`
        : `${rows.length} record${rows.length === 1 ? '' : 's'}`;
    }
    collectorRescheduleList.innerHTML = '';
    if (!rows.length) {
      if (collectorReschedulesEmptyState) collectorReschedulesEmptyState.style.display = 'flex';
      return;
    }
    if (collectorReschedulesEmptyState) collectorReschedulesEmptyState.style.display = 'none';

    rows.forEach((record) => {
      const active = isActiveCollectorReschedule(record);
      const tr = document.createElement('tr');
      const accountNumber = String(record?.accountNumber || '').trim();
      const area = String(record?.area || '').trim();
      const scheduleDate = formatCollectorPaymentDate(record?.rescheduledDate);
      const preferredTime = String(record?.preferredTime || '').trim();
      const result = String(record?.result || '').trim();
      const notes = String(record?.notes || '').trim();
      const statusLabel = collectorRescheduleStatusLabel(record);
      const recordId = String(record?.id || '').trim();
      const actions = active && recordId
        ? `
          <div class="btn-list flex-nowrap justify-content-center">
            <button class="btn btn-outline-primary btn-sm btn-icon" type="button" data-collector-reschedule-action="edit" data-record-id="${escapeHtml(recordId)}" title="Edit schedule" aria-label="Edit schedule">
              <i class="ti ti-edit" aria-hidden="true"></i>
            </button>
            <button class="btn btn-outline-danger btn-sm btn-icon" type="button" data-collector-reschedule-action="delete" data-record-id="${escapeHtml(recordId)}" title="Delete schedule" aria-label="Delete schedule">
              <i class="ti ti-trash" aria-hidden="true"></i>
            </button>
          </div>
        `
        : '<span class="text-secondary">&mdash;</span>';
      tr.innerHTML = `
        <td>
          <div class="collector-approval-copy">
            <strong>${escapeHtml(scheduleDate)}</strong>
            <span>${escapeHtml(preferredTime || 'Any time')}</span>
          </div>
        </td>
        <td>
          <div class="collector-approval-copy">
            <strong>${escapeHtml(record?.customerName || accountNumber || 'Client')}</strong>
            <span>${escapeHtml([accountNumber ? `#${accountNumber}` : '', area].filter(Boolean).join(' - ') || 'Client account')}</span>
          </div>
        </td>
        <td>
          <div class="collector-approval-copy">
            <strong>${escapeHtml(getCollectorRescheduleName(record))}</strong>
            <span>${escapeHtml(formatCollectorPaymentDate(record?.createdAt))}</span>
          </div>
        </td>
        <td>
          <div class="collector-approval-copy collector-reschedule-details">
            <strong>${escapeHtml(result || 'Collection follow-up')}</strong>
            <span title="${escapeHtml(notes)}">${escapeHtml(notes || 'No notes')}</span>
          </div>
        </td>
        <td><span class="badge ${active ? 'bg-warning-lt text-warning' : 'bg-secondary-lt text-secondary'}">${escapeHtml(statusLabel)}</span></td>
        <td class="text-center">${actions}</td>
      `;
      collectorRescheduleList.appendChild(tr);
    });
  }

  function renderCollectorRescheduleNotice(message, tone = 'danger') {
    collectorRescheduleRecords = [];
    populateCollectorRescheduleFilter();
    if (!collectorRescheduleList) return;
    const className = tone === 'muted' ? 'text-secondary' : 'text-danger';
    collectorRescheduleList.innerHTML = `<tr><td colspan="6" class="text-center ${className} py-3">${escapeHtml(message)}</td></tr>`;
    if (collectorRescheduleCount) collectorRescheduleCount.textContent = 'Unavailable';
    if (collectorReschedulesEmptyState) collectorReschedulesEmptyState.style.display = 'none';
  }

  async function loadCollectorReschedules() {
    if (!collectorRescheduleList) return;
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
    } catch (error) {
      console.warn('Failed to load collector reschedules', error);
      const tone = [401, 403, 404].includes(Number(error?.status || 0)) ? 'muted' : 'danger';
      renderCollectorRescheduleNotice(error?.message || 'Failed to load rescheduled clients.', tone);
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

  async function openCollectorScheduleModal(record = null) {
    if (!collectorScheduleModal || !collectorScheduleForm) return;
    collectorScheduleForm.reset();
    const editing = Boolean(record?.id);
    if (collectorScheduleRecordId) collectorScheduleRecordId.value = editing ? String(record.id) : '';
    if (collectorScheduleModalTitle) collectorScheduleModalTitle.textContent = editing ? 'Edit Collector Schedule' : 'Create Collector Schedule';
    if (collectorScheduleModalSubtitle) {
      collectorScheduleModalSubtitle.textContent = editing
        ? 'Changes appear on the assigned collector device after the next Sync.'
        : 'Assign a client follow-up that will appear after the collector taps Sync in Android.';
    }
    if (collectorScheduleDate) collectorScheduleDate.value = editing ? String(record.rescheduledDate || '').slice(0, 10) : collectorScheduleToday();
    if (collectorScheduleTime) collectorScheduleTime.value = editing ? String(record.preferredTime || '') : '';
    if (collectorScheduleResult) collectorScheduleResult.value = editing ? String(record.result || '') : 'Collection follow-up';
    if (collectorScheduleNotes) collectorScheduleNotes.value = editing ? String(record.notes || '') : '';
    if (collectorScheduleCustomer) collectorScheduleCustomer.disabled = true;
    if (collectorScheduleCollector) collectorScheduleCollector.disabled = true;
    setCollectorScheduleMessage('Loading clients and assignments...');
    collectorScheduleModal.classList.add('show');
    collectorScheduleModal.setAttribute('aria-hidden', 'false');

    try {
      await Promise.all([
        loadClientReviewCustomers(),
        collectorAccountsCache.length ? Promise.resolve() : loadCollectors(null)
      ]);
      const accountNumber = editing ? String(record.accountNumber || '').trim() : '';
      populateCollectorScheduleCustomers(accountNumber, record);
      if (collectorScheduleCustomer) collectorScheduleCustomer.disabled = editing;
      populateCollectorScheduleCollectors(editing ? String(record.collectorId || '').trim() : '', record);
      if (editing && collectorScheduleCollector) collectorScheduleCollector.disabled = true;
      if (!editing) setCollectorScheduleMessage('Select a client to see collectors assigned to its area.');
      setTimeout(() => collectorScheduleCustomer?.focus(), 50);
    } catch (error) {
      setCollectorScheduleMessage(error?.message || 'Unable to load clients and collectors.', 'danger');
    }
  }

  function closeCollectorScheduleEditor() {
    if (!collectorScheduleModal) return;
    collectorScheduleModal.classList.remove('show');
    collectorScheduleModal.setAttribute('aria-hidden', 'true');
    setCollectorScheduleMessage('');
  }

  async function saveCollectorSchedule() {
    if (!collectorScheduleForm?.reportValidity()) return;
    const recordId = String(collectorScheduleRecordId?.value || '').trim();
    const payload = {
      accountNumber: String(collectorScheduleCustomer?.value || '').trim(),
      collectorId: String(collectorScheduleCollector?.value || '').trim(),
      rescheduledDate: String(collectorScheduleDate?.value || '').trim(),
      preferredTime: String(collectorScheduleTime?.value || '').trim(),
      result: String(collectorScheduleResult?.value || '').trim(),
      notes: String(collectorScheduleNotes?.value || '').trim()
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
      toast('No pending collector payments to approve.', 'danger');
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
        throw new Error(payload?.error || 'Failed to approve pending collector payments.');
      }
      const approvedCount = Number(payload?.approved || (Array.isArray(payload?.records) ? payload.records.length : 0));
      const skippedCount = Number(payload?.skipped || 0);
      const skippedText = skippedCount ? ` ${skippedCount} skipped.` : '';
      toast(
        approvedCount
          ? `Approved ${approvedCount} pending payment${approvedCount === 1 ? '' : 's'} for ${collectorName}.${skippedText}`
          : 'No pending collector payments were approved.',
        approvedCount ? 'ok' : 'danger'
      );
      await Promise.all([
        loadCollectorApprovals(),
        loadAssignmentsAndReport(),
      ]);
    } catch (err) {
      toast(err?.message || 'Failed to approve pending collector payments.', 'danger');
      if (triggerBtn) triggerBtn.disabled = false;
    }
  }

  async function reviewCollectorPayment(entryId, action, triggerBtn = null) {
    const safeEntryId = String(entryId || '').trim();
    const safeAction = String(action || '').trim().toLowerCase();
    if (!safeEntryId || !['approve', 'reject'].includes(safeAction)) return;
    const actionLabel = safeAction === 'approve' ? 'Approve' : 'Reject';
    const confirmed = window.appConfirm
      ? await window.appConfirm(`${actionLabel} this collector payment?`, { title: `${actionLabel} Payment` })
      : window.confirm(`${actionLabel} this collector payment?`);
    if (!confirmed) return;
    if (triggerBtn) triggerBtn.disabled = true;
    try {
      const res = await fetch(`/api/collector/payments/approvals/${encodeURIComponent(safeEntryId)}/${safeAction}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload?.error || `Failed to ${safeAction} collector payment.`);
      }
      toast(safeAction === 'approve' ? 'Collector payment approved.' : 'Collector payment rejected.', 'ok');
      await Promise.all([
        loadCollectorApprovals(),
        loadAssignmentsAndReport(),
      ]);
    } catch (err) {
      toast(err?.message || `Failed to ${safeAction} collector payment.`, 'danger');
      if (triggerBtn) triggerBtn.disabled = false;
    }
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

    const collectors = getDisplayCollectors();
    const collectorAreaMap = buildCollectorAreaMap();
    const monthKey = loadReport.currentMonthKey || getCurrentMonthKey();

    if (!collectors.length) {
      updateAssignmentSummaryStats(0, 0, 0);
      if (assignmentsEmptyState) {
        assignmentsEmptyState.style.display = 'flex';
        const emptyCopy = assignmentsEmptyState.querySelector('p');
        if (emptyCopy) emptyCopy.textContent = 'No collector accounts yet.';
      }
      if (assignmentsFooter) assignmentsFooter.style.display = 'none';
      if (assignmentCount) assignmentCount.textContent = '0 collectors';
      return;
    }

    if (assignmentsEmptyState) assignmentsEmptyState.style.display = 'none';

    let assignedAreaTotal = 0;
    let collectedTotal = 0;

    collectors.forEach((collector, index) => {
      const collectorId = getCollectorId(collector);
      if (!collectorId) return;
      const areas = collectorAreaMap[collectorId] || [];
      const currentTotal = getCollectorMonthTotal(collectorId, areas, monthKey);

      assignedAreaTotal += areas.length;
      collectedTotal += currentTotal;

      const tr = document.createElement('tr');
      tr.className = 'collector-summary-row';
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-haspopup', 'dialog');
      tr.setAttribute('aria-label', `View assigned areas for ${getCollectorName(collectorId)}`);
      tr.setAttribute('data-assign-action', 'view-collector-areas');
      tr.setAttribute('data-collector-id', collectorId);

      const collectorTd = document.createElement('td');
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn btn-link btn-sm px-0 collector-row-trigger';
      toggleBtn.setAttribute('aria-haspopup', 'dialog');
      toggleBtn.tabIndex = -1;

      const avatar = document.createElement('span');
      avatar.className = `avatar avatar-sm bg-primary-lt text-primary collector-avatar collector-avatar--tone-${(index % 4) + 1}`;
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = getCollectorInitials(collectorId);

      const nameWrap = document.createElement('span');
      nameWrap.className = 'collector-row-copy';
      const name = document.createElement('span');
      name.className = 'collector-row-name';
      name.textContent = getCollectorName(collectorId);
      const meta = document.createElement('span');
      meta.className = 'collector-row-meta';
      meta.textContent = `ID ${collectorId}`;
      nameWrap.append(name, meta);
      toggleBtn.append(avatar, nameWrap);
      collectorTd.appendChild(toggleBtn);

      const areaTd = document.createElement('td');
      areaTd.className = 'col-clients';
      const areaPill = document.createElement('span');
      areaPill.className = areas.length
        ? 'badge bg-primary-lt text-primary collector-area-pill'
        : 'badge bg-secondary-lt text-secondary collector-area-pill is-empty';
      areaPill.textContent = areaCountLabel(areas.length);
      areaTd.appendChild(areaPill);

      const totalTd = document.createElement('td');
      totalTd.className = 'col-balance collector-month-total';
      if (!currentTotal) totalTd.classList.add('is-zero');
      totalTd.textContent = `PHP ${fmtMoney(currentTotal)}`;

      const actionTd = document.createElement('td');
      actionTd.className = 'text-center col-actions';
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'btn-list justify-content-center flex-nowrap';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-icon btn-sm btn-ghost-secondary';
      editBtn.innerHTML = '<i class="ti ti-edit"></i>';
      editBtn.title = `Edit ${getCollectorName(collectorId)}`;
      editBtn.setAttribute('data-assign-action', 'edit-collector');
      editBtn.setAttribute('data-collector-id', collectorId);
      actionsWrap.appendChild(editBtn);
      actionTd.appendChild(actionsWrap);

      tr.append(collectorTd, areaTd, totalTd, actionTd);
      assignmentList.appendChild(tr);
    });

    if (assignmentCount) {
      assignmentCount.textContent = collectors.length === 1 ? '1 collector' : `${collectors.length} collectors`;
    }
    if (assignmentsFooter) {
      assignmentsFooter.style.display = 'flex';
      if (assignmentsSummary) {
        const collectorLabel = collectors.length === 1 ? '1 collector' : `${collectors.length} collectors`;
        assignmentsSummary.textContent = `${collectorLabel} - ${areaCountLabel(assignedAreaTotal)} assigned`;
      }
    }
    updateAssignmentSummaryStats(collectors.length, assignedAreaTotal, collectedTotal);
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

  async function loadReport() {
    if (reportContainer) reportContainer.textContent = 'Loading...';
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

  async function loadAssignmentsAndReport() {
    try {
      await loadCollectors();
      await loadReport();
    } catch (err) {
      console.warn('Failed to refresh collectors/report', err);
    }
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

  collectorRescheduleCollectorFilter?.addEventListener('change', renderCollectorReschedules);
  collectorRescheduleStatusFilter?.addEventListener('change', renderCollectorReschedules);
  collectorRescheduleRefresh?.addEventListener('click', () => loadCollectorReschedules().catch(() => {}));
  collectorRescheduleCreate?.addEventListener('click', () => openCollectorScheduleModal().catch(() => {}));
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
    const scheduleActionButton = event.target.closest('[data-collector-reschedule-action]');
    if (scheduleActionButton) {
      const recordId = scheduleActionButton.getAttribute('data-record-id') || '';
      const action = scheduleActionButton.getAttribute('data-collector-reschedule-action') || '';
      const record = collectorRescheduleRecords.find((item) => String(item?.id || '') === recordId);
      if (!record) return;
      if (action === 'edit') {
        openCollectorScheduleModal(record).catch(() => {});
      } else if (action === 'delete') {
        deleteCollectorSchedule(record, scheduleActionButton).catch(() => {});
      }
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

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('tr.collector-summary-row[data-assign-action="view-collector-areas"]');
    if (!row || event.target.closest('button, a, input, select, textarea')) return;
    event.preventDefault();
    openCollectorAreasModal(row.getAttribute('data-collector-id') || '');
  });

  loadAreas().catch(() => {});
  loadCollectorApprovals().catch(() => {});
  loadCollectorReschedules().catch(() => {});
  loadCollectors()
    .then(() => loadReport())
    .catch(() => {
      if (monthlySummary) {
        monthlySummary.innerHTML = '<p class="empty-copy">Could not load the report.</p>';
      }
    });
})();
