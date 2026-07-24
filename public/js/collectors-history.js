(function () {
  const monthFilter = document.getElementById('monthFilter');
  const tableBody = document.getElementById('historyTableBody');
  const summary = document.getElementById('historySummary');
  const totalScope = document.getElementById('historyTotalScope');
  const totalCollected = document.getElementById('historyTotalCollected');
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
    expandedMonths: new Set(),
  };

  function getDefaultExpandedMonths(selectedMonth = '') {
    if (selectedMonth) return new Set([selectedMonth]);
    const currentMonthKey = state.currentMonthKey || getCurrentMonthKey();
    return state.months.includes(currentMonthKey) ? new Set([currentMonthKey]) : new Set();
  }

  function render() {
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

  async function loadHistory() {
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="3" class="collection-history-empty">Loading...</td></tr>';
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

      state.currentMonthKey = getCurrentMonthKey();
      state.accountsMap = accountsMap;
      state.paymentRecords = paymentRecords;
      state.dailySummaryByCollector = buildCollectorDailySummary(paymentRecords, state.currentMonthKey);
      state.currentAreaSummaryByCollector = buildCollectorAreaSummary(paymentRecords, state.currentMonthKey);

      renderMonthlyCollectionsReport(report, accountsMap, areaReport);

      const entries = [];
      Object.entries(report).forEach(([collectorId, months]) => {
        Object.entries(months || {}).forEach(([month, amount]) => {
          const val = Number(amount || 0);
          if (!val) return;
          const acc = accountsMap[collectorId] || {};
          const name = acc.name || acc.username || `Collector ${collectorId}`;
          entries.push({ collectorId, collectorName: name, month, amount: val });
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
      render();
    } catch (err) {
      if (reportContainer) {
        reportContainer.innerHTML = `<p class="empty-copy text-danger">${err.message || 'Error loading report'}</p>`;
      }
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="3" class="collection-history-empty text-danger">${err.message ||
          'Error loading data'}</td></tr>`;
      }
      if (summary) summary.textContent = '';
    }
  }

  monthFilter?.addEventListener('change', () => {
    const selectedMonth = monthFilter?.value || '';
    state.expandedMonths = getDefaultExpandedMonths(selectedMonth);
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
    if (modalSubtitle) modalSubtitle.textContent = `${monthLabel(month)} • Daily summary`;
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
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  loadHistory();
})();
