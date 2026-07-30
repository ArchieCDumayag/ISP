(() => {
    'use strict';

    const API_ROOT = '/api/temp';
    const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
    const dateFormatter = new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    const state = {
        workspace: { locationName: 'Secondary Location', updatedAt: null },
        customers: [],
        payments: [],
        summary: {}
    };
    let toastTimer = null;

    const byId = (id) => document.getElementById(id);
    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    const formatMoney = (value) => currency.format(Number(value) || 0);
    const formatDate = (value) => {
        const parsed = new Date(`${value}T00:00:00`);
        return Number.isNaN(parsed.getTime()) ? String(value || '') : dateFormatter.format(parsed);
    };
    const today = () => new Date().toISOString().slice(0, 10);
    const titleCase = (value) => String(value || '').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());

    function showToast(message, type = 'success') {
        const toast = byId('tempToast');
        toast.classList.toggle('temp-toast--error', type === 'error');
        toast.classList.toggle('temp-toast--success', type !== 'error');
        toast.querySelector('i').className = type === 'error' ? 'ti ti-alert-circle' : 'ti ti-circle-check';
        toast.querySelector('span').textContent = message;
        toast.hidden = false;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4500);
    }

    async function api(path, options = {}) {
        const requestOptions = { credentials: 'same-origin', ...options };
        if (requestOptions.body && !(requestOptions.body instanceof FormData)) {
            requestOptions.headers = { 'Content-Type': 'application/json', ...(requestOptions.headers || {}) };
            if (typeof requestOptions.body !== 'string') requestOptions.body = JSON.stringify(requestOptions.body);
        }
        const response = await fetch(`${API_ROOT}${path}`, requestOptions);
        if (response.status === 401) {
            window.location.assign('/login.html');
            throw new Error('Your session expired. Sign in again.');
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
        return payload;
    }

    function updateState(payload) {
        state.workspace = payload.workspace || state.workspace;
        state.customers = Array.isArray(payload.customers) ? payload.customers : [];
        state.payments = Array.isArray(payload.payments) ? payload.payments : [];
        state.summary = payload.summary || {};
    }

    function renderSummary() {
        byId('workspaceTitle').textContent = state.workspace.locationName || 'Secondary Location';
        byId('metricCustomers').textContent = String(state.summary.customerCount || 0);
        byId('metricActive').textContent = `${state.summary.activeCustomerCount || 0} active`;
        byId('metricPayments').textContent = formatMoney(state.summary.totalPayments);
        byId('metricPaymentCount').textContent = `${state.summary.paymentCount || 0} transactions`;
        byId('metricCharges').textContent = formatMoney(state.summary.totalCharges);
        byId('metricOutstanding').textContent = formatMoney(state.summary.outstandingBalance);
        byId('metricAdvance').textContent = `${formatMoney(state.summary.advanceBalance)} advance`;
    }

    function balanceClass(balance) {
        if (balance > 0) return 'balance-due';
        if (balance < 0) return 'balance-advance';
        return 'balance-clear';
    }

    function renderCustomers() {
        const term = byId('customerSearch').value.trim().toLowerCase();
        const status = byId('customerStatusFilter').value;
        const customers = state.customers.filter((customer) => {
            if (status && customer.status !== status) return false;
            if (!term) return true;
            return [
                customer.accountNumber,
                customer.fullName,
                customer.contactNumber,
                customer.email,
                customer.address,
                customer.planName
            ].some((value) => String(value || '').toLowerCase().includes(term));
        });

        byId('customerTableBody').innerHTML = customers.map((customer) => `
            <tr>
                <td><span class="account-code">${escapeHtml(customer.accountNumber)}</span></td>
                <td><span class="cell-primary">${escapeHtml(customer.fullName)}</span><span class="cell-secondary" title="${escapeHtml(customer.address)}">${escapeHtml(customer.address || 'No address')}</span></td>
                <td><span class="cell-primary">${escapeHtml(customer.contactNumber || '—')}</span><span class="cell-secondary">${escapeHtml(customer.email || '')}</span></td>
                <td><span class="cell-primary">${escapeHtml(customer.planName || 'No plan')}</span><span class="cell-secondary">${formatMoney(customer.monthlyRate)} / month</span></td>
                <td><span class="cell-primary">Day ${customer.billingDay}</span><span class="cell-secondary">${customer.paymentCount} transaction${customer.paymentCount === 1 ? '' : 's'}</span></td>
                <td class="text-end"><strong class="${balanceClass(customer.balance)}">${formatMoney(customer.balance)}</strong><span class="cell-secondary">${customer.balance > 0 ? 'Amount due' : customer.balance < 0 ? 'Advance credit' : 'Clear'}</span></td>
                <td><span class="status-pill status-pill--${escapeHtml(customer.status)}"><i class="ti ti-${customer.status === 'active' ? 'circle-check' : 'circle-minus'}"></i>${escapeHtml(customer.status)}</span></td>
                <td><div class="row-actions">
                    <button class="icon-button" type="button" data-customer-action="statement" data-account="${escapeHtml(customer.accountNumber)}" title="Statement" aria-label="Open statement"><i class="ti ti-file-description"></i></button>
                    <button class="icon-button" type="button" data-customer-action="payment" data-account="${escapeHtml(customer.accountNumber)}" title="Add transaction" aria-label="Add transaction"><i class="ti ti-cash-plus"></i></button>
                    <button class="icon-button" type="button" data-customer-action="edit" data-account="${escapeHtml(customer.accountNumber)}" title="Edit" aria-label="Edit customer"><i class="ti ti-edit"></i></button>
                    <button class="icon-button icon-button--danger" type="button" data-customer-action="delete" data-account="${escapeHtml(customer.accountNumber)}" title="Delete" aria-label="Delete customer"><i class="ti ti-trash"></i></button>
                </div></td>
            </tr>
        `).join('');

        const noResults = customers.length === 0;
        byId('customerEmpty').hidden = !noResults;
        byId('customerTableBody').closest('.table-responsive').hidden = noResults;
        byId('customerResultCount').textContent = `${customers.length} of ${state.customers.length} customers`;
    }

    function renderPayments() {
        const term = byId('paymentSearch').value.trim().toLowerCase();
        const kind = byId('paymentKindFilter').value;
        const payments = state.payments.filter((payment) => {
            if (kind && payment.kind !== kind) return false;
            if (!term) return true;
            return [
                payment.customerName,
                payment.accountNumber,
                payment.receiptNumber,
                payment.reference,
                payment.paymentMethod,
                payment.description
            ].some((value) => String(value || '').toLowerCase().includes(term));
        });

        byId('paymentTableBody').innerHTML = payments.map((payment) => {
            const credit = payment.kind !== 'charge';
            return `
                <tr>
                    <td><span class="cell-primary">${formatDate(payment.date)}</span><span class="cell-secondary account-code">${escapeHtml(payment.receiptNumber)}</span></td>
                    <td><span class="cell-primary">${escapeHtml(payment.customerName)}</span><span class="cell-secondary account-code">${escapeHtml(payment.accountNumber)}</span></td>
                    <td><span class="kind-pill kind-pill--${escapeHtml(payment.kind)}">${escapeHtml(titleCase(payment.kind))}</span></td>
                    <td><span class="cell-primary">${escapeHtml(payment.paymentMethod || '—')}</span><span class="cell-secondary" title="${escapeHtml(payment.reference)}">${escapeHtml(payment.reference || payment.description || '')}</span></td>
                    <td><span class="cell-primary">${escapeHtml(payment.recordedBy || 'Admin')}</span></td>
                    <td class="text-end"><strong class="${credit ? 'transaction-credit' : 'transaction-debit'}">${credit ? '−' : '+'}${formatMoney(payment.amount)}</strong></td>
                    <td><div class="row-actions">
                        <button class="icon-button" type="button" data-payment-action="edit" data-payment-id="${escapeHtml(payment.id)}" title="Edit" aria-label="Edit transaction"><i class="ti ti-edit"></i></button>
                        <button class="icon-button icon-button--danger" type="button" data-payment-action="delete" data-payment-id="${escapeHtml(payment.id)}" title="Delete" aria-label="Delete transaction"><i class="ti ti-trash"></i></button>
                    </div></td>
                </tr>`;
        }).join('');

        const noResults = payments.length === 0;
        byId('paymentEmpty').hidden = !noResults;
        byId('paymentTableBody').closest('.table-responsive').hidden = noResults;
        byId('paymentResultCount').textContent = `${payments.length} of ${state.payments.length} transactions`;
    }

    function renderPaymentCustomerOptions(selectedAccount = '') {
        byId('paymentCustomer').innerHTML = [
            '<option value="">Select a Temp customer</option>',
            ...state.customers.map((customer) => `<option value="${escapeHtml(customer.accountNumber)}"${customer.accountNumber === selectedAccount ? ' selected' : ''}>${escapeHtml(customer.accountNumber)} — ${escapeHtml(customer.fullName)}</option>`)
        ].join('');
    }

    function renderAll() {
        renderSummary();
        renderCustomers();
        renderPayments();
        renderPaymentCustomerOptions(byId('paymentCustomer').value);
    }

    async function loadWorkspace(options = {}) {
        try {
            const payload = await api('/workspace');
            updateState(payload);
            renderAll();
            if (options.notify) showToast('Temp workspace refreshed.');
        } catch (error) {
            showToast(error.message, 'error');
        }
    }

    function activatePanel(panelName, options = {}) {
        const isBilling = panelName === 'billing';
        byId('customersPanel').hidden = isBilling;
        byId('billingPanel').hidden = !isBilling;
        byId('customersTab').classList.toggle('active', !isBilling);
        byId('billingTab').classList.toggle('active', isBilling);
        byId('customersTab').setAttribute('aria-selected', isBilling ? 'false' : 'true');
        byId('billingTab').setAttribute('aria-selected', isBilling ? 'true' : 'false');
        byId('customersTab').tabIndex = isBilling ? -1 : 0;
        byId('billingTab').tabIndex = isBilling ? 0 : -1;
        if (options.updateHash !== false) history.replaceState(null, '', isBilling ? '#billing' : '#customers');
        if (options.focus) (isBilling ? byId('billingTab') : byId('customersTab')).focus();
    }

    function openCustomerDialog(customer = null) {
        byId('customerForm').reset();
        byId('customerEditAccount').value = customer?.accountNumber || '';
        byId('customerDialogTitle').textContent = customer ? 'Edit customer' : 'Add customer';
        byId('customerAccount').disabled = Boolean(customer);
        byId('customerAccount').value = customer?.accountNumber || '';
        byId('customerFirstName').value = customer?.firstName || '';
        byId('customerLastName').value = customer?.lastName || '';
        byId('customerContact').value = customer?.contactNumber || '';
        byId('customerEmail').value = customer?.email || '';
        byId('customerAddress').value = customer?.address || '';
        byId('customerPlan').value = customer?.planName || '';
        byId('customerRate').value = customer?.monthlyRate ?? 0;
        byId('customerBillingDay').value = customer?.billingDay || 1;
        byId('customerOpeningBalance').value = customer?.openingBalance ?? 0;
        byId('customerStatus').value = customer?.status || 'active';
        byId('customerNotes').value = customer?.notes || '';
        byId('customerDialog').showModal();
        window.setTimeout(() => byId('customerFirstName').focus(), 0);
    }

    function openPaymentDialog(payment = null, accountNumber = '') {
        if (!state.customers.length) {
            showToast('Add a Temp customer before recording a transaction.', 'error');
            return;
        }
        byId('paymentForm').reset();
        byId('paymentEditId').value = payment?.id || '';
        byId('paymentDialogTitle').textContent = payment ? 'Edit transaction' : 'Add transaction';
        renderPaymentCustomerOptions(payment?.accountNumber || accountNumber);
        byId('paymentCustomer').value = payment?.accountNumber || accountNumber || '';
        byId('paymentKind').value = payment?.kind || 'payment';
        byId('paymentAmount').value = payment?.amount || '';
        byId('paymentDate').value = payment?.date || today();
        byId('paymentMethod').value = payment?.paymentMethod || 'Cash';
        byId('paymentReference').value = payment?.reference || '';
        byId('paymentDescription').value = payment?.description || '';
        byId('paymentDialog').showModal();
        window.setTimeout(() => byId('paymentCustomer').focus(), 0);
    }

    function openStatement(accountNumber) {
        const customer = state.customers.find((item) => item.accountNumber === accountNumber);
        if (!customer) return;
        const payments = state.payments
            .filter((payment) => payment.accountNumber === accountNumber)
            .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt));
        let runningBalance = Number(customer.openingBalance) || 0;
        const rows = payments.map((payment) => {
            runningBalance += Number(payment.balanceImpact) || 0;
            return `<tr><td>${formatDate(payment.date)}</td><td>${escapeHtml(payment.receiptNumber)}</td><td>${escapeHtml(titleCase(payment.kind))}</td><td>${escapeHtml(payment.reference || payment.description || '—')}</td><td>${formatMoney(runningBalance)}</td></tr>`;
        }).join('');
        byId('statementTitle').textContent = `${customer.fullName} — Statement`;
        byId('statementContent').innerHTML = `
            <article class="statement-card">
                <div class="statement-heading"><div><h3>${escapeHtml(customer.fullName)}</h3><p>${escapeHtml(customer.accountNumber)} · ${escapeHtml(customer.address || 'No address')}</p><p>${escapeHtml(customer.planName || 'No plan')} · Billing day ${customer.billingDay}</p></div><div class="statement-balance"><span class="cell-secondary">Current balance</span><strong class="${balanceClass(customer.balance)}">${formatMoney(customer.balance)}</strong></div></div>
                <table class="statement-table"><thead><tr><th>Date</th><th>Receipt</th><th>Type</th><th>Details</th><th>Running balance</th></tr></thead><tbody><tr><td>—</td><td>—</td><td>Opening balance</td><td>Starting account balance</td><td>${formatMoney(customer.openingBalance)}</td></tr>${rows || '<tr><td colspan="5">No transactions recorded.</td></tr>'}</tbody></table>
            </article>`;
        byId('statementDialog').showModal();
    }

    async function saveCustomer(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const accountNumber = byId('customerEditAccount').value;
        const payload = Object.fromEntries(new FormData(form).entries());
        payload.monthlyRate = Number(payload.monthlyRate || 0);
        payload.openingBalance = Number(payload.openingBalance || 0);
        payload.billingDay = Number(payload.billingDay || 1);
        const button = byId('saveCustomerBtn');
        button.disabled = true;
        try {
            await api(accountNumber ? `/customers/${encodeURIComponent(accountNumber)}` : '/customers', {
                method: accountNumber ? 'PUT' : 'POST',
                body: payload
            });
            byId('customerDialog').close();
            await loadWorkspace();
            showToast(accountNumber ? 'Temp customer updated.' : 'Temp customer added.');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    }

    async function savePayment(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const paymentId = byId('paymentEditId').value;
        const payload = Object.fromEntries(new FormData(form).entries());
        payload.amount = Number(payload.amount);
        const button = byId('savePaymentBtn');
        button.disabled = true;
        try {
            await api(paymentId ? `/payments/${encodeURIComponent(paymentId)}` : '/payments', {
                method: paymentId ? 'PUT' : 'POST',
                body: payload
            });
            byId('paymentDialog').close();
            await loadWorkspace();
            showToast(paymentId ? 'Temp transaction updated.' : 'Temp transaction recorded.');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    }

    async function handleCustomerAction(event) {
        const button = event.target.closest('[data-customer-action]');
        if (!button) return;
        const accountNumber = button.dataset.account;
        const customer = state.customers.find((item) => item.accountNumber === accountNumber);
        if (!customer) return;
        if (button.dataset.customerAction === 'edit') openCustomerDialog(customer);
        if (button.dataset.customerAction === 'payment') openPaymentDialog(null, accountNumber);
        if (button.dataset.customerAction === 'statement') openStatement(accountNumber);
        if (button.dataset.customerAction === 'delete') {
            if (!window.confirm(`Delete ${customer.fullName} from the Temp workspace?`)) return;
            try {
                await api(`/customers/${encodeURIComponent(accountNumber)}`, { method: 'DELETE' });
                await loadWorkspace();
                showToast('Temp customer deleted.');
            } catch (error) {
                showToast(error.message, 'error');
            }
        }
    }

    async function handlePaymentAction(event) {
        const button = event.target.closest('[data-payment-action]');
        if (!button) return;
        const payment = state.payments.find((item) => item.id === button.dataset.paymentId);
        if (!payment) return;
        if (button.dataset.paymentAction === 'edit') openPaymentDialog(payment);
        if (button.dataset.paymentAction === 'delete') {
            if (!window.confirm(`Delete transaction ${payment.receiptNumber}?`)) return;
            try {
                await api(`/payments/${encodeURIComponent(payment.id)}`, { method: 'DELETE' });
                await loadWorkspace();
                showToast('Temp transaction deleted.');
            } catch (error) {
                showToast(error.message, 'error');
            }
        }
    }

    function exportWorkspace() {
        const link = document.createElement('a');
        link.href = `${API_ROOT}/export?t=${Date.now()}`;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    async function importWorkspace(file) {
        if (!file) return;
        try {
            const payload = JSON.parse(await file.text());
            if (payload.kind !== 'isp-temp-workspace-export') throw new Error('Select a valid Temp workspace export file.');
            const customerCount = Array.isArray(payload.data?.customers) ? payload.data.customers.length : 0;
            const paymentCount = Array.isArray(payload.data?.payments) ? payload.data.payments.length : 0;
            if (!window.confirm(`Replace this Temp workspace with ${customerCount} customers and ${paymentCount} transactions from the file?`)) return;
            const result = await api('/import', { method: 'POST', body: payload });
            updateState(result);
            renderAll();
            showToast(result.message || 'Temp workspace imported.');
        } catch (error) {
            showToast(error.message || 'Unable to import that file.', 'error');
        } finally {
            byId('importWorkspaceFile').value = '';
        }
    }

    document.querySelectorAll('[data-panel]').forEach((tab) => {
        tab.addEventListener('click', () => activatePanel(tab.dataset.panel));
        tab.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            activatePanel(tab.dataset.panel === 'customers' ? 'billing' : 'customers', { focus: true });
        });
    });
    document.querySelectorAll('[data-close-dialog]').forEach((button) => {
        button.addEventListener('click', () => byId(button.dataset.closeDialog).close());
    });
    document.querySelectorAll('.temp-dialog').forEach((dialog) => {
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) dialog.close();
        });
    });

    byId('customerSearch').addEventListener('input', renderCustomers);
    byId('customerStatusFilter').addEventListener('change', renderCustomers);
    byId('paymentSearch').addEventListener('input', renderPayments);
    byId('paymentKindFilter').addEventListener('change', renderPayments);
    byId('customerTableBody').addEventListener('click', handleCustomerAction);
    byId('paymentTableBody').addEventListener('click', handlePaymentAction);
    byId('addCustomerBtn').addEventListener('click', () => openCustomerDialog());
    byId('addPaymentBtn').addEventListener('click', () => openPaymentDialog());
    byId('customerForm').addEventListener('submit', saveCustomer);
    byId('paymentForm').addEventListener('submit', savePayment);
    byId('refreshWorkspaceBtn').addEventListener('click', () => loadWorkspace({ notify: true }));
    byId('exportWorkspaceBtn').addEventListener('click', exportWorkspace);
    byId('importWorkspaceBtn').addEventListener('click', () => byId('importWorkspaceFile').click());
    byId('importWorkspaceFile').addEventListener('change', (event) => importWorkspace(event.target.files?.[0]));
    byId('printStatementBtn').addEventListener('click', () => window.print());
    window.addEventListener('hashchange', () => activatePanel(location.hash.toLowerCase() === '#billing' ? 'billing' : 'customers', { updateHash: false }));

    activatePanel(location.hash.toLowerCase() === '#billing' ? 'billing' : 'customers', { updateHash: false });
    loadWorkspace();
})();
