(function () {
  const elements = {
    tableBody: document.getElementById('ticketTableBody'),
    tabs: Array.from(document.querySelectorAll('[data-ticket-filter]')),
    counts: Array.from(document.querySelectorAll('[data-ticket-count]')),
    search: document.getElementById('ticketSearch'),
    pageSize: document.getElementById('ticketPageSize'),
    previousPage: document.getElementById('ticketPrevPage'),
    nextPage: document.getElementById('ticketNextPage'),
    pageInfo: document.getElementById('ticketPageInfo'),
    footerSummary: document.getElementById('ticketFooterSummary'),
    lastUpdated: document.getElementById('ticketLastUpdated'),
    refresh: document.getElementById('refreshTickets'),
    metricOpen: document.getElementById('ticketMetricOpen'),
    metricUnassigned: document.getElementById('ticketMetricUnassigned'),
    metricWaiting: document.getElementById('ticketMetricWaiting'),
    metricEscalated: document.getElementById('ticketMetricEscalated'),
    toast: document.getElementById('ticketToast'),
    toastBody: document.getElementById('ticketToastBody'),
    openTicket: document.getElementById('openTicketModal'),
    ticketModal: document.getElementById('ticketModal'),
    ticketModalClose: document.getElementById('ticketModalClose'),
    ticketModalCancel: document.getElementById('ticketModalCancel'),
    ticketForm: document.getElementById('ticketModalForm'),
    ticketModalEyebrow: document.getElementById('ticketModalEyebrow'),
    ticketModalTitle: document.getElementById('ticketModalTitle'),
    ticketModalSubmit: document.getElementById('ticketModalSubmit'),
    ticketSubject: document.getElementById('ticketSubject'),
    ticketCustomer: document.getElementById('ticketCustomerSelect'),
    ticketTechnician: document.getElementById('ticketTechnician'),
    ticketDescription: document.getElementById('ticketDescription'),
    assignModal: document.getElementById('assignModal'),
    assignModalClose: document.getElementById('assignModalClose'),
    assignModalCancel: document.getElementById('assignModalCancel'),
    assignForm: document.getElementById('assignModalForm'),
    assignTechnician: document.getElementById('assignTechnician'),
    assignTicketLabel: document.getElementById('assignTicketLabel'),
    workOrderModal: document.getElementById('workOrderModal'),
    workOrderModalClose: document.getElementById('workOrderModalClose'),
    workOrderModalCancel: document.getElementById('workOrderModalCancel'),
    workOrderForm: document.getElementById('workOrderForm'),
    workOrderTicketLabel: document.getElementById('workOrderTicketLabel'),
    workOrderType: document.getElementById('workOrderType'),
    workOrderTechnician: document.getElementById('workOrderTechnician'),
    workOrderPriority: document.getElementById('workOrderPriority'),
    workOrderStart: document.getElementById('workOrderStart'),
    workOrderEnd: document.getElementById('workOrderEnd'),
    workOrderSla: document.getElementById('workOrderSla'),
    workOrderInstructions: document.getElementById('workOrderInstructions'),
    customerModal: document.getElementById('customerDetailModal'),
    customerModalClose: document.getElementById('customerDetailClose'),
    customerModalDone: document.getElementById('customerDetailDone'),
    customerName: document.getElementById('customerDetailName'),
    customerAccount: document.getElementById('customerDetailAccount'),
    customerStatus: document.getElementById('customerDetailStatus'),
    customerPlan: document.getElementById('customerDetailPlan'),
    customerContact: document.getElementById('customerDetailContact'),
    customerAddress: document.getElementById('customerDetailAddress'),
    customerRouter: document.getElementById('customerDetailRouter'),
    customerPppoeUsername: document.getElementById('customerDetailPppoeUsername'),
    customerPppoePassword: document.getElementById('customerDetailPppoePassword'),
    customerPppoeProfile: document.getElementById('customerDetailPppoeProfile'),
    customerNapInfo: document.getElementById('customerDetailNapInfo'),
    customerOpticalInfo: document.getElementById('customerDetailOpticalInfo'),
    customerMikrotikStatus: document.getElementById('customerDetailMikrotikStatus')
  };

  const state = {
    tickets: [],
    technicians: [],
    customers: [],
    customerOptions: new Map(),
    filter: 'active',
    search: '',
    page: 1,
    pageSize: Number(localStorage.getItem('ticketPageSize') || 10),
    editingTicketId: null,
    activeTicketId: null,
    submittingTicket: false,
    mikrotikEnabled: Boolean(window.mikrotikEnabled)
  };

  const STATUS_ALIASES = new Map([
    ['new', 'open'], ['pending', 'open'], ['unassigned', 'open'], ['to-be-assigned', 'open'],
    ['to_be_assigned', 'open'], ['assigned', 'in-progress'], ['in_progress', 'in-progress'],
    ['inprogress', 'in-progress'], ['working', 'in-progress'], ['waiting_customer', 'waiting-customer'],
    ['waiting customer', 'waiting-customer'], ['waiting for customer', 'waiting-customer'],
    ['waiting-for-customer', 'waiting-customer'],
    ['waiting-on-customer', 'waiting-customer'], ['pending-customer', 'waiting-customer'],
    ['customer-waiting', 'waiting-customer'], ['escalation', 'escalated'], ['closed', 'resolved'],
    ['done', 'resolved'], ['completed', 'resolved'], ['fixed', 'resolved'], ['canceled', 'cancelled']
  ]);
  const CLOSED_STATUSES = new Set(['resolved', 'cancelled']);

  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));

  const normalizeStatus = (value) => {
    const normalized = String(value || 'open').trim().toLowerCase();
    const hyphenated = normalized.replace(/\s+/g, '-');
    return STATUS_ALIASES.get(normalized) || STATUS_ALIASES.get(hyphenated) || hyphenated || 'open';
  };

  const isArchived = (ticket) => Boolean(ticket?.archivedAt || ticket?.archived_at);
  const isClosed = (ticket) => CLOSED_STATUSES.has(normalizeStatus(ticket?.status));
  const isActive = (ticket) => !isArchived(ticket) && !isClosed(ticket);
  const ticketNumber = (ticket) => {
    if (ticket?.ticketNumber) return ticket.ticketNumber;
    const id = Number(ticket?.id);
    return Number.isFinite(id) && id > 0 ? `TKT-${String(Math.trunc(id)).padStart(8, '0')}` : 'Pending';
  };
  const initials = (value) => String(value || 'NA').split(/[\s-]+/).filter(Boolean)
    .map((part) => part.charAt(0)).join('').slice(0, 2).toUpperCase();
  const toTitleCase = (value) => String(value || '').trim().split(/[\s_-]+/).filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
  const truncate = (value, limit = 150) => {
    const text = String(value || '').trim();
    return text.length > limit ? `${text.slice(0, limit).trim()}...` : text;
  };
  const formatDate = (value, includeTime = false) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '-';
    return date.toLocaleString(undefined, includeTime
      ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const toLocalInputValue = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60 * 1000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };

  const showToast = (message, type = 'info') => {
    if (typeof window.appToast === 'function') {
      window.appToast(message, { type });
      return;
    }
    if (!elements.toast || !elements.toastBody) return;
    elements.toastBody.textContent = message;
    elements.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => elements.toast.classList.remove('show'), 3000);
  };

  const requestJson = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_error) {
        throw new Error(`Unexpected server response (${response.status}).`);
      }
    }
    if (!response.ok || payload.ok === false) {
      const error = new Error(
        typeof payload.error === 'string' && payload.error.trim()
          ? payload.error
          : `Request failed (${response.status}).`
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  };

  const refreshModalState = () => {
    document.body.classList.toggle('modal-active', Boolean(document.querySelector('.ticket-modal.active')));
  };
  const openModal = (modal) => {
    if (!modal) return;
    modal.classList.add('active', 'show');
    modal.setAttribute('aria-hidden', 'false');
    refreshModalState();
    window.setTimeout(() => modal.querySelector('.modal-body input, .modal-body select, .modal-body textarea, .modal-body button')?.focus(), 0);
  };
  const closeModal = (modal) => {
    if (!modal) return;
    modal.classList.remove('active', 'show');
    modal.setAttribute('aria-hidden', 'true');
    refreshModalState();
  };

  const hasRole = (account, role) => {
    const target = String(role || '').trim().toLowerCase();
    const roles = Array.isArray(account?.roles)
      ? account.roles
      : String(account?.role || '').split(/[,/|;]+|\s+\+\s+|\s+and\s+/i);
    return roles.some((value) => String(value || '').trim().toLowerCase() === target);
  };
  const technicianName = (technician) => String(
    technician?.username || technician?.name || technician?.displayName || ''
  ).trim();
  const customerName = (customer) => String(
    customer?.name || [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || 'Customer'
  ).trim();
  const customerContact = (customer) => String(
    customer?.contactNumber || customer?.mobileRaw || customer?.mobile || customer?.phone || customer?.email || ''
  ).trim();
  const customerAddress = (customer) => String(customer?.address || customer?.serviceAddress || customer?.fullAddress || [
    customer?.street, customer?.barangay, customer?.municipality, customer?.province
  ].filter(Boolean).join(', ') || '').trim();

  const populateTechnicians = (select, selected = '') => {
    if (!select) return;
    const names = state.technicians.map(technicianName).filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
    select.innerHTML = '<option value="">Leave unassigned</option>' + names
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    if (selected && !names.includes(selected)) {
      select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(selected)}">${escapeHtml(selected)}</option>`);
    }
    select.value = selected || '';
  };

  const populateCustomers = (ticket = null) => {
    if (!elements.ticketCustomer) return;
    state.customerOptions = new Map();
    const sorted = state.customers.slice().sort((left, right) => customerName(left).localeCompare(customerName(right)));
    const options = sorted.map((customer, index) => {
      const account = String(customer?.accountNumber || '').trim();
      const key = account ? `account:${account}` : `customer:${String(customer?.id || index)}`;
      state.customerOptions.set(key, customer);
      const label = account ? `${customerName(customer)} (${account})` : customerName(customer);
      return `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`;
    });
    elements.ticketCustomer.innerHTML = `<option value="">Select a customer</option>${options.join('')}`;

    if (!ticket) return;
    const account = String(ticket.accountNumber || '').trim();
    const name = String(ticket.customerName || '').trim().toLowerCase();
    let match = Array.from(state.customerOptions.entries()).find(([, customer]) => (
      account && String(customer?.accountNumber || '').trim() === account
    ));
    if (!match && name) {
      match = Array.from(state.customerOptions.entries()).find(([, customer]) => customerName(customer).toLowerCase() === name);
    }
    if (!match) {
      const key = `ticket:${ticket.id}`;
      const legacyCustomer = {
        name: ticket.customerName || 'Unlinked customer',
        accountNumber: ticket.accountNumber || '',
        contactNumber: ticket.contact || ''
      };
      state.customerOptions.set(key, legacyCustomer);
      elements.ticketCustomer.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(key)}">${escapeHtml(customerName(legacyCustomer))} (unlinked)</option>`);
      match = [key, legacyCustomer];
    }
    elements.ticketCustomer.value = match[0];
  };

  const findCustomer = ({ accountNumber = '', name = '' } = {}) => {
    const account = String(accountNumber || '').trim();
    if (account) {
      const byAccount = state.customers.find((customer) => String(customer?.accountNumber || '').trim() === account);
      if (byAccount) return byAccount;
    }
    const normalizedName = String(name || '').trim().toLowerCase();
    return state.customers.find((customer) => customerName(customer).toLowerCase() === normalizedName) || null;
  };

  const setDetail = (element, value, fallback = '-') => {
    if (element) element.textContent = String(value == null ? '' : value).trim() || fallback;
  };
  const applyMikrotikVisibility = () => {
    document.querySelectorAll('[data-mikrotik-detail]').forEach((element) => {
      element.hidden = !state.mikrotikEnabled;
    });
  };
  const openCustomerDetails = (ticket) => {
    const customer = findCustomer(ticket) || {};
    const name = customerName(customer) !== 'Customer' ? customerName(customer) : ticket.customerName || 'Customer';
    const account = String(customer.accountNumber || ticket.accountNumber || '').trim();
    setDetail(elements.customerName, name, 'Customer');
    setDetail(elements.customerAccount, account ? `Account #${account}` : 'Account not specified');
    setDetail(elements.customerStatus, toTitleCase(customer.status));
    setDetail(elements.customerPlan, customer.planName || customer.plan);
    setDetail(elements.customerContact, customerContact(customer) || ticket.contact);
    setDetail(elements.customerAddress, customerAddress(customer));
    setDetail(elements.customerRouter, customer.routerLabel || customer.routerName || customer.routerId);
    setDetail(elements.customerPppoeUsername, customer.pppoeUsername || customer.pppoeAccount);
    setDetail(elements.customerPppoePassword, customer.pppoePassword);
    setDetail(elements.customerPppoeProfile, customer.pppoeProfile);
    setDetail(elements.customerNapInfo, customer.napInfo);
    setDetail(elements.customerOpticalInfo, customer.opticalInfo || customer.opticalPower);
    setDetail(elements.customerMikrotikStatus, toTitleCase(customer.mikrotikStatus));
    applyMikrotikVisibility();
    openModal(elements.customerModal);
  };

  const statusMeta = (ticket) => {
    if (isArchived(ticket)) return { label: 'Archived', className: 'bg-secondary-lt text-secondary', icon: 'ti-archive' };
    const status = normalizeStatus(ticket.status);
    const values = {
      open: { label: 'Open', className: 'bg-yellow-lt text-yellow', icon: 'ti-circle-dot' },
      'in-progress': { label: 'In Progress', className: 'bg-blue-lt text-blue', icon: 'ti-progress' },
      'waiting-customer': { label: 'Waiting for Customer', className: 'bg-azure-lt text-azure', icon: 'ti-hourglass' },
      escalated: { label: 'Escalated', className: 'bg-red-lt text-red', icon: 'ti-alert-triangle' },
      resolved: { label: 'Resolved', className: 'bg-green-lt text-green', icon: 'ti-circle-check' },
      cancelled: { label: 'Cancelled', className: 'bg-secondary-lt text-secondary', icon: 'ti-circle-x' }
    };
    return values[status] || { label: toTitleCase(status), className: 'bg-secondary-lt text-secondary', icon: 'ti-help' };
  };

  const workOrderMarkup = (ticket) => {
    const workOrder = ticket.linkedWorkOrder;
    if (!workOrder) return '<span class="text-secondary">Not created</span>';
    const label = workOrder.jobNumber || `Work order #${workOrder.id}`;
    const status = toTitleCase(workOrder.workflowStatus || 'unassigned');
    const badgeClass = workOrder.active ? 'bg-blue-lt text-blue' : 'bg-green-lt text-green';
    return `<div class="d-flex flex-column gap-1"><a class="fw-semibold" href="technicians.html">${escapeHtml(label)}</a><span class="badge ${badgeClass} w-fit-content">${escapeHtml(status)}</span></div>`;
  };

  const actionMenu = (ticket) => {
    const archived = isArchived(ticket);
    const status = normalizeStatus(ticket.status);
    const activeWorkOrder = Boolean(ticket.linkedWorkOrder?.active);
    const items = [];
    if (archived) {
      items.push('<li><button class="dropdown-item" type="button" data-action="restore"><i class="ti ti-restore me-2"></i>Restore ticket</button></li>');
    } else {
      items.push('<li><button class="dropdown-item" type="button" data-action="edit"><i class="ti ti-edit me-2"></i>Edit details</button></li>');
      items.push('<li><button class="dropdown-item" type="button" data-action="assign"><i class="ti ti-user-check me-2"></i>Assign technician</button></li>');
      if (!isClosed(ticket) && !activeWorkOrder) {
        items.push('<li><button class="dropdown-item" type="button" data-action="work-order"><i class="ti ti-clipboard-plus me-2"></i>Create work order</button></li>');
      }
      if (ticket.linkedWorkOrder) {
        items.push('<li><a class="dropdown-item" href="technicians.html"><i class="ti ti-tool me-2"></i>Open dispatch</a></li>');
      }
      items.push('<li><hr class="dropdown-divider"></li>');
      if (isClosed(ticket)) {
        items.push('<li><button class="dropdown-item" type="button" data-action="status" data-status="open"><i class="ti ti-refresh me-2"></i>Reopen ticket</button></li>');
      } else {
        if (status !== 'in-progress') items.push('<li><button class="dropdown-item" type="button" data-action="status" data-status="in-progress"><i class="ti ti-progress me-2"></i>Mark in progress</button></li>');
        if (status !== 'waiting-customer') items.push('<li><button class="dropdown-item" type="button" data-action="status" data-status="waiting-customer"><i class="ti ti-hourglass me-2"></i>Wait for customer</button></li>');
        if (status !== 'escalated') items.push('<li><button class="dropdown-item text-danger" type="button" data-action="status" data-status="escalated"><i class="ti ti-alert-triangle me-2"></i>Escalate</button></li>');
        if (!activeWorkOrder) items.push('<li><button class="dropdown-item text-success" type="button" data-action="status" data-status="resolved"><i class="ti ti-circle-check me-2"></i>Resolve ticket</button></li>');
        items.push('<li><button class="dropdown-item" type="button" data-action="status" data-status="cancelled"><i class="ti ti-circle-x me-2"></i>Cancel ticket</button></li>');
      }
      if (!activeWorkOrder) {
        items.push('<li><hr class="dropdown-divider"></li>');
        items.push('<li><button class="dropdown-item text-secondary" type="button" data-action="archive"><i class="ti ti-archive me-2"></i>Archive ticket</button></li>');
      }
    }
    return `<div class="dropdown"><button class="btn btn-icon btn-ghost-secondary" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Ticket actions"><i class="ti ti-dots-vertical"></i></button><ul class="dropdown-menu dropdown-menu-end">${items.join('')}</ul></div>`;
  };

  const matchesFilter = (ticket) => {
    if (state.filter === 'all') return true;
    if (state.filter === 'archived') return isArchived(ticket);
    if (state.filter === 'active') return isActive(ticket);
    if (state.filter === 'unassigned') return isActive(ticket) && !String(ticket.assignedTo || '').trim();
    if (state.filter === 'resolved') return !isArchived(ticket) && isClosed(ticket);
    return !isArchived(ticket) && normalizeStatus(ticket.status) === state.filter;
  };
  const matchesSearch = (ticket) => {
    const term = state.search.trim().toLowerCase();
    if (!term) return true;
    return [ticketNumber(ticket), ticket.subject, ticket.description, ticket.customerName, ticket.accountNumber,
      ticket.contact, ticket.assignedTo, ticket.status, ticket.linkedWorkOrder?.jobNumber]
      .filter(Boolean).join(' ').toLowerCase().includes(term);
  };

  const updateSummary = () => {
    const activeTickets = state.tickets.filter(isActive);
    const counts = {
      active: activeTickets.length,
      unassigned: activeTickets.filter((ticket) => !String(ticket.assignedTo || '').trim()).length,
      'waiting-customer': activeTickets.filter((ticket) => normalizeStatus(ticket.status) === 'waiting-customer').length,
      escalated: activeTickets.filter((ticket) => normalizeStatus(ticket.status) === 'escalated').length,
      resolved: state.tickets.filter((ticket) => !isArchived(ticket) && isClosed(ticket)).length,
      archived: state.tickets.filter(isArchived).length
    };
    if (elements.metricOpen) elements.metricOpen.textContent = String(counts.active);
    if (elements.metricUnassigned) elements.metricUnassigned.textContent = String(counts.unassigned);
    if (elements.metricWaiting) elements.metricWaiting.textContent = String(counts['waiting-customer']);
    if (elements.metricEscalated) elements.metricEscalated.textContent = String(counts.escalated);
    elements.counts.forEach((element) => {
      element.textContent = String(counts[element.dataset.ticketCount] || 0);
    });
  };

  const renderTickets = () => {
    if (!elements.tableBody) return;
    updateSummary();
    const tickets = state.tickets.slice()
      .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
      .filter(matchesFilter)
      .filter(matchesSearch);
    const total = tickets.length;
    const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), pageCount);
    const startIndex = total ? (state.page - 1) * state.pageSize : 0;
    const rows = tickets.slice(startIndex, startIndex + state.pageSize);

    if (!rows.length) {
      const archivedView = state.filter === 'archived';
      elements.tableBody.innerHTML = `<tr><td colspan="7"><div class="empty py-5"><div class="empty-icon"><span class="avatar avatar-lg bg-secondary-lt text-secondary"><i class="ti ${archivedView ? 'ti-archive-off' : 'ti-ticket-off'}"></i></span></div><p class="empty-title">${archivedView ? 'No archived tickets' : 'No tickets in this view'}</p><p class="empty-subtitle text-secondary">${state.search ? 'Try a different search.' : 'New tickets will appear here.'}</p></div></td></tr>`;
    } else {
      elements.tableBody.innerHTML = rows.map((ticket) => {
        const meta = statusMeta(ticket);
        const description = truncate(ticket.description || '');
        const assignedTo = String(ticket.assignedTo || '').trim();
        const source = String(ticket.source || '').toLowerCase() === 'customer' ? 'Customer app' : 'Admin';
        const archiveMeta = isArchived(ticket)
          ? `<div class="text-secondary small mt-1">${escapeHtml(formatDate(ticket.archivedAt, true))}${ticket.archivedBy ? ` by ${escapeHtml(ticket.archivedBy)}` : ''}</div>`
          : '';
        return `<tr data-ticket-id="${Number(ticket.id)}" class="${isArchived(ticket) ? 'ticket-row-archived' : ''}">
          <td><div class="fw-semibold">${escapeHtml(ticketNumber(ticket))}</div><div class="text-secondary small">${escapeHtml(ticket.subject || 'Untitled ticket')}</div>${description ? `<div class="ticket-description text-secondary mt-1">${escapeHtml(description)}</div>` : ''}</td>
          <td><button class="btn btn-link p-0 fw-semibold text-start" type="button" data-action="customer-detail">${escapeHtml(ticket.customerName || 'Unknown customer')}</button><div class="text-secondary small">${ticket.accountNumber ? `Account ${escapeHtml(ticket.accountNumber)}` : 'Unlinked customer'}</div><span class="badge bg-secondary-lt text-secondary mt-1">${escapeHtml(source)}</span></td>
          <td>${assignedTo ? `<div class="d-flex align-items-center gap-2"><span class="avatar avatar-xs bg-blue-lt text-blue">${escapeHtml(initials(assignedTo))}</span><span>${escapeHtml(assignedTo)}</span></div>` : '<span class="text-secondary">Unassigned</span>'}</td>
          <td><span class="text-nowrap">${escapeHtml(formatDate(ticket.createdAt))}</span><div class="text-secondary small">Updated ${escapeHtml(formatDate(ticket.updatedAt || ticket.createdAt, true))}</div></td>
          <td><span class="badge ${meta.className}"><i class="ti ${meta.icon} me-1"></i>${escapeHtml(meta.label)}</span>${archiveMeta}</td>
          <td>${workOrderMarkup(ticket)}</td>
          <td class="text-end">${actionMenu(ticket)}</td>
        </tr>`;
      }).join('');
    }

    const displayStart = total ? startIndex + 1 : 0;
    const displayEnd = total ? Math.min(total, startIndex + rows.length) : 0;
    if (elements.footerSummary) elements.footerSummary.textContent = `Showing ${displayStart}-${displayEnd} of ${total} tickets`;
    if (elements.pageInfo) elements.pageInfo.textContent = `Page ${state.page} of ${pageCount}`;
    if (elements.previousPage) elements.previousPage.disabled = state.page <= 1 || !total;
    if (elements.nextPage) elements.nextPage.disabled = state.page >= pageCount || !total;
  };

  const loadTickets = async ({ quiet = false } = {}) => {
    if (!quiet && elements.tableBody) {
      elements.tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-secondary py-5"><span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading tickets...</td></tr>';
    }
    try {
      const payload = await requestJson('/api/tickets?includeArchived=1');
      state.tickets = Array.isArray(payload.tickets) ? payload.tickets : [];
      if (elements.lastUpdated) elements.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      renderTickets();
      if (typeof window.refreshSidebarWorkBadges === 'function') window.refreshSidebarWorkBadges();
    } catch (error) {
      console.error('Unable to load tickets:', error);
      if (elements.tableBody) elements.tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-5">Unable to load tickets.</td></tr>';
      showToast(error.message || 'Unable to load tickets.', 'error');
    }
  };

  const loadTechnicians = async () => {
    try {
      const payload = await requestJson('/api/accounts');
      const accounts = Array.isArray(payload.accounts) ? payload.accounts : Array.isArray(payload) ? payload : [];
      state.technicians = accounts.filter((account) => hasRole(account, 'technician'));
      populateTechnicians(elements.ticketTechnician);
      populateTechnicians(elements.assignTechnician);
      populateTechnicians(elements.workOrderTechnician);
    } catch (error) {
      console.error('Unable to load technicians:', error);
      state.technicians = [];
      showToast(error.message || 'Unable to load technicians.', 'error');
    }
  };

  const loadCustomers = async () => {
    try {
      const payload = await requestJson('/api/customers');
      state.customers = Array.isArray(payload.customers) ? payload.customers : Array.isArray(payload) ? payload : [];
      populateCustomers();
    } catch (error) {
      console.error('Unable to load customers:', error);
      state.customers = [];
      populateCustomers();
      showToast(error.message || 'Unable to load customers.', 'error');
    }
  };

  const loadMikrotikVisibility = async () => {
    try {
      if (typeof window.fetchMikrotikEnabledState === 'function') {
        const result = await window.fetchMikrotikEnabledState();
        state.mikrotikEnabled = Boolean(result?.enabled);
      }
    } catch (_error) {
      state.mikrotikEnabled = false;
    }
    applyMikrotikVisibility();
  };

  const ensureSubjectOption = (value) => {
    if (!elements.ticketSubject) return;
    const subject = String(value || '').trim();
    elements.ticketSubject.querySelectorAll('[data-dynamic-subject]').forEach((option) => option.remove());
    if (subject && !Array.from(elements.ticketSubject.options).some((option) => option.value === subject)) {
      const option = new Option(subject, subject, true, true);
      option.dataset.dynamicSubject = 'true';
      elements.ticketSubject.add(option);
    }
    elements.ticketSubject.value = subject;
  };

  const openTicketForm = (ticket = null) => {
    state.editingTicketId = ticket ? Number(ticket.id) : null;
    elements.ticketForm?.reset();
    populateCustomers(ticket);
    populateTechnicians(elements.ticketTechnician, ticket?.assignedTo || '');
    ensureSubjectOption(ticket?.subject || '');
    if (elements.ticketDescription) elements.ticketDescription.value = ticket?.description || '';
    if (elements.ticketModalEyebrow) elements.ticketModalEyebrow.textContent = ticket ? 'Edit Ticket' : 'New Ticket';
    if (elements.ticketModalTitle) elements.ticketModalTitle.textContent = ticket ? 'Update support ticket' : 'Create a support ticket';
    if (elements.ticketModalSubmit) elements.ticketModalSubmit.innerHTML = ticket
      ? '<i class="ti ti-device-floppy"></i> Save Changes'
      : '<i class="ti ti-send"></i> Create Ticket';
    openModal(elements.ticketModal);
  };
  const closeTicketForm = () => {
    closeModal(elements.ticketModal);
    state.editingTicketId = null;
    elements.ticketForm?.reset();
    ensureSubjectOption('');
    populateCustomers();
    populateTechnicians(elements.ticketTechnician);
  };

  const openAssignment = (ticket) => {
    state.activeTicketId = Number(ticket.id);
    if (elements.assignTicketLabel) elements.assignTicketLabel.textContent = `${ticketNumber(ticket)} - ${ticket.customerName || ticket.subject || 'Ticket'}`;
    populateTechnicians(elements.assignTechnician, ticket.assignedTo || '');
    openModal(elements.assignModal);
  };
  const closeAssignment = () => {
    closeModal(elements.assignModal);
    state.activeTicketId = null;
    elements.assignForm?.reset();
  };

  const openWorkOrder = (ticket) => {
    state.activeTicketId = Number(ticket.id);
    elements.workOrderForm?.reset();
    const now = new Date();
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const sla = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (elements.workOrderTicketLabel) elements.workOrderTicketLabel.textContent = `${ticketNumber(ticket)} - ${ticket.customerName || 'Customer'}: ${ticket.subject || 'Support issue'}`;
    populateTechnicians(elements.workOrderTechnician, ticket.assignedTo || '');
    if (elements.workOrderType) elements.workOrderType.value = 'repair';
    if (elements.workOrderPriority) elements.workOrderPriority.value = normalizeStatus(ticket.status) === 'escalated' ? 'urgent' : 'normal';
    if (elements.workOrderStart) elements.workOrderStart.value = toLocalInputValue(now);
    if (elements.workOrderEnd) elements.workOrderEnd.value = toLocalInputValue(end);
    if (elements.workOrderSla) elements.workOrderSla.value = toLocalInputValue(sla);
    if (elements.workOrderInstructions) elements.workOrderInstructions.value = ticket.description || '';
    openModal(elements.workOrderModal);
  };
  const closeWorkOrder = () => {
    closeModal(elements.workOrderModal);
    state.activeTicketId = null;
    elements.workOrderForm?.reset();
  };

  const mutateStatus = async (ticket, status) => {
    try {
      await requestJson(`/api/tickets/${encodeURIComponent(ticket.id)}/status`, {
        method: 'PATCH', body: JSON.stringify({ status })
      });
      showToast(`Ticket marked ${toTitleCase(status)}.`, 'success');
      await loadTickets({ quiet: true });
    } catch (error) {
      showToast(error.message || 'Unable to update ticket.', 'error');
    }
  };

  const archiveTicket = async (ticket, restore = false) => {
    const verb = restore ? 'restore' : 'archive';
    try {
      await requestJson(`/api/tickets/${encodeURIComponent(ticket.id)}/${verb}`, { method: 'PATCH' });
      showToast(restore ? 'Ticket restored.' : 'Ticket archived.', 'success');
      await loadTickets({ quiet: true });
    } catch (error) {
      showToast(error.message || `Unable to ${verb} ticket.`, 'error');
    }
  };

  const confirmAction = async (message, title) => {
    if (typeof window.appConfirm === 'function') return window.appConfirm(message, { title });
    return window.confirm(message);
  };

  const handleTableAction = async (event) => {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;
    const row = actionElement.closest('tr[data-ticket-id]');
    const ticket = state.tickets.find((entry) => Number(entry.id) === Number(row?.dataset.ticketId));
    if (!ticket) return;
    const action = actionElement.dataset.action;
    if (action === 'customer-detail') return openCustomerDetails(ticket);
    if (action === 'edit') return openTicketForm(ticket);
    if (action === 'assign') return openAssignment(ticket);
    if (action === 'work-order') return openWorkOrder(ticket);
    if (action === 'status') {
      const nextStatus = actionElement.dataset.status;
      if (['resolved', 'cancelled'].includes(nextStatus)) {
        const confirmed = await confirmAction(
          nextStatus === 'resolved' ? 'Resolve this ticket?' : 'Cancel this ticket? The record will be retained.',
          nextStatus === 'resolved' ? 'Resolve Ticket' : 'Cancel Ticket'
        );
        if (!confirmed) return;
      }
      return mutateStatus(ticket, nextStatus);
    }
    if (action === 'archive') {
      const confirmed = await confirmAction('Archive this ticket? It can be restored later.', 'Archive Ticket');
      if (confirmed) return archiveTicket(ticket, false);
    }
    if (action === 'restore') return archiveTicket(ticket, true);
  };

  const wireEvents = () => {
    elements.openTicket?.addEventListener('click', () => openTicketForm());
    elements.ticketModalClose?.addEventListener('click', closeTicketForm);
    elements.ticketModalCancel?.addEventListener('click', closeTicketForm);
    elements.assignModalClose?.addEventListener('click', closeAssignment);
    elements.assignModalCancel?.addEventListener('click', closeAssignment);
    elements.workOrderModalClose?.addEventListener('click', closeWorkOrder);
    elements.workOrderModalCancel?.addEventListener('click', closeWorkOrder);
    elements.customerModalClose?.addEventListener('click', () => closeModal(elements.customerModal));
    elements.customerModalDone?.addEventListener('click', () => closeModal(elements.customerModal));
    elements.tableBody?.addEventListener('click', handleTableAction);

    elements.tabs.forEach((tab) => tab.addEventListener('click', () => {
      elements.tabs.forEach((candidate) => {
        const active = candidate === tab;
        candidate.classList.toggle('active', active);
        candidate.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      state.filter = tab.dataset.ticketFilter || 'active';
      state.page = 1;
      renderTickets();
    }));
    elements.search?.addEventListener('input', () => {
      state.search = elements.search.value || '';
      state.page = 1;
      renderTickets();
    });
    elements.pageSize?.addEventListener('change', () => {
      state.pageSize = Number(elements.pageSize.value) || 10;
      localStorage.setItem('ticketPageSize', String(state.pageSize));
      state.page = 1;
      renderTickets();
    });
    elements.previousPage?.addEventListener('click', () => {
      if (state.page > 1) state.page -= 1;
      renderTickets();
    });
    elements.nextPage?.addEventListener('click', () => {
      state.page += 1;
      renderTickets();
    });
    elements.refresh?.addEventListener('click', () => loadTickets());

    elements.ticketForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.submittingTicket) return;
      const customer = state.customerOptions.get(elements.ticketCustomer?.value || '');
      if (!customer) return showToast('Select a customer.', 'error');
      const payload = {
        subject: elements.ticketSubject?.value || '',
        customerName: customerName(customer),
        accountNumber: String(customer.accountNumber || '').trim(),
        contact: customerContact(customer),
        assignedTo: elements.ticketTechnician?.value || '',
        description: elements.ticketDescription?.value?.trim() || ''
      };
      state.submittingTicket = true;
      elements.ticketModalSubmit?.setAttribute('disabled', 'true');
      try {
        const url = state.editingTicketId ? `/api/tickets/${encodeURIComponent(state.editingTicketId)}` : '/api/tickets';
        await requestJson(url, { method: state.editingTicketId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
        showToast(state.editingTicketId ? 'Ticket updated.' : 'Ticket created.', 'success');
        closeTicketForm();
        await loadTickets({ quiet: true });
      } catch (error) {
        showToast(error.message || 'Unable to save ticket.', 'error');
      } finally {
        state.submittingTicket = false;
        elements.ticketModalSubmit?.removeAttribute('disabled');
      }
    });

    elements.assignForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.activeTicketId) return;
      const submit = elements.assignForm.querySelector('button[type="submit"]');
      submit?.setAttribute('disabled', 'true');
      try {
        await requestJson(`/api/tickets/${encodeURIComponent(state.activeTicketId)}/assign`, {
          method: 'PATCH', body: JSON.stringify({ technician: elements.assignTechnician?.value || '' })
        });
        showToast(elements.assignTechnician?.value ? 'Technician assigned.' : 'Assignment cleared.', 'success');
        closeAssignment();
        await loadTickets({ quiet: true });
      } catch (error) {
        showToast(error.message || 'Unable to update assignment.', 'error');
      } finally {
        submit?.removeAttribute('disabled');
      }
    });

    elements.workOrderForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.activeTicketId) return;
      const start = elements.workOrderStart?.value || '';
      const end = elements.workOrderEnd?.value || '';
      if (end && new Date(end) <= new Date(start)) return showToast('Appointment end must be after the start.', 'error');
      const submit = elements.workOrderForm.querySelector('button[type="submit"]');
      submit?.setAttribute('disabled', 'true');
      try {
        const payload = {
          type: elements.workOrderType?.value || 'repair',
          technician: elements.workOrderTechnician?.value || '',
          priority: elements.workOrderPriority?.value || 'normal',
          appointmentStart: start,
          appointmentEnd: end,
          slaDueAt: elements.workOrderSla?.value || '',
          instructions: elements.workOrderInstructions?.value?.trim() || ''
        };
        const result = await requestJson(`/api/tickets/${encodeURIComponent(state.activeTicketId)}/work-order`, {
          method: 'POST', body: JSON.stringify(payload)
        });
        const label = result.job?.jobNumber || `Work order #${result.job?.id || ''}`;
        showToast(`${label} created.`, 'success');
        closeWorkOrder();
        await loadTickets({ quiet: true });
      } catch (error) {
        showToast(error.message || 'Unable to create work order.', 'error');
      } finally {
        submit?.removeAttribute('disabled');
      }
    });

    document.addEventListener('global-search:query', (event) => {
      state.search = String(event?.detail?.query || '');
      if (elements.search) elements.search.value = state.search;
      state.page = 1;
      renderTickets();
    });
  };

  if (elements.pageSize) {
    const allowed = Array.from(elements.pageSize.options).some((option) => Number(option.value) === state.pageSize);
    if (!allowed) state.pageSize = 10;
    elements.pageSize.value = String(state.pageSize);
  }
  document.dispatchEvent(new CustomEvent('page:search-ready', {
    detail: { placeholder: 'Search tickets by number, customer, account, or technician' }
  }));
  applyMikrotikVisibility();
  wireEvents();
  renderTickets();
  void Promise.all([loadTickets(), loadTechnicians(), loadCustomers(), loadMikrotikVisibility()]);
})();
