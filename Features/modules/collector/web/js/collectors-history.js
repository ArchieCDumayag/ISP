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
  const modal = document.getElementById('historyModal');
  const modalTitle = document.getElementById('historyModalTitle');
  const modalSubtitle = document.getElementById('historyModalSubtitle');
  const modalBody = document.getElementById('historyModalBody');
  const modalClose = document.getElementById('historyModalClose');
  const modalDone = document.getElementById('historyModalDone');

  const fmtMoney = (value) => new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
  const fmtInt = (value) => new Intl.NumberFormat('en-PH').format(Number(value || 0));
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const monthLabel = (key) => {
    const match = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
    if (!match) return String(key || '');
    return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString('en-PH', {
      month: 'short',
      year: 'numeric',
    });
  };

  const toMonthKey = (date) => (
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  );

  const parseDate = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T00:00:00`)
      : new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatDateParts = (value, fallbackMonth = '') => {
    const raw = String(value || '').trim();
    const date = parseDate(raw);
    if (!date) return { date: monthLabel(fallbackMonth) || 'Unknown date', time: '' };
    return {
      date: date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? ''
        : date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }),
    };
  };

  const getInitials = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    return parts.length === 1
      ? parts[0].slice(0, 2).toUpperCase()
      : `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  };

  const resolveDirection = (entry = {}) => {
    const direction = String(entry.direction || entry.nature || '').trim().toLowerCase();
    if (direction === 'credit' || direction === 'debit') return direction;
    const kind = String(entry.kind || entry.type || '').trim().toLowerCase();
    return ['charge', 'billing', 'debit'].includes(kind) ? 'debit' : 'credit';
  };

  const isReportableCollectorPaymentEntry = (entry = {}) => {
    const kind = String(entry.kind || entry.type || '').trim().toLowerCase();
    const status = String(entry.status || entry.paymentStatus || '').trim().toLowerCase();
    const amount = Number(entry.amount || 0);
    const excludedStatuses = [
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
    ];
    return kind === 'payment'
      && resolveDirection(entry) === 'credit'
      && status === 'approved'
      && !excludedStatuses.includes(status)
      && Number.isFinite(amount)
      && amount > 0;
  };

  const getCustomerName = (record = {}) => {
    const fullName = [record.firstName, record.middleName, record.lastName, record.suffix]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ');
    return fullName
      || String(record.customerName || record.name || record.accountName || '').trim()
      || String(record.accountNumber || '').trim()
      || 'Customer';
  };

  const getPaymentMethod = (entry = {}) => (
    String(entry.paymentMethod || entry.payment_method || entry.method || entry.channel || '').trim() || 'Cash'
  );

  const getReference = (entry = {}) => (
    String(entry.reference || entry.ref || entry.orNumber || entry.or_number || '').trim()
  );

  function buildCollectorTransactionRows(records = [], accountsMap = {}, collectorIds = new Set()) {
    const rows = [];
    (Array.isArray(records) ? records : []).forEach((record) => {
      const accountNumber = String(record?.accountNumber || '').trim();
      const customerName = getCustomerName(record);
      const area = String(record?.area || record?.coverageArea || '').trim() || 'Unassigned';
      (Array.isArray(record?.history) ? record.history : []).forEach((entry, index) => {
        if (!isReportableCollectorPaymentEntry(entry)) return;
        const collectorId = String(entry?.recordedBy?.id || entry?.recordedByUserId || entry?.recorded_by_user_id || '').trim();
        if (!collectorId || (collectorIds.size && !collectorIds.has(collectorId))) return;
        const rawDate = entry?.date || entry?.recordedAt || entry?.recorded_at || '';
        const date = parseDate(rawDate);
        if (!date) return;
        const account = accountsMap[collectorId] || {};
        const collectorName = String(
          entry?.recordedBy?.name
          || entry?.recordedBy?.username
          || account.name
          || account.username
          || `Collector ${collectorId}`
        ).trim();
        const entryId = String(entry?.id || '').trim();
        rows.push({
          id: `${accountNumber || 'account'}::${entryId || getReference(entry) || index}`,
          entryId,
          accountNumber,
          customerName,
          collectorId,
          collectorName,
          area,
          amount: Math.abs(Number(entry.amount) || 0),
          paymentMethod: getPaymentMethod(entry),
          reference: getReference(entry),
          rawDate: String(rawDate || ''),
          month: toMonthKey(date),
          timestamp: date.getTime(),
          notes: String(entry.description || entry.notes || '').trim(),
          isSummary: false,
        });
      });
    });
    return rows;
  }

  function buildCollectorPeriodStats(records = []) {
    const buckets = new Map();
    (Array.isArray(records) ? records : []).forEach((record) => {
      const area = String(record?.area || '').trim() || 'Unassigned';
      (Array.isArray(record?.history) ? record.history : []).forEach((entry) => {
        if (!isReportableCollectorPaymentEntry(entry)) return;
        const collectorId = String(entry?.recordedBy?.id || entry?.recordedByUserId || '').trim();
        const date = parseDate(entry?.date || entry?.recordedAt || '');
        if (!collectorId || !date) return;
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
        bucket.amount += Math.abs(Number(entry.amount) || 0);
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
      areas: [...bucket.areas].sort((left, right) => left.localeCompare(right)),
    }]));
  }

  function buildFallbackRows(report = {}, accountsMap = {}, areaReport = {}) {
    const areaPeriods = new Map();
    Object.entries(areaReport || {}).forEach(([areaName, detail]) => {
      const collectorId = String(detail?.collectorId || '').trim();
      Object.keys(detail?.months || {}).forEach((month) => {
        const key = `${collectorId}::${month}`;
        const areas = areaPeriods.get(key) || [];
        if (!areas.includes(areaName)) areas.push(areaName);
        areaPeriods.set(key, areas);
      });
    });
    return Object.entries(report || {}).flatMap(([collectorId, months]) => (
      Object.entries(months || {}).map(([month, amount]) => {
        const account = accountsMap[collectorId] || {};
        const areas = areaPeriods.get(`${collectorId}::${month}`) || [];
        return {
          id: `summary::${collectorId}::${month}`,
          entryId: '',
          accountNumber: '',
          customerName: 'Payment details unavailable',
          collectorId,
          collectorName: account.name || account.username || `Collector ${collectorId}`,
          area: areas.join(', ') || 'Multiple areas',
          amount: Number(amount || 0),
          paymentMethod: 'Multiple',
          reference: '',
          rawDate: '',
          month,
          timestamp: parseDate(`${month}-01`)?.getTime() || 0,
          notes: 'This is a monthly summary because individual payment records could not be loaded.',
          isSummary: true,
        };
      })
    ));
  }

  const state = {
    entries: [],
    months: [],
    paymentDetailsAvailable: false,
    page: 1,
    sortKey: 'date',
    sortDirection: 'desc',
    printing: false,
    pageBeforePrint: 1,
    lastModalTrigger: null,
  };

  function getFilteredHistoryEntries() {
    const selectedMonth = String(monthFilter?.value || '').trim();
    const selectedCollector = String(collectorFilter?.value || '').trim();
    const selectedArea = String(areaFilter?.value || '').trim().toLowerCase();
    const query = String(historySearch?.value || '').trim().toLowerCase();
    return state.entries.filter((row) => {
      if (selectedMonth && row.month !== selectedMonth) return false;
      if (selectedCollector && row.collectorId !== selectedCollector) return false;
      if (selectedArea && String(row.area || '').trim().toLowerCase() !== selectedArea) return false;
      if (!query) return true;
      return [row.customerName, row.accountNumber, row.collectorName, row.area, row.paymentMethod, row.reference, row.month, monthLabel(row.month)]
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
      if (key === 'date') result = Number(left.timestamp || 0) - Number(right.timestamp || 0);
      else if (key === 'amount') result = Number(left.amount || 0) - Number(right.amount || 0);
      else {
        result = String(left[key] || '').localeCompare(String(right[key] || ''), undefined, {
          sensitivity: 'base',
          numeric: true,
        });
      }
      if (result) return result * direction;
      return String(right.id || '').localeCompare(String(left.id || ''), undefined, { numeric: true });
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
    const total = filtered.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalPayments = state.paymentDetailsAvailable ? filtered.length : null;
    const visibleCollectors = new Set(filtered.map((row) => row.collectorId).filter(Boolean)).size;
    const selectedMonth = String(monthFilter?.value || '').trim();

    if (totalScope) totalScope.textContent = selectedMonth ? monthLabel(selectedMonth) : 'All months';
    if (totalCollected) totalCollected.textContent = `PHP ${fmtMoney(total)}`;
    if (paymentCount) paymentCount.textContent = totalPayments == null ? '—' : fmtInt(totalPayments);
    if (collectorCount) collectorCount.textContent = fmtInt(visibleCollectors);
    if (averagePayment) averagePayment.textContent = totalPayments == null ? '—' : `PHP ${fmtMoney(totalPayments ? total / totalPayments : 0)}`;
    if (tableBadge) {
      const noun = state.paymentDetailsAvailable ? (filtered.length === 1 ? 'payment' : 'payments') : 'summaries';
      tableBadge.textContent = `${fmtInt(filtered.length)} ${noun}`;
    }

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
        ? `Showing ${fmtInt(visibleStart)}-${fmtInt(visibleEnd)} of ${fmtInt(filtered.length)} approved ${state.paymentDetailsAvailable ? 'payments' : 'summaries'}`
        : 'No approved payments match the selected filters';
    }
    if (pageLabel) pageLabel.textContent = `Page ${state.page} of ${pageCount}`;
    if (prevPage) prevPage.disabled = state.page <= 1;
    if (nextPage) nextPage.disabled = state.page >= pageCount;
    updateSortControls();

    if (!visibleRows.length) {
      tableBody.innerHTML = '<tr><td colspan="8" class="collection-history-empty">No approved payments match these filters.</td></tr>';
      return;
    }

    tableBody.innerHTML = visibleRows.map((row) => {
      const dateParts = formatDateParts(row.rawDate, row.month);
      const reference = row.reference
        ? `<span class="font-monospace collection-history-reference" title="${escapeHtml(row.reference)}">${escapeHtml(row.reference)}</span>`
        : '<span class="text-secondary">—</span>';
      return `
        <tr class="collection-history-entry-row">
          <td data-label="Date"><div class="collection-history-primary-cell"><strong>${escapeHtml(dateParts.date)}</strong>${dateParts.time ? `<span>${escapeHtml(dateParts.time)}</span>` : ''}</div></td>
          <td data-label="Customer">
            <div class="d-flex align-items-center gap-2">
              <span class="avatar avatar-sm bg-blue-lt text-blue" aria-hidden="true">${escapeHtml(getInitials(row.customerName))}</span>
              <div class="collection-history-primary-cell"><strong>${escapeHtml(row.customerName)}</strong><span>${row.accountNumber ? `Account #${escapeHtml(row.accountNumber)}` : 'Monthly summary'}</span></div>
            </div>
          </td>
          <td data-label="Collector"><div class="collection-history-primary-cell"><strong>${escapeHtml(row.collectorName)}</strong><span>Collector</span></div></td>
          <td data-label="Area">${escapeHtml(row.area)}</td>
          <td class="text-end fw-semibold text-green" data-label="Amount">PHP ${fmtMoney(row.amount)}</td>
          <td data-label="Method"><span class="badge bg-secondary-lt text-secondary">${escapeHtml(row.paymentMethod)}</span></td>
          <td data-label="Reference">${reference}</td>
          <td class="text-end" data-label="Actions">
            <button class="btn btn-icon btn-ghost-primary btn-sm" type="button" data-history-view="${escapeHtml(row.id)}" aria-label="View payment details" title="View details"><i class="ti ti-eye" aria-hidden="true"></i></button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function populateSelect(select, placeholder, values, labelGetter = (value) => value) {
    if (!select) return;
    const previous = select.value;
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
    values.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = labelGetter(value);
      select.appendChild(option);
    });
    select.value = values.includes(previous) ? previous : '';
  }

  function populateFilters() {
    const months = [...new Set(state.entries.map((row) => row.month).filter(Boolean))].sort().reverse();
    const collectors = new Map();
    state.entries.forEach((row) => collectors.set(row.collectorId, row.collectorName));
    const collectorIds = [...collectors.keys()].sort((left, right) => (
      collectors.get(left).localeCompare(collectors.get(right), undefined, { sensitivity: 'base', numeric: true })
    ));
    const areas = [...new Set(state.entries.map((row) => row.area).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true }));
    state.months = months;
    populateSelect(monthFilter, 'All months', months, monthLabel);
    populateSelect(collectorFilter, 'All collectors', collectorIds, (id) => collectors.get(id));
    populateSelect(areaFilter, 'All areas', areas);
  }

  async function loadHistory() {
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="8" class="collection-history-empty">Loading...</td></tr>';
    try {
      const [reportResponse, paymentRecordsResponse] = await Promise.all([
        fetch('/api/collectors/report', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/payment-records', { credentials: 'include', cache: 'no-store' }).catch(() => null),
      ]);
      const reportPayload = await reportResponse.json().catch(() => ({}));
      if (!reportResponse.ok) throw new Error(reportPayload?.error || 'Could not load collector history');

      const report = reportPayload.report || {};
      const accountsMap = reportPayload.accountsMap || {};
      const collectorIds = new Set(Object.keys(report));
      let paymentRecords = [];
      if (paymentRecordsResponse?.ok) {
        const paymentPayload = await paymentRecordsResponse.json().catch(() => ({}));
        paymentRecords = Array.isArray(paymentPayload?.records) ? paymentPayload.records : [];
      }

      state.paymentDetailsAvailable = Boolean(paymentRecordsResponse?.ok);
      buildCollectorPeriodStats(paymentRecords);
      state.entries = state.paymentDetailsAvailable
        ? buildCollectorTransactionRows(paymentRecords, accountsMap, collectorIds)
        : buildFallbackRows(report, accountsMap, reportPayload.areaReport || {});
      populateFilters();
      state.page = 1;
      render();
    } catch (error) {
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="8" class="collection-history-empty text-danger">${escapeHtml(error?.message || 'Error loading collector history')}</td></tr>`;
      }
      if (summary) summary.textContent = 'Collector history could not be loaded';
      if (tableBadge) tableBadge.textContent = 'Unavailable';
    }
  }

  function resetPageAndRender() {
    state.page = 1;
    render();
  }

  [monthFilter, collectorFilter, areaFilter].forEach((control) => control?.addEventListener('change', resetPageAndRender));
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
    resetPageAndRender();
  });

  document.querySelectorAll('[data-history-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.getAttribute('data-history-sort') || 'date';
      if (state.sortKey === key) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      else {
        state.sortKey = key;
        state.sortDirection = ['customerName', 'collectorName', 'area'].includes(key) ? 'asc' : 'desc';
      }
      resetPageAndRender();
    });
  });

  const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  historyExportCsv?.addEventListener('click', () => {
    const rows = sortHistoryEntries(getFilteredHistoryEntries());
    if (!rows.length) return;
    const lines = [
      ['Date', 'Customer', 'Account Number', 'Collector', 'Area', 'Amount', 'Method', 'Reference'],
      ...rows.map((row) => [row.rawDate || monthLabel(row.month), row.customerName, row.accountNumber, row.collectorName, row.area, Number(row.amount || 0).toFixed(2), row.paymentMethod, row.reference]),
    ].map((row) => row.map(csvCell).join(','));
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `collector-history-${monthFilter?.value || 'all-months'}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  });

  historyPrint?.addEventListener('click', () => {
    state.pageBeforePrint = state.page;
    state.printing = true;
    state.page = 1;
    render();
    setTimeout(() => window.print(), 0);
  });
  window.addEventListener('afterprint', () => {
    if (!state.printing) return;
    state.printing = false;
    state.page = state.pageBeforePrint;
    render();
  });

  function detailItem(label, value, extraClass = '') {
    return `<div class="datagrid-item ${extraClass}"><div class="datagrid-title">${escapeHtml(label)}</div><div class="datagrid-content">${escapeHtml(value || '—')}</div></div>`;
  }

  function openPaymentDetails(row, trigger) {
    if (!modal || !modalBody || !row) return;
    state.lastModalTrigger = trigger || null;
    const dateParts = formatDateParts(row.rawDate, row.month);
    if (modalTitle) modalTitle.textContent = row.isSummary ? 'Monthly collection summary' : row.customerName;
    if (modalSubtitle) modalSubtitle.textContent = `${row.collectorName} · ${dateParts.date}${dateParts.time ? `, ${dateParts.time}` : ''}`;
    modalBody.innerHTML = `
      ${row.isSummary ? '<div class="alert alert-warning" role="status"><i class="ti ti-alert-triangle me-2" aria-hidden="true"></i>Individual payment details are temporarily unavailable; this row shows the canonical monthly collector total.</div>' : ''}
      <div class="datagrid collection-history-detail-grid">
        ${detailItem('Customer', row.customerName)}
        ${detailItem('Account #', row.accountNumber)}
        ${detailItem('Collector', row.collectorName)}
        ${detailItem('Service area', row.area)}
        ${detailItem('Amount', `PHP ${fmtMoney(row.amount)}`, 'collection-history-detail-amount')}
        ${detailItem('Payment method', row.paymentMethod)}
        ${detailItem('Reference / OR', row.reference)}
        ${detailItem('Status', 'Approved')}
        ${detailItem('Recorded', `${dateParts.date}${dateParts.time ? `, ${dateParts.time}` : ''}`)}
        ${detailItem('Notes', row.notes)}
      </div>
    `;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    modalClose?.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    state.lastModalTrigger?.focus?.();
    state.lastModalTrigger = null;
  }

  tableBody?.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-history-view]');
    if (!trigger) return;
    const row = state.entries.find((entry) => entry.id === trigger.getAttribute('data-history-view'));
    openPaymentDetails(row, trigger);
  });
  modalClose?.addEventListener('click', closeModal);
  modalDone?.addEventListener('click', closeModal);

  loadHistory();
})();
