(function () {
  const monthFilter = document.getElementById('monthFilter');
  const collectorFilter = document.getElementById('collectorFilter');
  const areaFilter = document.getElementById('areaFilter');
  const historySearch = document.getElementById('historySearch');
  const historyClearFilters = document.getElementById('historyClearFilters');
  const historyExportCsv = document.getElementById('historyExportCsv');
  const historyPrint = document.getElementById('historyPrint');
  const tableBody = document.getElementById('historyTableBody');
  const summary = document.getElementById('historySummary');
  const totalScope = document.getElementById('historyTotalScope');
  const totalCollected = document.getElementById('historyTotalCollected');
  const paymentCount = document.getElementById('historyPaymentCount');
  const collectorCount = document.getElementById('historyCollectorCount');
  const averagePayment = document.getElementById('historyAveragePayment');
  const tableBadge = document.getElementById('historyTableBadge');
  const pageSize = document.getElementById('historyPageSize');
  const prevPage = document.getElementById('historyPrevPage');
  const nextPage = document.getElementById('historyNextPage');
  const pageLabel = document.getElementById('historyPageLabel');
  const reportContainer = document.getElementById('reportContainer');
  const modal = document.getElementById('historyModal');
  const modalTitle = document.getElementById('historyModalTitle');
  const modalSubtitle = document.getElementById('historyModalSubtitle');
  const modalBody = document.getElementById('historyModalBody');
  const modalClose = document.getElementById('historyModalClose');
  const modalDone = document.getElementById('historyModalDone');

  const fmtMoney = (n) =>
    new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
  const fmtInt = (n) => new Intl.NumberFormat('en-PH').format(Number(n || 0));
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const getCollectorInitials = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'C';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  };

  const monthLabel = (key) => {
    if (!key) return '';
    const [y, m] = key.split('-').map(Number);
    if (!y || !m) return key;
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };

  const getCurrentMonthKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };

  const formatDateKey = (key) => {
    if (!key) return '';
    const [y, m, d] = key.split('-').map(Number);
    if (!y || !m || !d) return key;
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const isPrepaidRecord = (record) => {
    const explicit = String(record?.planCategory || record?.planType || '').trim().toLowerCase();
    if (explicit === 'prepaid') return true;
    if (explicit === 'postpaid') return false;
    const billing = String(record?.planBilling || '').trim().toLowerCase();
    if (billing.includes('prepaid')) return true;
    if (billing.includes('postpaid')) return false;
    return false;
  };

  const isReportableCollectorPaymentEntry = (entry = {}) => {
    const status = String(entry?.status || entry?.paymentStatus || '').trim().toLowerCase();
    return ![
      'pending_gcash_verification',
      'pending-gcash-verification',
      'pending gcash verification',
      'pending_approval',
      'pending-approval',
      'pending approval',
      'rejected',
      'cancelled',
      'canceled',
      'void',
      'voided',
    ].includes(status);
  };

  const resolveDirection = (entry) => {
    const rawDirection = String(entry?.direction || entry?.nature || '').trim().toLowerCase();
    if (rawDirection === 'debit' || rawDirection === 'credit') return rawDirection;
    const kind = String(entry?.kind || '').trim().toLowerCase();
    return kind === 'charge' || kind === 'debit' ? 'debit' : 'credit';
  };

  const toMonthKey = (dateObj) =>
    `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

  const toDateKey = (dateObj) =>
    `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;

  function buildCollectorDailySummary(records = [], targetMonthKey = '') {
    const byCollector = {};
    (Array.isArray(records) ? records : []).forEach((record) => {
      if (!record || isPrepaidRecord(record)) return;
      const area = String(record.area || '').trim() || 'Unassigned';

      (Array.isArray(record.history) ? record.history : []).forEach((entry) => {
        if (!isReportableCollectorPaymentEntry(entry)) return;
        if (resolveDirection(entry) !== 'credit') return;
        const collectorId = String(entry?.recordedBy?.id || '').trim();
        if (!collectorId) return;

        const rawDate = entry?.date || entry?.recordedAt;
        if (!rawDate) return;
        const dateObj = new Date(rawDate);
        if (Number.isNaN(dateObj.getTime())) return;
        if (targetMonthKey && toMonthKey(dateObj) !== targetMonthKey) return;

        const dateKey = toDateKey(dateObj);
        byCollector[collectorId] = byCollector[collectorId] || {};
        byCollector[collectorId][dateKey] = byCollector[collectorId][dateKey] || {
          dateKey,
          amount: 0,
          payments: 0,
          accounts: new Set(),
          areas: new Set(),
        };

        const bucket = byCollector[collectorId][dateKey];
        bucket.amount += Math.abs(Number(entry?.amount) || 0);
        bucket.payments += 1;
        if (record.accountNumber) bucket.accounts.add(String(record.accountNumber));
        bucket.areas.add(area);
      });
    });

    return Object.fromEntries(
      Object.entries(byCollector).map(([collectorId, dateMap]) => [
        collectorId,
        Object.values(dateMap)
          .map((row) => ({
            dateKey: row.dateKey,
            amount: row.amount,
            payments: row.payments,
            uniqueAccounts: row.accounts.size,
            accountNumbers: Array.from(row.accounts).sort((a, b) => a.localeCompare(b)),
            areaCount: row.areas.size,
            areas: Array.from(row.areas).sort((a, b) => a.localeCompare(b)),
          }))
          .sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
      ])
    );
  }

  function buildCollectorAreaSummary(records = [], targetMonthKey = '') {
    const byCollector = {};
    (Array.isArray(records) ? records : []).forEach((record) => {
      if (!record || isPrepaidRecord(record)) return;
      const area = String(record.area || '').trim() || 'Unassigned';

      (Array.isArray(record.history) ? record.history : []).forEach((entry) => {
        if (!isReportableCollectorPaymentEntry(entry)) return;
        if (resolveDirection(entry) !== 'credit') return;
        const collectorId = String(entry?.recordedBy?.id || '').trim();
        if (!collectorId) return;

        const rawDate = entry?.date || entry?.recordedAt;
        if (!rawDate) return;
        const dateObj = new Date(rawDate);
        if (Number.isNaN(dateObj.getTime())) return;
        if (targetMonthKey && toMonthKey(dateObj) !== targetMonthKey) return;

        byCollector[collectorId] = byCollector[collectorId] || {};
        byCollector[collectorId][area] = byCollector[collectorId][area] || {
          area,
          amount: 0,
          payments: 0,
        };

        const bucket = byCollector[collectorId][area];
        bucket.amount += Math.abs(Number(entry?.amount) || 0);
        bucket.payments += 1;
      });
    });

    return Object.fromEntries(
      Object.entries(byCollector).map(([collectorId, dateMap]) => [
        collectorId,
        Object.values(dateMap)
          .sort((a, b) => b.amount - a.amount || a.area.localeCompare(b.area)),
      ])
    );
  }

  function buildCollectorPeriodStats(records = []) {
    const buckets = new Map();
    (Array.isArray(records) ? records : []).forEach((record) => {
      if (!record || isPrepaidRecord(record)) return;
      const area = String(record.area || '').trim() || 'Unassigned';
      (Array.isArray(record.history) ? record.history : []).forEach((entry) => {
        if (!isReportableCollectorPaymentEntry(entry) || resolveDirection(entry) !== 'credit') return;
        const collectorId = String(entry?.recordedBy?.id || '').trim();
        const rawDate = entry?.date || entry?.recordedAt;
        if (!collectorId || !rawDate) return;
        const date = new Date(rawDate);
        if (Number.isNaN(date.getTime())) return;
        const month = toMonthKey(date);
        const key = `${collectorId}::${month}`;
        const bucket = buckets.get(key) || {
          collectorId,
          month,
          payments: 0,
          amount: 0,
          accounts: new Set(),
          areas: new Set(),
        };
        bucket.payments += 1;
        bucket.amount += Math.abs(Number(entry?.amount) || 0);
        if (record.accountNumber) bucket.accounts.add(String(record.accountNumber));
        bucket.areas.add(area);
        buckets.set(key, bucket);
      });
    });
    return new Map([...buckets.entries()].map(([key, bucket]) => [key, {
      collectorId: bucket.collectorId,
      month: bucket.month,
      payments: bucket.payments,
      amount: bucket.amount,
      uniqueAccounts: bucket.accounts.size,
      areas: [...bucket.areas].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true })),
    }]));
  }

  function renderMonthlyCollectionsReport(report = {}, accountsMap = {}, areaReport = {}) {
    if (!reportContainer) return;

    const currentMonthKey = state.currentMonthKey || getCurrentMonthKey();
    const areaCounts = Object.fromEntries(
      Object.entries(state.currentAreaSummaryByCollector || {}).map(([collectorId, rows]) => [
        collectorId,
        Array.isArray(rows) ? rows.length : 0,
      ])
    );
    const rows = Object.entries(report || {})
      .map(([collectorId, months]) => {
        const account = accountsMap[collectorId] || {};
        return {
          collectorId,
          collectorName: account.name || account.username || `Collector ${collectorId}`,
          areaCount: areaCounts[String(collectorId)] || 0,
          amount: Number((months || {})[currentMonthKey] || 0),
        };
      })
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount || a.collectorName.localeCompare(b.collectorName));

    if (!rows.length) {
      reportContainer.innerHTML = '<p class="empty-copy">No collections recorded this month.</p>';
      return;
    }

    const totalCollected = rows.reduce((sum, row) => sum + row.amount, 0);
    reportContainer.innerHTML = `
      <table class="table table-vcenter table-sm collectors-table collector-report-table">
        <thead>
          <tr>
            <th class="text-center history-col-id">ID</th>
            <th>Collector</th>
            <th>Area</th>
            <th class="text-center history-col-collected">Total Collected</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row, index) => `
            <tr class="collector-report-row" data-daily-collector-id="${row.collectorId}" data-month="${currentMonthKey}">
              <td class="text-center">${index + 1}</td>
              <td><button type="button" class="btn btn-link btn-sm px-0 collector-row-trigger" data-daily-collector-id="${row.collectorId}" data-month="${currentMonthKey}">${escapeHtml(row.collectorName)}</button></td>
              <td>${row.areaCount ? `${row.areaCount} area(s)` : '-'}</td>
              <td class="text-center">PHP ${fmtMoney(row.amount)}</td>
            </tr>
          `
            )
            .join('')}
          <tr>
            <td></td>
            <td class="fw-semibold">Total</td>
            <td></td>
            <td class="fw-semibold text-center">PHP ${fmtMoney(totalCollected)}</td>
          </tr>
        </tbody>
      </table>
      <div class="card-footer collection-history-footer">
        <div class="footer-summary">Showing ${rows.length} collectors for ${monthLabel(currentMonthKey)}</div>
      </div>
    `;
  }

  const state = {
    entries: [],
    months: [],
    areaReport: {},
    accountsMap: {},
    paymentRecords: [],
    currentMonthKey: getCurrentMonthKey(),
    dailySummaryByCollector: {},
    currentAreaSummaryByCollector: {},
    periodStats: new Map(),
    paymentDetailsAvailable: false,
    expandedMonths: new Set(),
    page: 1,
    sortKey: 'month',
    sortDirection: 'desc',
    printing: false,
    pageBeforePrint: 1,
  };

  function getDefaultExpandedMonths(selectedMonth = '') {
    if (selectedMonth) return new Set([selectedMonth]);
    return new Set(state.months);
  }

  function renderLegacyHistory() {
    if (!tableBody) return;
    const selectedMonth = monthFilter?.value || '';
    const filtered = selectedMonth
      ? state.entries.filter((row) => row.month === selectedMonth)
      : state.entries;
    const total = filtered.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const scopeLabel = selectedMonth ? monthLabel(selectedMonth) : 'All months';

    if (totalScope) totalScope.textContent = scopeLabel;
    if (totalCollected) totalCollected.textContent = `PHP ${fmtMoney(total)}`;
    if (summary) {
      summary.textContent = filtered.length
        ? `Showing ${fmtInt(filtered.length)} ${filtered.length === 1 ? 'record' : 'records'}`
        : 'No records to show';
    }

    if (!filtered.length) {
      tableBody.innerHTML = '<tr><td colspan="3" class="collection-history-empty">No data yet.</td></tr>';
      return;
    }

    const grouped = new Map();
    filtered.forEach((row) => {
      const month = row.month || 'unknown';
      if (!grouped.has(month)) grouped.set(month, []);
      grouped.get(month).push(row);
    });

    const orderedMonths = (selectedMonth ? [selectedMonth] : state.months)
      .filter((month) => grouped.has(month));
    /* Legacy summary line is handled by the card and footer above.

      summary.textContent = `${selectedMonth ? monthLabel(selectedMonth) : 'All months'} · PHP ${fmtMoney(total)}`;
    */

    tableBody.innerHTML = orderedMonths.map((month) => {
      const rows = grouped.get(month) || [];
      const monthTotal = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
      const isExpanded = state.expandedMonths.has(month);
      const monthRow = `
        <tr class="collection-history-month-row" data-history-month="${escapeHtml(month)}">
          <td>
            <button type="button" class="collection-history-month-toggle" data-history-month-toggle="${escapeHtml(month)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
              <i class="ti ti-chevron-right collection-history-chevron" aria-hidden="true"></i>
              <i class="ti ti-calendar" aria-hidden="true"></i>
              <span>${escapeHtml(monthLabel(month))}</span>
            </button>
          </td>
          <td></td>
          <td class="collection-history-month-total">Total: PHP ${fmtMoney(monthTotal)}</td>
        </tr>
      `;
      const collectorRows = isExpanded
        ? rows.map((row, index) => `
          <tr class="collection-history-entry-row" data-history-collector-row data-month="${escapeHtml(row.month)}" data-collector-id="${escapeHtml(row.collectorId)}" tabindex="0" role="button" aria-label="View ${escapeHtml(row.collectorName)} breakdown for ${escapeHtml(monthLabel(row.month))}">
            <td></td>
            <td>
              <span class="collection-history-person">
                <span class="avatar avatar-sm bg-primary-lt text-primary collection-history-avatar collection-history-avatar--tone-${(index % 4) + 1}" aria-hidden="true">${escapeHtml(getCollectorInitials(row.collectorName))}</span>
                <span>${escapeHtml(row.collectorName)}</span>
              </span>
            </td>
            <td class="collection-history-entry-amount">PHP ${fmtMoney(row.amount)}</td>
          </tr>
        `).join('')
        : '';
      return monthRow + collectorRows;
    }).join('');
  }

  function getFilteredHistoryEntries() {
    const selectedMonth = String(monthFilter?.value || '').trim();
    const selectedCollector = String(collectorFilter?.value || '').trim();
    const selectedArea = String(areaFilter?.value || '').trim().toLowerCase();
    const query = String(historySearch?.value || '').trim().toLowerCase();
    return state.entries.filter((row) => {
      if (selectedMonth && row.month !== selectedMonth) return false;
      if (selectedCollector && row.collectorId !== selectedCollector) return false;
      const areas = Array.isArray(row.areas) ? row.areas : [];
      if (selectedArea && !areas.some((area) => String(area).trim().toLowerCase() === selectedArea)) return false;
      if (!query) return true;
      return [row.collectorName, row.collectorId, row.month, monthLabel(row.month), ...areas]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }

  function sortHistoryEntries(entries = []) {
    const direction = state.sortDirection === 'asc' ? 1 : -1;
    const key = state.sortKey;
    return [...entries].sort((left, right) => {
      let result = 0;
      if (key === 'collectorName') {
        result = left.collectorName.localeCompare(right.collectorName, undefined, { sensitivity: 'base', numeric: true });
      } else if (key === 'payments' || key === 'amount') {
        result = Number(left[key] || 0) - Number(right[key] || 0);
      } else {
        result = String(left.month || '').localeCompare(String(right.month || ''));
      }
      if (result) return result * direction;
      if (left.month !== right.month) return right.month.localeCompare(left.month);
      return left.collectorName.localeCompare(right.collectorName, undefined, { sensitivity: 'base', numeric: true });
    });
  }

  function updateSortControls() {
    document.querySelectorAll('[data-history-sort]').forEach((button) => {
      const active = button.getAttribute('data-history-sort') === state.sortKey;
      button.classList.toggle('is-active', active);
      const icon = button.querySelector('.ti');
      if (icon) {
        icon.className = active
          ? `ti ti-sort-${state.sortDirection === 'asc' ? 'ascending' : 'descending'}`
          : 'ti ti-arrows-sort';
      }
      const header = button.closest('th');
      if (header) header.setAttribute('aria-sort', active ? (state.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
    });
  }

  function render() {
    if (!tableBody) return;
    const filtered = sortHistoryEntries(getFilteredHistoryEntries());
    const total = filtered.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const totalPayments = state.paymentDetailsAvailable
      ? filtered.reduce((sum, row) => sum + (Number(row.payments) || 0), 0)
      : null;
    const visibleCollectors = new Set(filtered.map((row) => row.collectorId)).size;
    const selectedMonth = String(monthFilter?.value || '').trim();
    const scopeLabel = selectedMonth ? monthLabel(selectedMonth) : 'All months';

    if (totalScope) totalScope.textContent = scopeLabel;
    if (totalCollected) totalCollected.textContent = `PHP ${fmtMoney(total)}`;
    if (paymentCount) paymentCount.textContent = totalPayments == null ? '—' : fmtInt(totalPayments);
    if (collectorCount) collectorCount.textContent = fmtInt(visibleCollectors);
    if (averagePayment) averagePayment.textContent = totalPayments == null ? '—' : `PHP ${fmtMoney(totalPayments ? total / totalPayments : 0)}`;
    if (tableBadge) tableBadge.textContent = `${fmtInt(filtered.length)} ${filtered.length === 1 ? 'record' : 'records'}`;

    const requestedPageSize = Math.max(Number(pageSize?.value) || 20, 1);
    const effectivePageSize = state.printing ? Math.max(filtered.length, 1) : requestedPageSize;
    const pageCount = Math.max(Math.ceil(filtered.length / effectivePageSize), 1);
    state.page = Math.min(Math.max(state.page, 1), pageCount);
    const start = (state.page - 1) * effectivePageSize;
    const visibleRows = filtered.slice(start, start + effectivePageSize);
    const visibleStart = filtered.length ? start + 1 : 0;
    const visibleEnd = Math.min(start + visibleRows.length, filtered.length);

    if (summary) {
      summary.textContent = filtered.length
        ? `Showing ${fmtInt(visibleStart)}-${fmtInt(visibleEnd)} of ${fmtInt(filtered.length)} records`
        : 'No records match the selected filters';
    }
    if (pageLabel) pageLabel.textContent = `Page ${state.page} of ${pageCount}`;
    if (prevPage) prevPage.disabled = state.page <= 1;
    if (nextPage) nextPage.disabled = state.page >= pageCount;
    updateSortControls();

    if (!visibleRows.length) {
      tableBody.innerHTML = '<tr><td colspan="6" class="collection-history-empty">No approved collection records match these filters.</td></tr>';
      return;
    }

    const grouped = new Map();
    visibleRows.forEach((row) => {
      const month = row.month || 'unknown';
      if (!grouped.has(month)) grouped.set(month, []);
      grouped.get(month).push(row);
    });
    const totalsByMonth = new Map();
    filtered.forEach((row) => {
      const bucket = totalsByMonth.get(row.month) || { amount: 0, collectors: new Set() };
      bucket.amount += Number(row.amount) || 0;
      bucket.collectors.add(row.collectorId);
      totalsByMonth.set(row.month, bucket);
    });

    tableBody.innerHTML = [...grouped.entries()].map(([month, rows]) => {
      const monthTotals = totalsByMonth.get(month) || { amount: 0, collectors: new Set() };
      const isExpanded = state.expandedMonths.has(month);
      const monthRow = `
        <tr class="collection-history-month-row" data-history-month="${escapeHtml(month)}">
          <td colspan="5">
            <button type="button" class="collection-history-month-toggle collection-history-month-label btn btn-link btn-sm px-0" data-history-month-toggle="${escapeHtml(month)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
              <i class="ti ti-chevron-${isExpanded ? 'down' : 'right'}" aria-hidden="true"></i>
              <i class="ti ti-calendar" aria-hidden="true"></i>
              <span>${escapeHtml(monthLabel(month))}</span>
              <span class="badge bg-secondary-lt text-secondary">${fmtInt(monthTotals.collectors.size)} collectors</span>
            </button>
          </td>
          <td class="collection-history-month-total text-end">PHP ${fmtMoney(monthTotals.amount)}</td>
        </tr>
      `;
      const collectorRows = isExpanded ? rows.map((row, index) => {
        const areaNames = Array.isArray(row.areas) ? row.areas : [];
        const areaLabel = !state.paymentDetailsAvailable
          ? 'Details unavailable'
          : (areaNames.length === 1 ? '1 area' : `${fmtInt(areaNames.length)} areas`);
        return `
          <tr class="collection-history-entry-row" data-history-collector-row data-month="${escapeHtml(row.month)}" data-collector-id="${escapeHtml(row.collectorId)}" tabindex="0" role="button" aria-label="View ${escapeHtml(row.collectorName)} breakdown for ${escapeHtml(monthLabel(row.month))}">
            <td data-label="Period">${escapeHtml(monthLabel(row.month))}</td>
            <td data-label="Collector">
              <span class="collection-history-person">
                <span class="avatar avatar-sm bg-primary-lt text-primary collection-history-avatar collection-history-avatar--tone-${(index % 4) + 1}" aria-hidden="true">${escapeHtml(getCollectorInitials(row.collectorName))}</span>
                <span>${escapeHtml(row.collectorName)}</span>
              </span>
            </td>
            <td data-label="Service areas">
              <span class="collection-history-area-copy">
                <strong>${escapeHtml(areaLabel)}</strong>
                <span title="${escapeHtml(areaNames.join(', '))}">${escapeHtml(areaNames.join(', ') || 'No area details')}</span>
              </span>
            </td>
            <td class="text-end" data-label="Payments">${state.paymentDetailsAvailable ? fmtInt(row.payments) : '—'}</td>
            <td data-label="Status"><span class="badge bg-green-lt text-green">Approved</span></td>
            <td class="collection-history-entry-amount text-end" data-label="Total collected">PHP ${fmtMoney(row.amount)}</td>
          </tr>
        `;
      }).join('') : '';
      return monthRow + collectorRows;
    }).join('');
  }

  function populateMonthFilter(months) {
    if (!monthFilter) return;
    monthFilter.innerHTML = '<option value="">All months</option>';
    months.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = monthLabel(m);
      monthFilter.appendChild(opt);
    });
  }

  function populateCollectorFilter(entries = []) {
    if (!collectorFilter) return;
    const previous = collectorFilter.value;
    const options = new Map();
    entries.forEach((entry) => options.set(entry.collectorId, entry.collectorName));
    collectorFilter.innerHTML = '<option value="">All collectors</option>';
    [...options.entries()]
      .sort((left, right) => left[1].localeCompare(right[1], undefined, { sensitivity: 'base', numeric: true }))
      .forEach(([id, name]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        collectorFilter.appendChild(option);
      });
    collectorFilter.value = options.has(previous) ? previous : '';
  }

  function populateAreaFilter(entries = []) {
    if (!areaFilter) return;
    const previous = areaFilter.value;
    const areas = [...new Set(entries.flatMap((entry) => Array.isArray(entry.areas) ? entry.areas : []))]
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true }));
    areaFilter.innerHTML = '<option value="">All areas</option>';
    areas.forEach((area) => {
      const option = document.createElement('option');
      option.value = area;
      option.textContent = area;
      areaFilter.appendChild(option);
    });
    areaFilter.value = areas.includes(previous) ? previous : '';
  }

  async function loadHistory() {
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="6" class="collection-history-empty">Loading...</td></tr>';
    }
    if (reportContainer) {
      reportContainer.innerHTML = '<p class="empty-copy">Loading report...</p>';
    }
    try {
      const [reportResponse, paymentRecordsResponse] = await Promise.all([
        fetch('/api/collectors/report', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/payment-records', { credentials: 'include', cache: 'no-store' }).catch(() => null),
      ]);
      const data = await reportResponse.json();
      if (!reportResponse.ok) throw new Error(data?.error || 'Could not load report');
      const report = data.report || {};
      const accountsMap = data.accountsMap || {};
      const areaReport = data.areaReport || {};
      let paymentRecords = [];

      if (paymentRecordsResponse?.ok) {
        const paymentRecordsPayload = await paymentRecordsResponse.json().catch(() => ({}));
        paymentRecords = Array.isArray(paymentRecordsPayload?.records) ? paymentRecordsPayload.records : [];
      }
      state.paymentDetailsAvailable = Boolean(paymentRecordsResponse?.ok);

      state.currentMonthKey = getCurrentMonthKey();
      state.accountsMap = accountsMap;
      state.paymentRecords = paymentRecords;
      state.dailySummaryByCollector = buildCollectorDailySummary(paymentRecords, state.currentMonthKey);
      state.currentAreaSummaryByCollector = buildCollectorAreaSummary(paymentRecords, state.currentMonthKey);
      state.periodStats = buildCollectorPeriodStats(paymentRecords);

      renderMonthlyCollectionsReport(report, accountsMap, areaReport);

      const entries = [];
      Object.entries(report).forEach(([collectorId, months]) => {
        Object.entries(months || {}).forEach(([month, amount]) => {
          const val = Number(amount || 0);
          if (!val) return;
          const acc = accountsMap[collectorId] || {};
          const name = acc.name || acc.username || `Collector ${collectorId}`;
          const period = state.periodStats.get(`${collectorId}::${month}`) || {};
          entries.push({
            collectorId,
            collectorName: name,
            month,
            amount: val,
            payments: Number(period.payments || 0),
            uniqueAccounts: Number(period.uniqueAccounts || 0),
            areas: Array.isArray(period.areas) ? period.areas : [],
          });
        });
      });
      entries.sort((a, b) => {
        if (a.month !== b.month) return b.month.localeCompare(a.month);
        return a.collectorName.localeCompare(b.collectorName);
      });

      const monthSet = new Set(entries.map((e) => e.month));

      state.entries = entries;
      state.months = Array.from(monthSet).sort().reverse();
      state.expandedMonths = getDefaultExpandedMonths();
      state.areaReport = areaReport;
      populateMonthFilter(state.months);
      populateCollectorFilter(state.entries);
      populateAreaFilter(state.entries);
      state.page = 1;
      render();
    } catch (err) {
      if (reportContainer) {
        reportContainer.innerHTML = `<p class="empty-copy text-danger">${err.message || 'Error loading report'}</p>`;
      }
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="6" class="collection-history-empty text-danger">${err.message ||
          'Error loading data'}</td></tr>`;
      }
      if (summary) summary.textContent = '';
    }
  }

  function resetPageAndRender() {
    state.page = 1;
    render();
  }

  monthFilter?.addEventListener('change', () => {
    const selectedMonth = monthFilter?.value || '';
    state.expandedMonths = getDefaultExpandedMonths(selectedMonth);
    resetPageAndRender();
  });
  collectorFilter?.addEventListener('change', resetPageAndRender);
  areaFilter?.addEventListener('change', resetPageAndRender);
  historySearch?.addEventListener('input', resetPageAndRender);
  pageSize?.addEventListener('change', resetPageAndRender);
  prevPage?.addEventListener('click', () => {
    state.page = Math.max(state.page - 1, 1);
    render();
  });
  nextPage?.addEventListener('click', () => {
    state.page += 1;
    render();
  });
  historyClearFilters?.addEventListener('click', () => {
    if (monthFilter) monthFilter.value = '';
    if (collectorFilter) collectorFilter.value = '';
    if (areaFilter) areaFilter.value = '';
    if (historySearch) historySearch.value = '';
    state.expandedMonths = getDefaultExpandedMonths();
    resetPageAndRender();
  });
  document.querySelectorAll('[data-history-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.getAttribute('data-history-sort') || 'month';
      if (state.sortKey === key) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      else {
        state.sortKey = key;
        state.sortDirection = key === 'collectorName' ? 'asc' : 'desc';
      }
      resetPageAndRender();
    });
  });

  function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  historyExportCsv?.addEventListener('click', () => {
    const rows = sortHistoryEntries(getFilteredHistoryEntries());
    if (!rows.length) return;
    const lines = [
      ['Collection Period', 'Collector', 'Service Areas', 'Approved Payments', 'Unique Accounts', 'Total Collected'],
      ...rows.map((row) => [
        monthLabel(row.month),
        row.collectorName,
        (row.areas || []).join(', '),
        state.paymentDetailsAvailable ? row.payments : '',
        state.paymentDetailsAvailable ? row.uniqueAccounts : '',
        Number(row.amount || 0).toFixed(2),
      ]),
    ].map((row) => row.map(csvCell).join(','));
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const scope = monthFilter?.value || 'all-months';
    anchor.href = url;
    anchor.download = `collector-history-${scope}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  });

  historyPrint?.addEventListener('click', () => {
    state.pageBeforePrint = state.page;
    state.printing = true;
    state.page = 1;
    state.expandedMonths = new Set(state.months);
    render();
    setTimeout(() => window.print(), 0);
  });
  window.addEventListener('afterprint', () => {
    if (!state.printing) return;
    state.printing = false;
    state.page = state.pageBeforePrint;
    render();
  });

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }

  function openModal() {
    if (!modal) return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
  }

  function renderAreaBreakdown(collectorId, collectorName, month) {
    if (!modalBody) return;
    const areaSummaryByCollector = buildCollectorAreaSummary(state.paymentRecords, month);
    const rows = Array.isArray(areaSummaryByCollector?.[String(collectorId)])
      ? areaSummaryByCollector[String(collectorId)]
      : [];

    if (!rows.length) {
      modalBody.innerHTML = '<p class="empty-copy text-center p-3 mb-0">No area data for this month.</p>';
      return;
    }

    const total = rows.reduce((s, r) => s + r.amount, 0);
    modalBody.innerHTML = `
      <table class="table table-vcenter table-sm history-table">
        <thead>
          <tr>
            <th>Area</th>
            <th class="text-end history-col-payments">Payments</th>
            <th class="text-end history-col-collected">Collected</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `
              <tr>
                <td>${escapeHtml(r.area)}</td>
                <td class="text-end">${fmtInt(r.payments)}</td>
                <td class="text-end">PHP ${fmtMoney(r.amount)}</td>
              </tr>
            `
            )
            .join('')}
          <tr>
            <td class="fw-semibold">Total</td>
            <td class="fw-semibold text-end">${fmtInt(rows.reduce((sum, row) => sum + (Number(row.payments) || 0), 0))}</td>
            <td class="fw-semibold text-end">PHP ${fmtMoney(total)}</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  function renderDailySummary(collectorId) {
    if (!modalBody) return;
    const rows = Array.isArray(state.dailySummaryByCollector?.[String(collectorId)])
      ? state.dailySummaryByCollector[String(collectorId)]
      : [];

    if (!rows.length) {
      modalBody.innerHTML = '<p class="empty-copy text-center p-3 mb-0">No daily collection data for this month.</p>';
      return;
    }

    const totalAmount = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const totalPayments = rows.reduce((sum, row) => sum + (Number(row.payments) || 0), 0);
    const totalAccounts = new Set(rows.flatMap((row) => row.accountNumbers || [])).size;

    modalBody.innerHTML = `
      <table class="table table-vcenter table-sm history-table">
        <thead>
          <tr>
            <th>Date</th>
            <th class="text-end history-col-payments">Payments</th>
            <th class="text-end history-col-accounts">Accounts</th>
            <th class="text-end history-col-collected">Collected</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
              <tr>
                <td title="${escapeHtml(row.areas.join(', '))}">${formatDateKey(row.dateKey)}</td>
                <td class="text-end">${fmtInt(row.payments)}</td>
                <td class="text-end">${fmtInt(row.uniqueAccounts)}</td>
                <td class="text-end">PHP ${fmtMoney(row.amount)}</td>
              </tr>
            `
            )
            .join('')}
          <tr>
            <td class="fw-semibold">Total</td>
            <td class="fw-semibold text-end">${fmtInt(totalPayments)}</td>
            <td class="fw-semibold text-end">${fmtInt(totalAccounts)}</td>
            <td class="fw-semibold text-end">PHP ${fmtMoney(totalAmount)}</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  reportContainer?.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-daily-collector-id]');
    if (!trigger) return;
    const collectorId = trigger.getAttribute('data-daily-collector-id');
    const month = trigger.getAttribute('data-month') || state.currentMonthKey || getCurrentMonthKey();
    const account = state.accountsMap?.[collectorId] || {};
    const collectorName = account.name || account.username || `Collector ${collectorId}`;
    if (modalTitle) modalTitle.textContent = collectorName;
    if (modalSubtitle) modalSubtitle.textContent = `${monthLabel(month)} · Daily summary`;
    renderDailySummary(collectorId);
    openModal();
  });

  tableBody?.addEventListener('click', (e) => {
    const monthToggle = e.target.closest('[data-history-month-toggle]');
    if (monthToggle) {
      const month = monthToggle.getAttribute('data-history-month-toggle') || '';
      if (!month) return;
      if (state.expandedMonths.has(month)) state.expandedMonths.delete(month);
      else state.expandedMonths.add(month);
      render();
      return;
    }

    const row = e.target.closest('[data-history-collector-row]');
    if (!row) return;
    const collectorId = row.getAttribute('data-collector-id');
    const month = row.getAttribute('data-month');
    const entry = state.entries.find((r) => r.collectorId === collectorId && r.month === month);
    const collectorName = entry?.collectorName || `Collector ${collectorId}`;
    if (modalTitle) modalTitle.textContent = collectorName;
    if (modalSubtitle) modalSubtitle.textContent = month ? monthLabel(month) : '';
    renderAreaBreakdown(collectorId, collectorName, month);
    openModal();
  });

  tableBody?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('[data-history-collector-row]');
    if (!row) return;
    e.preventDefault();
    row.click();
  });

  modalClose?.addEventListener('click', closeModal);
  modalDone?.addEventListener('click', closeModal);

  loadHistory();
})();
