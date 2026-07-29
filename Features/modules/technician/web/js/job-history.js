(function () {
  const historyTableBody = document.getElementById('historyTableBody');
  const toast = document.getElementById('techToast');
  const pageSizeSelect = document.getElementById('historyPageSize');
  const historySummary = document.getElementById('historySummary');
  const historyPrev = document.getElementById('historyPrev');
  const historyNext = document.getElementById('historyNext');
  const historyPageInfo = document.getElementById('historyPageInfo');
  const historySearch = document.getElementById('historySearch');
  const historyStatusChips = Array.from(document.querySelectorAll('[data-history-status]'));

  const showToast = (msg) => {
    if (typeof window.appToast === 'function') {
      window.appToast(msg, { type: 'info' });
      return;
    }
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 2000);
  };

  const escapeHtml = (value = '') => {
    const text = value === undefined || value === null ? '' : String(value);
    return text.replace(/[&<>"']/g, (match) => {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return map[match] || match;
    });
  };

  const canUndo = (job) => {
    const done = new Date(job.doneAt || job.updatedAt || job.schedule);
    if (Number.isNaN(done)) return false;
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    return Date.now() - done.getTime() <= threeDaysMs;
  };

  const undoJob = async (id) => {
    try {
      const res = await fetch(`/api/jobs/${id}/undo`, { method: 'PATCH', credentials: 'include' });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Failed to undo');
      showToast('History item restored to active.');
      loadHistory();
    } catch (err) {
      console.error('Undo failed:', err);
      showToast(err.message || 'Cannot undo history item.');
    }
  };

  const initials = (label = '') =>
    (label || 'NA')
      .split(/[\s-]+/)
      .map((p) => p.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();

  const formatDate = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d)) return '-';
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const jobTypeLabel = (type) => {
    const t = String(type || '').toLowerCase();
    const labelMap = {
      install: 'Install',
      repair: 'Repair',
      relocate: 'Relocate',
      upgrade: 'Relocate',
      'fibre-break': 'Fibre break',
      'mainline-maintenance': 'Mainline maintenance',
      disconnect: 'Disconnect',
      ticket: 'Ticket'
    };
    return labelMap[t] || 'General';
  };

  const jobTypeChip = (type) => `<span class="job-type-pill">${jobTypeLabel(type)}</span>`;

  const parseJsonSafe = async (res) => {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (_e) {
      throw new Error(`Unexpected response (${res.status})`);
    }
  };

  const state = {
    jobs: []
  };

  const formatJobNumber = (id) => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) return '';
    return `JOB-${String(Math.trunc(numericId)).padStart(8, '0')}`;
  };

  const isTicketOrigin = (job) =>
    String(job?.origin || (job?.ticketId ? 'ticket' : '')).trim().toLowerCase() === 'ticket';

  const originFilterValue = (job) => (isTicketOrigin(job) ? 'ticket' : 'job');

  const ensureJobNumber = (job) => {
    if (!job) return '';
    if (isTicketOrigin(job)) return '';
    if (!job.jobNumber) {
      job.jobNumber = formatJobNumber(job.id) || '';
    }
    return job.jobNumber || '';
  };

  const getHistoryReference = (job) => {
    if (!job) return 'Pending';
    const origin = originFilterValue(job);
    const ticketNumber = String(job.ticketNumber || '').trim();
    if (origin === 'ticket' && ticketNumber) return ticketNumber;
    return ensureJobNumber(job);
  };

  const pagination = {
    page: 1,
    pageSize: Number(localStorage.getItem('historyPageSize')) || 10
  };

  if (pageSizeSelect) {
    const hasSavedOption = Array.from(pageSizeSelect.options || []).some(
      (opt) => Number(opt.value) === pagination.pageSize
    );
    if (hasSavedOption) {
      pageSizeSelect.value = String(pagination.pageSize);
    } else {
      pagination.pageSize = Number(pageSizeSelect.value) || pagination.pageSize;
    }
  }

  const filters = {
    search: '',
    from: '',
    to: '',
    origin: ''
  };

  const completedDate = (job) => new Date(job.doneAt || job.updatedAt || job.schedule);

  const matchesFilters = (job) => {
    const term = (filters.search || '').trim().toLowerCase();
    if (term) {
      const searchable = [
        jobTypeLabel(job.type),
        job.ticketSubject,
        job.subject,
        job.technician,
        job.description,
        job.notes,
        job.ticketNumber,
        job.jobNumber,
        job.id
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!searchable.includes(term)) return false;
    }
    if (filters.origin) {
      const jobOrigin = originFilterValue(job);
      if (jobOrigin !== filters.origin) return false;
    }
    const done = completedDate(job);
    if (!Number.isNaN(done)) {
      if (filters.from) {
        const from = new Date(filters.from);
        if (!Number.isNaN(from) && done < from) return false;
      }
      if (filters.to) {
        const to = new Date(filters.to);
        if (!Number.isNaN(to)) {
          const endOfDay = new Date(to);
          endOfDay.setHours(23, 59, 59, 999);
          if (done > endOfDay) return false;
        }
      }
    }
    return true;
  };

  const updateFooter = (total, start, end, pageCount) => {
    if (historySummary) {
      historySummary.textContent = total
        ? `Showing ${start}-${end} of ${total} history records`
        : 'Showing 0 of 0 history records';
    }
    if (historyPageInfo) {
      historyPageInfo.textContent = `Page ${pagination.page} of ${pageCount}`;
    }
    if (historyPrev) historyPrev.disabled = pagination.page <= 1 || total === 0;
    if (historyNext) historyNext.disabled = pagination.page >= pageCount || total === 0;
  };

  const filteredJobs = () =>
    state.jobs
      .filter((j) => String(j.status || '').toLowerCase() === 'done')
      .filter(matchesFilters);

  const renderHistory = () => {
    if (!historyTableBody) return;
    const doneJobs = filteredJobs();
    const total = doneJobs.length;
    const pageSize = pagination.pageSize || 10;
    const pageCount = total ? Math.ceil(total / pageSize) : 1;
    pagination.page = Math.min(Math.max(pagination.page, 1), pageCount);
    const startIndex = total ? (pagination.page - 1) * pageSize : 0;
    const pageSlice = total ? doneJobs.slice(startIndex, startIndex + pageSize) : [];

    if (!pageSlice.length) {
      historyTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:14px;">No history yet.</td></tr>`;
      updateFooter(total, 0, 0, pageCount);
      return;
    }

    historyTableBody.innerHTML = pageSlice
      .map((job, idx) => {
        const historyReference = escapeHtml(getHistoryReference(job));
        const jobPrimary = escapeHtml(jobTypeLabel(job.type));
        const jobSecondary = escapeHtml(job.ticketSubject || job.subject || '');
        const subjectHtml = jobSecondary ? `<p class="tech-job__subject">${jobSecondary}</p>` : '';
        const descriptionValue = escapeHtml((job.description || job.notes || '').trim());
        const descriptionCell = descriptionValue
          ? `<p>${descriptionValue}</p>`
          : '<span class="tech-job__subject">No description</span>';

        return `
          <tr data-job-id="${job.id}">
            <td>${startIndex + idx + 1}</td>
            <td>${historyReference}</td>
            <td>
              <div class="tech-job">
                <h4>${jobPrimary}</h4>
                ${subjectHtml}
              </div>
            </td>
            <td>
              <div class="tech-person">
                <div class="tech-avatar">${initials(job.technician)}</div>
                <span>${escapeHtml(job.technician)}</span>
              </div>
            </td>
            <td>${formatDate(job.doneAt || job.updatedAt || job.schedule)}</td>
            <td class="description-cell">${descriptionCell}</td>
            <td>
              ${canUndo(job) ? `<button class="ghost-btn small" data-action="undo" data-id="${job.id}"><i class="fa-solid fa-rotate-left"></i> Undo</button>` : ''}
            </td>
          </tr>
        `;
      })
      .join('');

    const displayStart = startIndex + 1;
    const displayEnd = Math.min(startIndex + pageSlice.length, total);
    updateFooter(total, displayStart, displayEnd, pageCount);
  };

  const loadHistory = async () => {
    if (!historyTableBody) return;
      historyTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:14px;">Loading...</td></tr>`;
    try {
      const res = await fetch('/api/jobs', { credentials: 'include', cache: 'no-store' });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Failed to load jobs');
      const jobsArray = Array.isArray(data.jobs) ? data.jobs : Array.isArray(data) ? data : [];
      state.jobs = jobsArray.map((job) => {
        ensureJobNumber(job);
        return job;
      });
      pagination.page = 1;
      renderHistory();
    } catch (err) {
      console.error('Load history failed:', err);
      historyTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:14px;">Failed to load history.</td></tr>`;
      showToast('Failed to load history.');
    }
  };

  loadHistory();

  historyTableBody?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="undo"]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    if (!id) return;
    undoJob(id).then(() => loadHistory());
  });

  document.getElementById('historyFrom')?.addEventListener('change', (e) => {
    filters.from = e.target.value || '';
    pagination.page = 1;
    renderHistory();
  });

  document.getElementById('historyTo')?.addEventListener('change', (e) => {
    filters.to = e.target.value || '';
    pagination.page = 1;
    renderHistory();
  });

  historySearch?.addEventListener('input', (e) => {
    filters.search = e.target.value || '';
    pagination.page = 1;
    renderHistory();
  });

  historyStatusChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      historyStatusChips.forEach((c) => {
        const active = c === chip;
        c.classList.toggle('active', active);
        c.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      const status = chip.getAttribute('data-history-status') || 'all';
      filters.origin = status === 'all' ? '' : status;
      pagination.page = 1;
      renderHistory();
    });
  });

  pageSizeSelect?.addEventListener('change', (e) => {
    const nextSize = Number(e.target.value) || 10;
    pagination.pageSize = nextSize;
    pagination.page = 1;
    localStorage.setItem('historyPageSize', String(nextSize));
    renderHistory();
  });

  historyPrev?.addEventListener('click', () => {
    if (pagination.page <= 1) return;
    pagination.page -= 1;
    renderHistory();
  });

  historyNext?.addEventListener('click', () => {
    const total = filteredJobs().length;
    const pageCount = total ? Math.ceil(total / (pagination.pageSize || 10)) : 1;
    if (pagination.page >= pageCount) return;
    pagination.page += 1;
    renderHistory();
  });
})();
