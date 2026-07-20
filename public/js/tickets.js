(function () {
  const ticketTableBody = document.getElementById('ticketTableBody');
  const ticketFilterChips = Array.from(document.querySelectorAll('[data-ticket-filter]'));
  const toast = document.getElementById('ticketToast');
  const openTicketModalBtn = document.getElementById('openTicketModal');
  const ticketModal = document.getElementById('ticketModal');
  const ticketModalClose = document.getElementById('ticketModalClose');
  const ticketModalCancel = document.getElementById('ticketModalCancel');
  const ticketModalForm = document.getElementById('ticketModalForm');
  const ticketModalEyebrow = document.getElementById('ticketModalEyebrow');
  const ticketModalTitle = document.getElementById('ticketModalTitle');
  const ticketSubjectSelect = document.getElementById('ticketSubject');
  const ticketDescriptionInput = document.getElementById('ticketDescription');
  const ticketCustomerSelect = document.getElementById('ticketCustomerSelect');
  const customerSearchList = document.getElementById('customerSearchList');
  const customerSearchField = document.querySelector('.customer-search-field');
  const ticketTechnicianSelect = document.getElementById('ticketTechnician');
  const ticketPageSizeSelect = document.getElementById('ticketPageSize');
  const ticketPrevPageBtn = document.getElementById('ticketPrevPage');
  const ticketNextPageBtn = document.getElementById('ticketNextPage');
  const ticketPageInfo = document.getElementById('ticketPageInfo');
  const ticketFooterSummary = document.getElementById('ticketFooterSummary');
  const ticketModalSubmit = ticketModalForm?.querySelector('button[type="submit"]');
  const assignModal = document.getElementById('assignModal');
  const assignModalClose = document.getElementById('assignModalClose');
  const assignModalCancel = document.getElementById('assignModalCancel');
  const assignModalForm = document.getElementById('assignModalForm');
  const assignTechnicianSelect = document.getElementById('assignTechnician');
  const assignTicketLabel = document.getElementById('assignTicketLabel');
  const customerDetailModal = document.getElementById('customerDetailModal');
  const customerDetailName = document.getElementById('customerDetailName');
  const customerDetailAccount = document.getElementById('customerDetailAccount');
  const customerDetailStatus = document.getElementById('customerDetailStatus');
  const customerDetailPlan = document.getElementById('customerDetailPlan');
  const customerDetailContact = document.getElementById('customerDetailContact');
  const customerDetailAddress = document.getElementById('customerDetailAddress');
  const customerDetailRouter = document.getElementById('customerDetailRouter');
  const customerDetailPppoeUsername = document.getElementById('customerDetailPppoeUsername');
  const customerDetailPppoePassword = document.getElementById('customerDetailPppoePassword');
  const customerDetailPppoeProfile = document.getElementById('customerDetailPppoeProfile');
  const customerDetailNapInfo = document.getElementById('customerDetailNapInfo');
  const customerDetailOpticalInfo = document.getElementById('customerDetailOpticalInfo');
  const customerDetailMikrotikStatus = document.getElementById('customerDetailMikrotikStatus');
  const customerDetailRouterField = customerDetailRouter?.closest('.customer-detail-field') || null;
  const customerDetailPppoeUsernameField = customerDetailPppoeUsername?.closest('.customer-detail-field') || null;
  const customerDetailPppoePasswordField = customerDetailPppoePassword?.closest('.customer-detail-field') || null;
  const customerDetailPppoeProfileField = customerDetailPppoeProfile?.closest('.customer-detail-field') || null;
  const customerDetailMikrotikStatusField = customerDetailMikrotikStatus?.closest('.customer-detail-field') || null;
  const customerDetailClose = document.getElementById('customerDetailClose');
  const bodyElement = document.body;

  const state = {
    tickets: [],
    technicians: [],
    customers: [],
    mikrotikEnabled: Boolean(window.mikrotikEnabled)
  };

  const applyCustomerDetailMikrotikVisibility = () => {
    [
      customerDetailRouterField,
      customerDetailPppoeUsernameField,
      customerDetailPppoePasswordField,
      customerDetailPppoeProfileField,
      customerDetailMikrotikStatusField
    ].forEach((field) => {
      if (!field) return;
      field.style.display = state.mikrotikEnabled ? '' : 'none';
    });
  };

  const loadMikrotikVisibilityState = async () => {
    try {
      if (typeof window.fetchMikrotikEnabledState === 'function') {
        const visibilityState = await window.fetchMikrotikEnabledState();
        state.mikrotikEnabled = Boolean(visibilityState?.enabled);
      } else {
        state.mikrotikEnabled = Boolean(window.mikrotikEnabled);
      }
    } catch (error) {
      state.mikrotikEnabled = false;
      console.warn('Unable to load MikroTik visibility state:', error?.message || error);
    }
    applyCustomerDetailMikrotikVisibility();
  };

  const refreshModalActiveState = () => {
    const activeModalCount = document.querySelectorAll('.modal-overlay.active, .modal.active').length;
    bodyElement.classList.toggle('modal-active', activeModalCount > 0);
  };

  let ticketStatusFilter = 'all';
  let activeTicketId = null;
  let editingTicketId = null;
  let ticketModalMode = 'create';
  const filters = {
    search: ''
  };

  const pagination = {
    page: 1,
    pageSize: Number(localStorage.getItem('ticketPageSize') || 10)
  };
  let ticketFormSubmitting = false;

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

  const escapeHtml = (value) => {
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

  const truncate = (value, limit = 96) => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= limit) return text;
    return `${text.slice(0, limit).trim()}...`;
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

  const setTicketModalMode = (mode = 'create') => {
    ticketModalMode = mode === 'edit' ? 'edit' : 'create';
    if (ticketModalEyebrow) {
      ticketModalEyebrow.textContent = ticketModalMode === 'edit' ? 'Edit Ticket' : 'New Ticket';
    }
    if (ticketModalTitle) {
      ticketModalTitle.textContent = ticketModalMode === 'edit' ? 'Update support ticket' : 'Create a support ticket';
    }
    if (ticketModalSubmit) {
      ticketModalSubmit.innerHTML = ticketModalMode === 'edit'
        ? '<i class="fa-solid fa-floppy-disk"></i> Save Changes'
        : '<i class="fa-solid fa-paper-plane"></i> Create Ticket';
    }
  };

  const formatDetailValue = (value, fallback = '-') => {
    const text = value === undefined || value === null ? '' : String(value).trim();
    return text || fallback;
  };

  const toTitleCase = (value) =>
    String(value || '')
      .trim()
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  const formatCustomerStatus = (value) => {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '-';
    if (text === 'active') return 'Active';
    if (text === 'inactive') return 'Inactive';
    if (text === 'disabled') return 'Disabled';
    return toTitleCase(text);
  };

  const formatMikrotikStatus = (value) => {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '-';
    if (text === 'online') return 'Online';
    if (text === 'offline') return 'Offline';
    return toTitleCase(text);
  };

  const buildCustomerAddress = (customer = {}) => {
    const direct = String(customer?.address || customer?.serviceAddress || customer?.fullAddress || '').trim();
    if (direct) return direct;
    return [
      customer?.street,
      customer?.barangay,
      customer?.municipality,
      customer?.province
    ]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .filter((part, index, parts) => parts.indexOf(part) === index)
      .join(', ');
  };

  const resolveCustomerContact = (customer = {}) =>
    String(
      customer?.contactNumber
      || customer?.mobileRaw
      || customer?.mobile
      || customer?.phone
      || ''
    ).trim();

  const setCustomerDetailValue = (element, value, fallback = '-') => {
    if (!element) return;
    element.textContent = formatDetailValue(value, fallback);
  };

  const findCustomerRecord = ({ account = '', name = '' } = {}) => {
    const accountKey = String(account || '').trim();
    if (accountKey) {
      const byAccount = state.customers.find((customer) => String(customer?.accountNumber || '').trim() === accountKey);
      if (byAccount) return byAccount;
    }
    const nameKey = String(name || '').trim().toLowerCase();
    if (!nameKey) return null;
    return state.customers.find((customer) => {
      const candidate = String(
        customer?.name
        || `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim()
        || ''
      ).trim().toLowerCase();
      return candidate === nameKey;
    }) || null;
  };

  const populateCustomerDetail = ({ name = '', account = '' } = {}) => {
    const customer = findCustomerRecord({ account, name }) || {};
    const displayName = String(
      customer?.name
      || `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim()
      || name
      || 'Customer'
    ).trim();
    const displayAccount = String(customer?.accountNumber || account || '').trim();

    if (customerDetailName) customerDetailName.textContent = displayName || 'Customer';
    if (customerDetailAccount) {
      customerDetailAccount.textContent = displayAccount
        ? `Account #${displayAccount}`
        : 'Account not specified';
    }

    setCustomerDetailValue(customerDetailStatus, formatCustomerStatus(customer?.status));
    setCustomerDetailValue(customerDetailPlan, customer?.planName || customer?.plan || '');
    setCustomerDetailValue(customerDetailContact, resolveCustomerContact(customer));
    setCustomerDetailValue(customerDetailAddress, buildCustomerAddress(customer));
    setCustomerDetailValue(customerDetailRouter, customer?.routerLabel || customer?.routerName || customer?.routerId || '');
    setCustomerDetailValue(customerDetailPppoeUsername, customer?.pppoeUsername || customer?.pppoeAccount || '');
    setCustomerDetailValue(customerDetailPppoePassword, customer?.pppoePassword || '');
    setCustomerDetailValue(customerDetailPppoeProfile, customer?.pppoeProfile || '');
    setCustomerDetailValue(customerDetailNapInfo, customer?.napInfo || '');
    setCustomerDetailValue(customerDetailOpticalInfo, customer?.opticalInfo || customer?.opticalPower || '');
    setCustomerDetailValue(customerDetailMikrotikStatus, formatMikrotikStatus(customer?.mikrotikStatus));
  };

  const ticketLabel = (ticket) => {
    return ensureTicketNumber(ticket);
  };

  const formatTicketNumber = (id) => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) return '';
    return `TKT-${String(Math.trunc(numericId)).padStart(8, '0')}`;
  };

  const ensureTicketNumber = (ticket) => {
    if (!ticket) return 'TKT-00000000';
    if (!ticket.ticketNumber) {
      ticket.ticketNumber = formatTicketNumber(ticket.id) || '';
    }
    return ticket.ticketNumber || 'Pending';
  };

  const derivedStatus = (ticket) => {
    const normalized = String(ticket.status || '').toLowerCase();
    if (['assigned', 'in-progress'].includes(normalized) || ticket?.assignedTo) return 'in-progress';
    return 'to-be-assigned';
  };

  const isClosedTicketStatus = (ticket) => {
    const normalized = String(ticket?.status || '').toLowerCase();
    return ['done', 'resolved', 'closed', 'completed', 'cancelled'].includes(normalized);
  };

  const statusPill = (status) => {
    const labelMap = {
      'to-be-assigned': 'To Be Assigned',
      'in-progress': 'In Progress'
    };
    const text = labelMap[status] || 'To Be Assigned';
    const dotClass =
      status === 'in-progress'
        ? 'status-dot green'
        : 'status-dot amber';
    return `
      <span class="tech-status">
        <span class="${dotClass}"></span>
        ${text}
      </span>
    `;
  };

  const sourcePill = (source) => {
    const normalized = String(source || '').toLowerCase();
    if (normalized === 'customer') return '<span class="status-pill info small">Customer app</span>';
    if (normalized === 'admin') return '<span class="status-pill success small">Admin</span>';
    return '<span class="status-pill small">Unknown</span>';
  };

  const parseJsonSafe = async (res) => {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_e) {
      throw new Error(`Unexpected response (${res.status})`);
    }
  };

  const extractErrorMessage = (payload, fallback) => {
    if (!payload || typeof payload !== 'object') return fallback;
    const errorValue = payload.error;
    if (typeof errorValue === 'string' && errorValue.trim()) return errorValue;
    if (errorValue && typeof errorValue === 'object') {
      if (typeof errorValue.message === 'string' && errorValue.message.trim()) return errorValue.message;
      if (typeof errorValue.error === 'string' && errorValue.error.trim()) return errorValue.error;
    }
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
    return fallback;
  };

  const updateFooter = (total, start, end, pageCount) => {
    if (ticketFooterSummary) {
      ticketFooterSummary.textContent = total
        ? `Showing ${start}-${end} of ${total} tickets`
        : 'Showing 0 of 0 tickets';
    }
    if (ticketPageInfo) {
      ticketPageInfo.textContent = `Page ${pagination.page} of ${pageCount}`;
    }
    if (ticketPrevPageBtn) ticketPrevPageBtn.disabled = pagination.page <= 1 || total === 0;
    if (ticketNextPageBtn) ticketNextPageBtn.disabled = pagination.page >= pageCount || total === 0;
  };

  const matchesSearch = (ticket) => {
    const term = String(filters.search || '').trim().toLowerCase();
    if (!term) return true;
    const haystack = [
      ticket.subject,
      ticket.description,
      ticket.customerName,
      ticket.ticketNumber,
      ticket.accountNumber,
      ticket.assignedTo,
      ticket.status
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(term);
  };

  const populateTechniciansSelect = (selectEl, selectedValue = '') => {
    if (!selectEl) return;
    const selection = selectedValue || '';
    selectEl.innerHTML = '';
    selectEl.add(new Option('Unassigned', ''));
    const list = Array.isArray(state.technicians) ? state.technicians : [];
    list.forEach((t) => {
      const label = t.username || t.name || `Technician ${t.id || ''}`.trim() || 'Technician';
      const option = new Option(label, label);
      if (label === selection) option.selected = true;
      selectEl.add(option);
    });
  };

  const buildCustomerLabel = (customer) => {
    const name = customer?.name || `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim() || 'Customer';
    const account = customer?.accountNumber ? String(customer.accountNumber) : '';
    return account ? `${name} (${account})` : name;
  };

  const setSelectedCustomer = ({ name = '', account = '', contact = '' } = {}) => {
    if (!ticketCustomerSelect) return;
    const displayName = String(name || '').trim();
    const accountNumber = String(account || '').trim();
    ticketCustomerSelect.value = displayName
      ? (accountNumber ? `${displayName} (${accountNumber})` : displayName)
      : accountNumber;
    ticketCustomerSelect.dataset.name = displayName;
    ticketCustomerSelect.dataset.account = accountNumber;
    ticketCustomerSelect.dataset.contact = String(contact || '').trim();
  };

  const populateCustomersSelect = () => {
    renderCustomerSuggestions(ticketCustomerSelect?.value || '');
  };

  const renderCustomerSuggestions = (query = '') => {
    if (!customerSearchList) return;
    const term = String(query || '').trim().toLowerCase();
    const list = Array.isArray(state.customers) ? state.customers : [];
    const matches = list
      .map((customer) => {
        const label = buildCustomerLabel(customer);
        const customerName = customer?.name || `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim();
        const account = customer?.accountNumber ? String(customer.accountNumber) : '';
        const contact = customer?.mobileRaw || customer?.mobile || customer?.email || '';
        return { label, customerName, account, contact };
      })
      .filter((customer) => {
        if (!term) return true;
        return customer.label.toLowerCase().includes(term);
      })
      .slice(0, 12);

    if (!matches.length) {
      customerSearchList.innerHTML = '<div class="customer-search-empty">No customers found.</div>';
      customerSearchList.classList.add('show');
      return;
    }

    customerSearchList.innerHTML = matches
      .map(
        (customer) => `
          <button type="button"
            data-name="${escapeHtml(customer.customerName)}"
            data-account="${escapeHtml(customer.account)}"
            data-contact="${escapeHtml(customer.contact)}"
          >${escapeHtml(customer.label)}</button>
        `
      )
      .join('');
    customerSearchList.classList.add('show');
  };

  const resetCustomerInput = () => {
    if (!ticketCustomerSelect) return;
    ticketCustomerSelect.value = '';
    delete ticketCustomerSelect.dataset.name;
    delete ticketCustomerSelect.dataset.account;
    delete ticketCustomerSelect.dataset.contact;
    customerSearchList?.classList.remove('show');
  };

  const openTicketModal = () => {
    if (!ticketModal) return;
    editingTicketId = null;
    setTicketModalMode('create');
    ticketModalForm?.reset();
    setSelectValue(ticketSubjectSelect, '');
    resetCustomerInput();
    populateCustomersSelect();
    populateTechniciansSelect(ticketTechnicianSelect);
    ticketModal.classList.add('active');
    ticketModal.setAttribute('aria-hidden', 'false');
    refreshModalActiveState();
    ticketModal.querySelector('input, select, textarea')?.focus();
  };

  const closeTicketModal = () => {
    if (!ticketModal) return;
    ticketModal.classList.remove('active');
    ticketModal.setAttribute('aria-hidden', 'true');
    ticketModalForm?.reset();
    setSelectValue(ticketSubjectSelect, '');
    resetCustomerInput();
    populateTechniciansSelect(ticketTechnicianSelect);
    editingTicketId = null;
    setTicketModalMode('create');
    refreshModalActiveState();
  };

  const openEditTicketModal = (ticket) => {
    if (!ticketModal || !ticket) return;
    editingTicketId = Number(ticket.id) || null;
    setTicketModalMode('edit');
    ticketModalForm?.reset();
    populateCustomersSelect();
    populateTechniciansSelect(ticketTechnicianSelect, ticket?.assignedTo || '');
    setSelectValue(ticketSubjectSelect, ticket?.subject || '');
    setSelectedCustomer({
      name: ticket?.customerName || '',
      account: ticket?.accountNumber || '',
      contact: ticket?.contact || ''
    });
    if (ticketDescriptionInput) {
      ticketDescriptionInput.value = ticket?.description || '';
    }
    ticketModal.classList.add('active');
    ticketModal.setAttribute('aria-hidden', 'false');
    refreshModalActiveState();
    ticketModal.querySelector('input, select, textarea')?.focus();
  };

  const openAssignModal = (ticket) => {
    if (!assignModal) return;
    activeTicketId = ticket?.id || null;
    const label = ticket
      ? `${ticket.subject || 'Ticket'}${ticket.customerName ? ` - ${ticket.customerName}` : ''}`
      : 'Ticket';
    if (assignTicketLabel) assignTicketLabel.textContent = label;
    populateTechniciansSelect(assignTechnicianSelect, ticket?.assignedTo || '');
    assignModal.classList.add('active');
    assignModal.setAttribute('aria-hidden', 'false');
    refreshModalActiveState();
    assignTechnicianSelect?.focus();
  };

  const closeAssignModal = () => {
    if (!assignModal) return;
    assignModal.classList.remove('active');
    assignModal.setAttribute('aria-hidden', 'true');
    assignModalForm?.reset();
    activeTicketId = null;
    refreshModalActiveState();
  };

  const openCustomerDetail = (name, account) => {
    if (!customerDetailModal) return;
    populateCustomerDetail({ name, account });
    customerDetailModal.classList.add('active');
    customerDetailModal.setAttribute('aria-hidden', 'false');
    refreshModalActiveState();
  };

  const closeCustomerDetail = () => {
    if (!customerDetailModal) return;
    customerDetailModal.classList.remove('active');
    customerDetailModal.setAttribute('aria-hidden', 'true');
    refreshModalActiveState();
  };

  const renderTickets = () => {
    if (!ticketTableBody) return;
    const ordered = [...state.tickets].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
    const openTickets = ordered.filter((ticket) => !isClosedTicketStatus(ticket));
    const filtered = openTickets.filter((ticket) => {
      if (ticketStatusFilter !== 'all' && derivedStatus(ticket) !== ticketStatusFilter) {
        return false;
      }
      return matchesSearch(ticket);
    });

    const total = filtered.length;
    const pageCount = total ? Math.ceil(total / pagination.pageSize) : 1;
    pagination.page = Math.min(Math.max(pagination.page, 1), pageCount);
    const startIndex = total ? (pagination.page - 1) * pagination.pageSize : 0;
    const pageSlice = total ? filtered.slice(startIndex, startIndex + pagination.pageSize) : [];

    if (!pageSlice.length) {
      ticketTableBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:14px;">No tickets yet.</td></tr>`;
      updateFooter(total, 0, 0, pageCount);
      return;
    }

    ticketTableBody.innerHTML = pageSlice
      .map((ticket, idx) => {
        const status = derivedStatus(ticket);
        const subject = escapeHtml(ticket.subject || 'Untitled ticket');
        const description = escapeHtml(truncate(ticket.description || ''));
        const customerNameRaw = ticket.customerName || 'Unknown customer';
        const customerName = escapeHtml(customerNameRaw);
        const accountNumber = escapeHtml(ticket.accountNumber || '');
        const assignedTo = escapeHtml(ticket.assignedTo || '');
        const actions = [
          `<button class="icon-btn" type="button" data-action="assign" title="Assign"><i class="fa-solid fa-user-plus"></i></button>`,
          `<button class="icon-btn" type="button" data-action="mark-done" title="Mark done"><i class="fa-solid fa-check"></i></button>`,
          `<button class="icon-btn danger" type="button" data-action="delete" title="Delete"><i class="fa-solid fa-trash"></i></button>`
        ];

        return `
          <tr data-ticket-id="${ticket.id}" class="editable-row" title="Click row to edit">
            <td>${startIndex + idx + 1}</td>
            <td>${escapeHtml(ticketLabel(ticket))}</td>
            <td>${subject}</td>
            <td>
              <button class="customer-link" type="button" data-action="customer-detail" data-customer-name="${escapeHtml(customerNameRaw)}" data-account-number="${accountNumber}">
                ${customerName}
              </button>
              <div class="ticket-muted">${accountNumber ? `Acct ${accountNumber}` : 'Unlinked'}</div>
            </td>
            <td>
              ${
                assignedTo
                  ? `<div class="tech-person"><div class="tech-avatar">${initials(assignedTo)}</div><span>${assignedTo}</span></div>`
                  : '<span class="ticket-muted">Unassigned</span>'
              }
            </td>
            <td>${formatDate(ticket.createdAt)}</td>
            <td>
              ${description ? `<p class="ticket-muted">${description}</p>` : '<span class="ticket-muted">No description</span>'}
            </td>
            <td>${statusPill(status)}</td>
            <td>
              <div class="table-actions">
                ${actions.join('')}
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    const displayStart = startIndex + 1;
    const displayEnd = Math.min(startIndex + pageSlice.length, total);
    updateFooter(total, displayStart, displayEnd, pageCount);
  };

  const loadTechnicians = async () => {
    try {
      const res = await fetch('/api/accounts', { credentials: 'include', cache: 'no-store' });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(extractErrorMessage(data, 'Failed to load technicians'));
      const accounts = Array.isArray(data.accounts) ? data.accounts : Array.isArray(data) ? data : [];
      state.technicians = accounts.filter(
        (a) => hasAccountRole(a, 'technician')
      );
      populateTechniciansSelect(ticketTechnicianSelect);
      renderTickets();
    } catch (err) {
      console.error('Load technicians failed:', err);
      state.technicians = [];
      populateTechniciansSelect(ticketTechnicianSelect);
      showToast(err.message || 'Failed to load technicians.');
    }
  };

  const loadCustomers = async () => {
    try {
      const res = await fetch('/api/customers', { credentials: 'include', cache: 'no-store' });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(extractErrorMessage(data, 'Failed to load customers'));
      state.customers = Array.isArray(data.customers) ? data.customers : Array.isArray(data) ? data : [];
      populateCustomersSelect();
    } catch (err) {
      console.error('Load customers failed:', err);
      state.customers = [];
      populateCustomersSelect();
      showToast(err.message || 'Failed to load customers.');
    }
  };

  const loadTickets = async () => {
    if (!ticketTableBody) return;
    ticketTableBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:14px;">Loading...</td></tr>`;
    try {
      const res = await fetch('/api/tickets', { credentials: 'include', cache: 'no-store' });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(extractErrorMessage(data, 'Failed to load tickets'));
      state.tickets = (Array.isArray(data.tickets) ? data.tickets : Array.isArray(data) ? data : []).map((ticket) => {
        ensureTicketNumber(ticket);
        return ticket;
      });
      pagination.page = 1;
      renderTickets();
      refreshSidebarWorkBadges();
    } catch (err) {
      console.error('Load tickets failed:', err);
      ticketTableBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:14px;">Failed to load tickets.</td></tr>`;
      showToast(err.message || 'Failed to load tickets.');
    }
  };

  const addTicket = async (payload) => {
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(extractErrorMessage(data, 'Failed to add ticket'));
      const ticket = data.ticket || data;
      ensureTicketNumber(ticket);
      state.tickets.unshift(ticket);
      renderTickets();
      refreshSidebarWorkBadges();
      showToast('Ticket created.');
      return true;
    } catch (err) {
      console.error('Add ticket failed:', err);
      showToast(err.message || 'Failed to add ticket.');
      return false;
    }
  };

  const updateTicket = async (id, payload) => {
    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(extractErrorMessage(data, 'Failed to update ticket'));
      const ticket = data.ticket || data;
      ensureTicketNumber(ticket);
      const idx = state.tickets.findIndex((t) => Number(t.id) === Number(id));
      if (idx >= 0) state.tickets[idx] = ticket;
      renderTickets();
      refreshSidebarWorkBadges();
      showToast('Ticket updated.');
      return true;
    } catch (err) {
      console.error('Update ticket failed:', err);
      showToast(err.message || 'Failed to update ticket.');
      return false;
    }
  };

  const assignTicket = async (id, technician) => {
    try {
      const res = await fetch(`/api/tickets/${id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ technician })
      });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(extractErrorMessage(data, 'Failed to assign ticket'));
      const ticket = data.ticket || data;
      const idx = state.tickets.findIndex((t) => Number(t.id) === Number(id));
      if (idx >= 0) state.tickets[idx] = ticket;
      renderTickets();
      refreshSidebarWorkBadges();
      showToast(technician ? 'Technician assigned.' : 'Assignment cleared.');
    } catch (err) {
      console.error('Assign ticket failed:', err);
      showToast(err.message || 'Failed to assign ticket.');
    }
  };

  const setTicketStatus = async (id, status) => {
    try {
      const res = await fetch(`/api/tickets/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status })
      });
      const data = await parseJsonSafe(res);
      if (!res.ok || data.ok === false) throw new Error(extractErrorMessage(data, 'Failed to update ticket'));
      const ticket = data.ticket || data;
      const idx = state.tickets.findIndex((t) => Number(t.id) === Number(id));
      if (idx >= 0) state.tickets[idx] = ticket;
      renderTickets();
      refreshSidebarWorkBadges();
      showToast('Ticket updated.');
    } catch (err) {
      console.error('Update ticket failed:', err);
      showToast(err.message || 'Failed to update ticket.');
    }
  };

  const deleteTicket = async (id) => {
    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) throw new Error('Failed to delete ticket');
      state.tickets = state.tickets.filter((t) => Number(t.id) !== Number(id));
      renderTickets();
      refreshSidebarWorkBadges();
      showToast('Ticket deleted.');
    } catch (err) {
      console.error('Delete ticket failed:', err);
      showToast('Failed to delete ticket.');
    }
  };

  const wireEvents = () => {
    openTicketModalBtn?.addEventListener('click', () => openTicketModal());
    ticketModalClose?.addEventListener('click', () => closeTicketModal());
    ticketModalCancel?.addEventListener('click', () => closeTicketModal());
    ticketModal?.addEventListener('click', (e) => {
      if (e.target === ticketModal) closeTicketModal();
    });

    assignModalClose?.addEventListener('click', () => closeAssignModal());
    assignModalCancel?.addEventListener('click', () => closeAssignModal());
    assignModal?.addEventListener('click', (e) => {
      if (e.target === assignModal) closeAssignModal();
    });
    customerDetailClose?.addEventListener('click', () => closeCustomerDetail());
    customerDetailModal?.addEventListener('click', (e) => {
      if (e.target === customerDetailModal) closeCustomerDetail();
    });

    ticketPageSizeSelect?.addEventListener('change', () => {
      pagination.pageSize = Number(ticketPageSizeSelect.value) || 10;
      localStorage.setItem('ticketPageSize', pagination.pageSize);
      pagination.page = 1;
      renderTickets();
    });

    ticketPrevPageBtn?.addEventListener('click', () => {
      if (pagination.page > 1) {
        pagination.page -= 1;
        renderTickets();
      }
    });

    ticketNextPageBtn?.addEventListener('click', () => {
      pagination.page += 1;
      renderTickets();
    });

    ticketModalForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (ticketFormSubmitting) return;
      const formData = new FormData(ticketModalForm);
      const customerNameValue = ticketCustomerSelect?.dataset?.name?.trim() || '';
      const accountValue = ticketCustomerSelect?.dataset?.account?.trim() || '';
      const typedCustomerValue = ticketCustomerSelect?.value?.trim() || '';
      const fallbackCustomerName = accountValue ? '' : typedCustomerValue;
      const hasCustomer = Boolean(customerNameValue || fallbackCustomerName || accountValue);
      const payload = {
        subject: formData.get('subject') || '',
        customerName: customerNameValue || fallbackCustomerName,
        accountNumber: accountValue,
        assignedTo: formData.get('assignedTo') || '',
        description: (formData.get('description') || '').trim(),
        contact: ticketCustomerSelect?.dataset?.contact?.trim() || ''
      };
      if (!payload.subject || !hasCustomer) {
        showToast('Please complete the required fields.');
        return;
      }
      ticketFormSubmitting = true;
      ticketModalSubmit?.setAttribute('disabled', 'true');
      const request = ticketModalMode === 'edit' && editingTicketId
        ? updateTicket(editingTicketId, payload)
        : addTicket({
            ...payload,
            source: 'admin',
            createdAt: new Date().toISOString()
          });
      request
        .then((success) => {
          if (success) closeTicketModal();
        })
        .finally(() => {
          ticketFormSubmitting = false;
          ticketModalSubmit?.removeAttribute('disabled');
        });
    });

    ticketCustomerSelect?.addEventListener('input', () => {
      delete ticketCustomerSelect.dataset.name;
      delete ticketCustomerSelect.dataset.account;
      delete ticketCustomerSelect.dataset.contact;
      renderCustomerSuggestions(ticketCustomerSelect.value);
    });

    ticketCustomerSelect?.addEventListener('focus', () => {
      renderCustomerSuggestions(ticketCustomerSelect.value);
    });

    customerSearchList?.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      ticketCustomerSelect.value = button.textContent.trim();
      ticketCustomerSelect.dataset.name = button.dataset.name || ticketCustomerSelect.value;
      ticketCustomerSelect.dataset.account = button.dataset.account || '';
      ticketCustomerSelect.dataset.contact = button.dataset.contact || '';
      customerSearchList.classList.remove('show');
    });

    document.addEventListener('click', (event) => {
      if (!customerSearchField?.contains(event.target)) {
        customerSearchList?.classList.remove('show');
      }
    });

    assignModalForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const unlock = window.withSubmitLock ? window.withSubmitLock(assignModalForm, { label: 'Saving...' }) : null;
      if (window.withSubmitLock && !unlock) return;
      if (!activeTicketId) {
        if (unlock) unlock();
        return;
      }
      const formData = new FormData(assignModalForm);
      const technician = formData.get('technician') || '';
      assignTicket(activeTicketId, technician)
        .then(() => closeAssignModal())
        .finally(() => {
          if (unlock) unlock();
        });
    });

    ticketTableBody?.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr[data-ticket-id]');
      if (!tr) return;
      const id = Number(tr?.getAttribute('data-ticket-id'));
      if (!id) return;
      const ticket = state.tickets.find((t) => Number(t.id) === id);
      if (!ticket) return;
      const interactiveElement = e.target.closest('button, a, input, select, textarea, label');
      if (!interactiveElement) {
        openEditTicketModal(ticket);
        return;
      }
      const btn = interactiveElement.closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'assign') {
        openAssignModal(ticket);
        return;
      }
      if (action === 'mark-done') {
        const confirmed = window.appConfirm
          ? await window.appConfirm('Mark this ticket as done?', { title: 'Complete Ticket' })
          : window.confirm('Mark this ticket as done?');
        if (!confirmed) {
          return;
        }
        setTicketStatus(id, 'done');
        return;
      }
      if (action === 'delete') {
        const confirmed = window.appConfirm
          ? await window.appConfirm('Permanently delete this ticket?', { title: 'Delete Ticket' })
          : window.confirm('Permanently delete this ticket?');
        if (!confirmed) {
          return;
        }
        deleteTicket(id);
        return;
      }
      if (action === 'customer-detail') {
        const name = btn.getAttribute('data-customer-name');
        const account = btn.getAttribute('data-account-number');
        openCustomerDetail(name, account);
      }
    });

    ticketFilterChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        ticketFilterChips.forEach((c) => {
          const active = c === chip;
          c.classList.toggle('active', active);
          c.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        ticketStatusFilter = chip.getAttribute('data-ticket-filter') || 'all';
        pagination.page = 1;
        renderTickets();
      });
    });

    document.addEventListener('global-search:query', (event) => {
      filters.search = event?.detail?.query || '';
      pagination.page = 1;
      renderTickets();
    });

  };

  if (ticketPageSizeSelect) {
    ticketPageSizeSelect.value = String(pagination.pageSize);
  }

  document.dispatchEvent(
    new CustomEvent('page:search-ready', {
      detail: { placeholder: 'Search tickets by subject, customer, or account' }
    })
  );

  renderTickets();
  wireEvents();
  applyCustomerDetailMikrotikVisibility();
  void loadMikrotikVisibilityState();
  loadTickets();
  loadTechnicians();
  loadCustomers();
})();
