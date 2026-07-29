(function () {
  const jobTableBody = document.getElementById('jobTableBody');
  const jobFilterChips = Array.from(document.querySelectorAll('[data-job-filter]'));
  const toast = document.getElementById('techToast');
  const openJobModalBtn = document.getElementById('openJobModal');
  const jobModal = document.getElementById('jobModal');
  const jobModalClose = document.getElementById('jobModalClose');
  const jobModalCancel = document.getElementById('jobModalCancel');
  const jobModalForm = document.getElementById('jobModalForm');
  const jobModalEyebrow = document.getElementById('jobModalEyebrow');
  const jobModalTitle = document.getElementById('jobModalTitle');
  const jobModalSubmit = document.getElementById('jobModalSubmit');
  const jobTypeSelect = document.getElementById('jobType');
  const jobTechSelect = document.getElementById('jobTech');
  const jobScheduleInput = document.getElementById('jobSchedule');
  const jobNotesInput = document.getElementById('jobNotes');
  const assignJobModal = document.getElementById('assignJobModal');
  const assignJobModalClose = document.getElementById('assignJobModalClose');
  const assignJobModalCancel = document.getElementById('assignJobModalCancel');
  const assignJobModalForm = document.getElementById('assignJobModalForm');
  const assignJobTechnicianSelect = document.getElementById('assignJobTechnician');
  const assignJobLabel = document.getElementById('assignJobLabel');
  const jobPageSizeSelect = document.getElementById('jobPageSize');
  const jobPrevPageBtn = document.getElementById('jobPrevPage');
  const jobNextPageBtn = document.getElementById('jobNextPage');
  const jobPageInfo = document.getElementById('jobPageInfo');
  const jobFooterSummary = document.getElementById('jobFooterSummary');
  const UNASSIGNED_TECHNICIAN_VALUES = new Set(['', 'pending assignment', 'unassigned']);

  const bodyElement = document.body;
  const refreshModalActiveState = () => {
    const activeModalCount = document.querySelectorAll('.modal-overlay.active, .modal.active').length;
    bodyElement.classList.toggle('modal-active', activeModalCount > 0);
  };

  const state = {
    jobs: [],
    technicians: []
  };

  let jobStatusFilter = 'all';
  let activeJobId = null;
  let editingJobId = null;
  let jobModalMode = 'create';
  const pagination = {
    page: 1,
    pageSize: Number(localStorage.getItem('jobPageSize') || 10)
  };

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

  const refreshSidebarWorkBadges = () => {
    if (typeof window.refreshSidebarWorkBadges === 'function') {
      window.refreshSidebarWorkBadges();
    }
  };

  const initials = (label = '') =>
    (label || 'NA')
      .split(/[\s-]+/)
      .map((p) => p.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();

  const escapeHtml = (value = '') => {
    const text = value === undefined || value === null ? '' : String(value);
    return text.replace(/[&<>"']/g, (match) => {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return map[match] || match;
    });
  };

  const hasAccountRole = (account, role) => {
    const wanted = String(role || '').trim().toLowerCase();
    const values = Array.isArray(account?.roles)
      ? account.roles
      : String(account?.role || '').split(/[,/|;]+|\s+\+\s+|\s+and\s+/i);
    return values.some((value) => String(value || '').trim().toLowerCase() === wanted);
  };

  const formatDate = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d)) return '-';
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const clearDynamicSelectOptions = (selectEl) => {
    if (!selectEl) return;
    Array.from(selectEl.options || []).forEach((option) => {
      if (option.dataset.dynamic === 'true') option.remove();
    });
  };

  const setSelectValue = (selectEl, value = '') => {
    if (!selectEl) return;
    const nextValue = String(value || '').trim();
    clearDynamicSelectOptions(selectEl);
    if (!nextValue) {
      selectEl.value = '';
      return;
    }
    const existing = Array.from(selectEl.options || []).find((option) => option.value === nextValue);
    if (existing) {
      selectEl.value = nextValue;
      return;
    }
    const option = new Option(nextValue, nextValue, true, true);
    option.dataset.dynamic = 'true';
    selectEl.add(option);
    selectEl.value = nextValue;
  };

  const toDateInputValue = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
  };

  const normalizeTechnician = (value = '') => String(value || '').trim();

  const hasAssignedTechnician = (value = '') => {
    const normalized = normalizeTechnician(value).toLowerCase();
    return Boolean(normalized) && !UNASSIGNED_TECHNICIAN_VALUES.has(normalized);
  };

  const statusPill = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'scheduled') return '<span class="tech-status"><span class="status-dot amber"></span>Scheduled</span>';
    if (normalized === 'in-progress') return '<span class="tech-status"><span class="status-dot green"></span>In Progress</span>';
    if (normalized === 'done') return '<span class="tech-status"><span class="status-dot gray"></span>Done</span>';
    return '<span class="tech-status"><span class="status-dot gray"></span>Pending</span>';
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

  const jobTypeChip = (type) => {
    return `<span class="job-type-pill">${jobTypeLabel(type)}</span>`;
  };

  const derivedStatus = (job) => {
    if ((job.status || '').toLowerCase() === 'done') return 'done';
    if (!hasAssignedTechnician(job?.technician)) return 'scheduled';
    const sched = new Date(job.schedule);
    if (!Number.isNaN(sched) && sched > new Date()) return 'scheduled';
    return 'in-progress';
  };

  const setJobModalMode = (mode = 'create') => {
    jobModalMode = mode === 'edit' ? 'edit' : 'create';
    if (jobModalEyebrow) {
      jobModalEyebrow.textContent = jobModalMode === 'edit' ? 'Edit Job' : 'New Job';
    }
    if (jobModalTitle) {
      jobModalTitle.textContent = jobModalMode === 'edit' ? 'Update job details' : 'Add and assign a job';
    }
    if (jobModalSubmit) {
      jobModalSubmit.innerHTML = jobModalMode === 'edit'
        ? '<i class="fa-solid fa-floppy-disk"></i> Save Changes'
        : '<i class="fa-solid fa-paper-plane"></i> Assign Job';
    }
    if (jobTechSelect) {
      jobTechSelect.required = jobModalMode !== 'edit';
    }
  };

  const populateTechnicians = (selectEl, { selectedValue = '', includeUnassigned = false, placeholder = 'Select technician' } = {}) => {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    selectEl.add(new Option(includeUnassigned ? 'Unassigned' : placeholder, ''));
    const list = Array.isArray(state.technicians) ? state.technicians : [];
    list.forEach((t) => {
      const label = t.username || t.name || `Technician ${t.id || ''}`.trim() || 'Technician';
      const option = new Option(label, label);
      if (label === selectedValue) option.selected = true;
      selectEl.add(option);
    });
  };

  const loadTechnicians = async () => {
    try {
      const res = await fetch('/api/accounts', { credentials: 'include', cache: 'no-store' });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Failed to load technicians');
      const accounts = Array.isArray(data.accounts) ? data.accounts : Array.isArray(data) ? data : [];
      state.technicians = accounts.filter(
        (a) => hasAccountRole(a, 'technician')
      );
      populateTechnicians(jobTechSelect, {
        selectedValue: normalizeTechnician(jobTechSelect?.value),
        includeUnassigned: jobModalMode === 'edit'
      });
      populateTechnicians(assignJobTechnicianSelect, { includeUnassigned: true });
    } catch (err) {
      console.error('Load technicians failed:', err);
      state.technicians = [];
      populateTechnicians(jobTechSelect, { includeUnassigned: jobModalMode === 'edit' });
      populateTechnicians(assignJobTechnicianSelect, { includeUnassigned: true });
      showToast('Failed to load technicians.');
    }
  };

  const parseJsonSafe = async (res) => {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (_e) {
      throw new Error(`Unexpected response (${res.status})`);
    }
  };

  const loadJobs = async () => {
    try {
      const res = await fetch('/api/jobs', { credentials: 'include', cache: 'no-store' });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Failed to load jobs');
      state.jobs = (Array.isArray(data.jobs) ? data.jobs : Array.isArray(data) ? data : []).map((job) => {
        ensureJobNumber(job);
        job.description = job.description || job.notes || '';
        return job;
      });
      renderJobs();
      refreshSidebarWorkBadges();
    } catch (err) {
      console.error('Load jobs failed:', err);
      showToast('Failed to load jobs.');
    }
  };

  const formatJobNumber = (id) => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) return '';
    return `JOB-${String(Math.trunc(numericId)).padStart(8, '0')}`;
  };

  const isTicketOrigin = (job) =>
    String(job?.origin || (job?.ticketId ? 'ticket' : '')).trim().toLowerCase() === 'ticket';

  const ensureJobNumber = (job) => {
    if (!job) return 'JOB-00000000';
    if (isTicketOrigin(job)) {
      return String(job.ticketNumber || '').trim() || 'Pending';
    }
    if (!job.jobNumber) {
      job.jobNumber = formatJobNumber(job.id) || '';
    }
    return job.jobNumber || 'Pending';
  };

  const addJob = async (payload) => {
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Failed to add job');
      const job = data.job || data;
      ensureJobNumber(job);
      state.jobs.unshift(job);
      renderJobs();
      refreshSidebarWorkBadges();
      showToast('Job assigned.');
      return true;
    } catch (err) {
      console.error('Add job failed:', err);
      showToast('Failed to add job.');
      return false;
    }
  };

  const updateJob = async (id, payload) => {
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Failed to update job');
      const job = data.job || data;
      ensureJobNumber(job);
      const idx = state.jobs.findIndex((j) => Number(j.id) === Number(id));
      if (idx >= 0) {
        state.jobs[idx] = job;
        renderJobs();
      }
      refreshSidebarWorkBadges();
      showToast('Job updated.');
      return true;
    } catch (err) {
      console.error('Update job failed:', err);
      showToast(err.message || 'Failed to update job.');
      return false;
    }
  };

  const assignJob = async (id, technician) => {
    try {
      const res = await fetch(`/api/jobs/${id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ technician })
      });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Failed to assign job');
      const job = data.job || data;
      const idx = state.jobs.findIndex((j) => Number(j.id) === Number(id));
      if (idx >= 0) {
        state.jobs[idx] = job;
        renderJobs();
      }
      refreshSidebarWorkBadges();
      showToast(technician ? 'Technician assigned.' : 'Assignment cleared.');
    } catch (err) {
      console.error('Assign job failed:', err);
      showToast(err.message || 'Failed to assign job.');
    }
  };

  const deleteJob = async (id) => {
    try {
      const res = await fetch(`/api/jobs/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to remove job');
      state.jobs = state.jobs.filter((j) => Number(j.id) !== Number(id));
      renderJobs();
      refreshSidebarWorkBadges();
      showToast('Job removed.');
    } catch (err) {
      console.error('Delete job failed:', err);
      showToast('Failed to remove job.');
    }
  };

  const openModal = () => {
    if (!jobModal) return;
    editingJobId = null;
    setJobModalMode('create');
    jobModalForm?.reset();
    setSelectValue(jobTypeSelect, '');
    populateTechnicians(jobTechSelect);
    jobModal.classList.add('active');
    jobModal.setAttribute('aria-hidden', 'false');
    refreshModalActiveState();
    jobModal.querySelector('input, select, textarea')?.focus();
  };

  const closeModal = () => {
    if (!jobModal) return;
    jobModal.classList.remove('active');
    jobModal.setAttribute('aria-hidden', 'true');
    jobModalForm?.reset();
    setSelectValue(jobTypeSelect, '');
    populateTechnicians(jobTechSelect);
    editingJobId = null;
    setJobModalMode('create');
    refreshModalActiveState();
  };

  const openEditModal = (job) => {
    if (!jobModal || !job) return;
    editingJobId = Number(job.id) || null;
    setJobModalMode('edit');
    jobModalForm?.reset();
    setSelectValue(jobTypeSelect, job?.type || '');
    populateTechnicians(jobTechSelect, {
      selectedValue: hasAssignedTechnician(job?.technician) ? normalizeTechnician(job.technician) : '',
      includeUnassigned: true
    });
    if (jobScheduleInput) {
      jobScheduleInput.value = toDateInputValue(job?.schedule);
    }
    if (jobNotesInput) {
      jobNotesInput.value = job?.description || job?.notes || '';
    }
    jobModal.classList.add('active');
    jobModal.setAttribute('aria-hidden', 'false');
    refreshModalActiveState();
    jobModal.querySelector('input, select, textarea')?.focus();
  };

  const openAssignModal = (job) => {
    if (!assignJobModal) return;
    activeJobId = job?.id || null;
    if (assignJobLabel) {
      assignJobLabel.textContent = `${ensureJobNumber(job)} - ${jobTypeLabel(job?.type)}`;
    }
    populateTechnicians(assignJobTechnicianSelect, {
      selectedValue: hasAssignedTechnician(job?.technician) ? normalizeTechnician(job.technician) : '',
      includeUnassigned: true
    });
    assignJobModal.classList.add('active');
    assignJobModal.setAttribute('aria-hidden', 'false');
    refreshModalActiveState();
    assignJobTechnicianSelect?.focus();
  };

  const closeAssignModal = () => {
    if (!assignJobModal) return;
    assignJobModal.classList.remove('active');
    assignJobModal.setAttribute('aria-hidden', 'true');
    assignJobModalForm?.reset();
    activeJobId = null;
    refreshModalActiveState();
  };

  const renderJobs = () => {
    if (!jobTableBody) return;
    const rows = state.jobs.filter((job) => {
      if (jobStatusFilter === 'all') return true;
      return derivedStatus(job) === jobStatusFilter;
    });

    const activeRows = rows.filter((job) => derivedStatus(job) !== 'done');

    const total = activeRows.length;
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
    if (pagination.page > totalPages) pagination.page = totalPages;
    const start = (pagination.page - 1) * pagination.pageSize;
    const end = start + pagination.pageSize;
    const pageRows = activeRows.slice(start, end);

    if (!pageRows.length) {
      jobTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:14px;">No jobs yet.</td></tr>`;
      if (jobPageInfo) jobPageInfo.textContent = `1 / 1`;
      if (jobFooterSummary) jobFooterSummary.textContent = 'Showing 0 of 0 jobs';
      if (jobPrevPageBtn) jobPrevPageBtn.disabled = true;
      if (jobNextPageBtn) jobNextPageBtn.disabled = true;
      return;
    }

    jobTableBody.innerHTML = pageRows
      .map((job, idx) => {
        const jobNumber = ensureJobNumber(job);
        const descriptionValue = escapeHtml((job.description || job.notes || '').trim());
        const descriptionCell = descriptionValue
          ? `<p>${descriptionValue}</p>`
          : '<span class="tech-job__subject">No description</span>';
        const technicianName = hasAssignedTechnician(job?.technician) ? normalizeTechnician(job.technician) : '';
        const technicianCell = technicianName
          ? `
              <div class="tech-person">
                <div class="tech-avatar">${initials(technicianName)}</div>
                <span>${escapeHtml(technicianName)}</span>
              </div>
            `
          : '<span class="tech-job__subject">Pending Assignment</span>';

        return `
          <tr data-job-id="${job.id}" class="editable-row" title="Click row to edit">
            <td>${start + idx + 1}</td>
            <td>${jobNumber}</td>
            <td>
              <div class="tech-job">
                <h4>${escapeHtml(jobTypeLabel(job.type))}</h4>
              </div>
            </td>
            <td>
              ${technicianCell}
            </td>
            <td>${formatDate(job.schedule)}</td>
            <td class="description-cell">${descriptionCell}</td>
            <td>${statusPill(derivedStatus(job))}</td>
            <td>
              <div class="table-actions">
                <button class="icon-btn" type="button" data-action="assign" title="Assign"><i class="fa-solid fa-user-plus"></i></button>
                <button class="icon-btn danger" type="button" data-action="remove" title="Remove"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    if (jobPageInfo) jobPageInfo.textContent = `${pagination.page} / ${totalPages}`;
    if (jobFooterSummary) jobFooterSummary.textContent = `Showing ${start + 1}-${Math.min(end, total)} of ${total}`;
    if (jobPrevPageBtn) jobPrevPageBtn.disabled = pagination.page <= 1;
    if (jobNextPageBtn) jobNextPageBtn.disabled = pagination.page >= totalPages;
  };

  const renderHistory = () => {
    // history rendering removed from this page; handled in job-history page
  };

  const wireEvents = () => {
    openJobModalBtn?.addEventListener('click', () => openModal());
    jobModalClose?.addEventListener('click', () => closeModal());
    jobModalCancel?.addEventListener('click', () => closeModal());
    jobModal?.addEventListener('click', (e) => {
      if (e.target === jobModal) closeModal();
    });
    assignJobModalClose?.addEventListener('click', () => closeAssignModal());
    assignJobModalCancel?.addEventListener('click', () => closeAssignModal());
    assignJobModal?.addEventListener('click', (e) => {
      if (e.target === assignJobModal) closeAssignModal();
    });

    jobPageSizeSelect?.addEventListener('change', () => {
      pagination.pageSize = Number(jobPageSizeSelect.value) || 10;
      localStorage.setItem('jobPageSize', pagination.pageSize);
      pagination.page = 1;
      renderJobs();
    });

    jobPrevPageBtn?.addEventListener('click', () => {
      if (pagination.page > 1) {
        pagination.page -= 1;
        renderJobs();
      }
    });

    jobNextPageBtn?.addEventListener('click', () => {
      pagination.page += 1;
      renderJobs();
    });

    jobModalForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const unlock = window.withSubmitLock ? window.withSubmitLock(jobModalForm, { label: 'Saving...' }) : null;
      if (window.withSubmitLock && !unlock) return;
      const formData = new FormData(jobModalForm);
      const descriptionValue = (formData.get('notes') || '').trim();
      const payload = {
        type: formData.get('type') || '',
        technician: formData.get('technician') || '',
        schedule: formData.get('schedule') || new Date().toISOString().slice(0, 10),
        notes: descriptionValue,
        description: descriptionValue
      };
      if (!payload.type || !payload.schedule || (jobModalMode !== 'edit' && !payload.technician)) {
        showToast('Please complete the required fields.');
        if (unlock) unlock();
        return;
      }
      const request = jobModalMode === 'edit' && editingJobId
        ? updateJob(editingJobId, payload)
        : addJob(payload);
      request
        .then((success) => {
          if (success) closeModal();
        })
        .finally(() => {
          if (unlock) unlock();
        });
    });

    assignJobModalForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const unlock = window.withSubmitLock ? window.withSubmitLock(assignJobModalForm, { label: 'Saving...' }) : null;
      if (window.withSubmitLock && !unlock) return;
      if (!activeJobId) {
        if (unlock) unlock();
        return;
      }
      const formData = new FormData(assignJobModalForm);
      const technician = formData.get('technician') || '';
      assignJob(activeJobId, technician)
        .then(() => closeAssignModal())
        .finally(() => {
          if (unlock) unlock();
        });
    });

    jobTableBody?.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr[data-job-id]');
      if (!tr) return;
      const id = Number(tr?.getAttribute('data-job-id'));
      const idx = state.jobs.findIndex((j) => j.id === id);
      if (idx < 0) return;
      const interactiveElement = e.target.closest('button, a, input, select, textarea, label');
      if (!interactiveElement) {
        openEditModal(state.jobs[idx]);
        return;
      }
      const btn = interactiveElement.closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'assign') {
        openAssignModal(state.jobs[idx]);
        return;
      }
      if (action === 'remove') {
        const proceed = window.appConfirm
          ? await window.appConfirm('Permanently delete this job?', { title: 'Delete Job' })
          : window.confirm('Permanently delete this job?');
        if (!proceed) return;
        deleteJob(id);
      }
    });

    jobFilterChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        jobFilterChips.forEach((c) => {
          const active = c === chip;
          c.classList.toggle('active', active);
          c.setAttribute('aria-checked', active ? 'true' : 'false');
        });
      jobStatusFilter = chip.getAttribute('data-job-filter') || 'all';
      pagination.page = 1;
      renderJobs();
    });
    });
  };

  renderJobs();
  wireEvents();
  if (jobPageSizeSelect) {
    jobPageSizeSelect.value = String(pagination.pageSize);
  }
  loadJobs();
  loadTechnicians();
})();
