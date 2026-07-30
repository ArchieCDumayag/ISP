(() => {
    'use strict';

    const API_ROOT = '/api/temp';
    const TEMP_PLAN_RATES = Object.freeze({
        'Old plan': 700,
        Basic: 800,
        Standard: 1000,
        Premium: 1200
    });
    const TEMP_SERVICE_ADDRESSES = Object.freeze(['Poblacion', 'Masical']);
    const TEMP_PLAN_TYPES = Object.freeze(['prepaid', 'postpaid', 'prorate']);
    const TEMP_BILLING_SCHEDULE_MODES = Object.freeze(['date', 'day']);
    const TABLE_SORT_OPTIONS = Object.freeze({
        customer: Object.freeze({
            account: Object.freeze(['account-asc', 'account-desc']),
            name: Object.freeze(['name-asc', 'name-desc']),
            address: Object.freeze(['address-poblacion', 'address-masical']),
            plan: Object.freeze(['plan-asc', 'plan-desc']),
            'plan-type': Object.freeze(['plan-type-asc', 'plan-type-desc']),
            billing: Object.freeze(['billing-asc', 'billing-desc']),
            balance: Object.freeze(['balance-desc', 'balance-asc']),
            status: Object.freeze(['status-active', 'status-inactive'])
        }),
        payment: Object.freeze({
            date: Object.freeze(['date-desc', 'date-asc']),
            receipt: Object.freeze(['receipt-desc', 'receipt-asc']),
            customer: Object.freeze(['customer-asc', 'customer-desc']),
            amount: Object.freeze(['amount-desc', 'amount-asc'])
        })
    });
    const SORT_DESCRIPTIONS = Object.freeze({
        'account-asc': 'account number ascending',
        'account-desc': 'account number descending',
        'name-asc': 'customer name A to Z',
        'name-desc': 'customer name Z to A',
        'address-poblacion': 'Poblacion first',
        'address-masical': 'Masical first',
        'plan-asc': 'lowest plan rate first',
        'plan-desc': 'highest plan rate first',
        'plan-type-asc': 'plan type A to Z',
        'plan-type-desc': 'plan type Z to A',
        'billing-asc': 'earliest billing day first',
        'billing-desc': 'latest billing day first',
        'balance-desc': 'highest balance first',
        'balance-asc': 'lowest balance first',
        'status-active': 'active customers first',
        'status-inactive': 'inactive customers first',
        'date-desc': 'newest date first',
        'date-asc': 'oldest date first',
        'receipt-desc': 'newest receipt first',
        'receipt-asc': 'oldest receipt first',
        'customer-asc': 'customer name A to Z',
        'customer-desc': 'customer name Z to A',
        'amount-desc': 'highest amount first',
        'amount-asc': 'lowest amount first'
    });
    const tableSortState = { customer: 'name-asc', payment: 'date-desc' };
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
    const defaultNextBillingDate = () => {
        const current = new Date(`${today()}T00:00:00Z`);
        const targetYear = current.getUTCFullYear() + (current.getUTCMonth() === 11 ? 1 : 0);
        const targetMonth = (current.getUTCMonth() + 1) % 12;
        const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
        return [
            targetYear,
            String(targetMonth + 1).padStart(2, '0'),
            String(Math.min(current.getUTCDate(), lastDay)).padStart(2, '0')
        ].join('-');
    };
    const filenameFromDisposition = (disposition, fallback) => {
        const encoded = String(disposition || '').match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        if (encoded) {
            try {
                return decodeURIComponent(encoded.replace(/^"|"$/g, ''));
            } catch (_error) {
                // Fall through to the regular filename form.
            }
        }
        return String(disposition || '').match(/filename="?([^";]+)"?/i)?.[1] || fallback;
    };
    const titleCase = (value) => String(value || '').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
    const compareText = (left, right) => String(left || '').localeCompare(String(right || ''), undefined, {
        numeric: true,
        sensitivity: 'base'
    });

    function sortCustomerRows(customers, sortKey) {
        const addressOrder = sortKey === 'address-masical'
            ? { Masical: 0, Poblacion: 1 }
            : { Poblacion: 0, Masical: 1 };
        const statusOrder = sortKey === 'status-inactive'
            ? { inactive: 0, active: 1 }
            : { active: 0, inactive: 1 };
        const comparators = {
            'name-asc': (left, right) => compareText(left.fullName, right.fullName),
            'name-desc': (left, right) => compareText(right.fullName, left.fullName),
            'account-asc': (left, right) => compareText(left.accountNumber, right.accountNumber),
            'account-desc': (left, right) => compareText(right.accountNumber, left.accountNumber),
            'address-poblacion': (left, right) => (addressOrder[left.address] ?? 2) - (addressOrder[right.address] ?? 2),
            'address-masical': (left, right) => (addressOrder[left.address] ?? 2) - (addressOrder[right.address] ?? 2),
            'plan-asc': (left, right) => Number(left.monthlyRate || 0) - Number(right.monthlyRate || 0),
            'plan-desc': (left, right) => Number(right.monthlyRate || 0) - Number(left.monthlyRate || 0),
            'plan-type-asc': (left, right) => compareText(left.planType || 'postpaid', right.planType || 'postpaid'),
            'plan-type-desc': (left, right) => compareText(right.planType || 'postpaid', left.planType || 'postpaid'),
            'billing-asc': (left, right) => Number(left.billingDay || 1) - Number(right.billingDay || 1),
            'billing-desc': (left, right) => Number(right.billingDay || 1) - Number(left.billingDay || 1),
            'balance-desc': (left, right) => Number(right.balance || 0) - Number(left.balance || 0),
            'balance-asc': (left, right) => Number(left.balance || 0) - Number(right.balance || 0),
            'status-active': (left, right) => (statusOrder[left.status] ?? 2) - (statusOrder[right.status] ?? 2),
            'status-inactive': (left, right) => (statusOrder[left.status] ?? 2) - (statusOrder[right.status] ?? 2)
        };
        const comparator = comparators[sortKey] || comparators['name-asc'];
        return [...customers].sort((left, right) => comparator(left, right) || compareText(left.accountNumber, right.accountNumber));
    }

    function sortPaymentRows(payments, sortKey) {
        const compareDatesNewest = (left, right) => compareText(right.date, left.date)
            || compareText(right.createdAt, left.createdAt);
        const comparators = {
            'date-desc': compareDatesNewest,
            'date-asc': (left, right) => compareText(left.date, right.date) || compareText(left.createdAt, right.createdAt),
            'amount-desc': (left, right) => Number(right.amount || 0) - Number(left.amount || 0),
            'amount-asc': (left, right) => Number(left.amount || 0) - Number(right.amount || 0),
            'receipt-desc': (left, right) => compareText(right.receiptNumber, left.receiptNumber),
            'receipt-asc': (left, right) => compareText(left.receiptNumber, right.receiptNumber),
            'customer-asc': (left, right) => compareText(left.customerName, right.customerName),
            'customer-desc': (left, right) => compareText(right.customerName, left.customerName)
        };
        const comparator = comparators[sortKey] || comparators['date-desc'];
        return [...payments].sort((left, right) => comparator(left, right) || compareDatesNewest(left, right));
    }

    function sortDirection(sortKey) {
        return sortKey.endsWith('-desc') || sortKey === 'address-masical' || sortKey === 'status-inactive'
            ? 'descending'
            : 'ascending';
    }

    function renderSortHeaders(group) {
        const currentSort = tableSortState[group];
        document.querySelectorAll(`[data-sort-group="${group}"]`).forEach((button) => {
            const options = TABLE_SORT_OPTIONS[group]?.[button.dataset.sortColumn] || [];
            const isActive = options.includes(currentSort);
            const activeDirection = isActive ? sortDirection(currentSort) : null;
            const nextSort = isActive && currentSort === options[0] ? options[1] : options[0];
            const label = button.dataset.sortLabel || button.textContent.trim();
            const icon = button.querySelector('i');
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
            button.closest('th')?.setAttribute('aria-sort', activeDirection || 'none');
            if (icon) icon.className = `ti ti-${isActive ? `sort-${activeDirection}` : 'arrows-sort'}`;
            const action = `Click to sort ${SORT_DESCRIPTIONS[nextSort] || label.toLowerCase()}.`;
            button.title = isActive
                ? `${label}: ${SORT_DESCRIPTIONS[currentSort]}. ${action}`
                : action;
            button.setAttribute('aria-label', button.title);
        });
    }

    function handleTableSort(event) {
        const button = event.currentTarget;
        const group = button.dataset.sortGroup;
        const options = TABLE_SORT_OPTIONS[group]?.[button.dataset.sortColumn];
        if (!options) return;
        tableSortState[group] = options.includes(tableSortState[group]) && tableSortState[group] === options[0]
            ? options[1]
            : options[0];
        if (group === 'customer') renderCustomers();
        if (group === 'payment') renderPayments();
        renderSortHeaders(group);
    }

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
        const customers = sortCustomerRows(state.customers.filter((customer) => {
            if (status && customer.status !== status) return false;
            if (!term) return true;
            return [
                customer.accountNumber,
                customer.fullName,
                customer.contactNumber,
                customer.email,
                customer.address,
                customer.planName,
                customer.planType
            ].some((value) => String(value || '').toLowerCase().includes(term));
        }), tableSortState.customer);

        byId('customerTableBody').innerHTML = customers.map((customer) => {
            const planType = TEMP_PLAN_TYPES.includes(customer.planType) ? customer.planType : 'postpaid';
            const billingScheduleMode = TEMP_BILLING_SCHEDULE_MODES.includes(customer.billingScheduleMode)
                ? customer.billingScheduleMode
                : 'day';
            const cycleDetail = customer.nextBillingDate ? `Next ${formatDate(customer.nextBillingDate)}` : 'Cycle pending';
            return `<tr>
                <td><span class="account-code">${escapeHtml(customer.accountNumber)}</span></td>
                <td><span class="cell-primary">${escapeHtml(customer.fullName)}</span></td>
                <td><span class="cell-primary">${escapeHtml(customer.address || 'No address')}</span></td>
                <td><span class="cell-primary">${escapeHtml(customer.contactNumber || '—')}</span><span class="cell-secondary">${escapeHtml(customer.email || '')}</span></td>
                <td><span class="cell-primary">${escapeHtml(customer.planName || 'No plan')}</span><span class="cell-secondary">${formatMoney(customer.monthlyRate)} / month</span></td>
                <td><span class="plan-type-pill plan-type-pill--${escapeHtml(planType)}">${escapeHtml(titleCase(planType))}</span></td>
                <td><span class="cell-primary">${billingScheduleMode === 'date' ? 'Exact-date cycle' : `Day ${customer.billingDay}`}</span><span class="cell-secondary">${escapeHtml(cycleDetail)}</span></td>
                <td class="text-end"><strong class="${balanceClass(customer.balance)}">${formatMoney(customer.balance)}</strong><span class="cell-secondary">${customer.balance > 0 ? 'Amount due' : customer.balance < 0 ? 'Advance credit' : 'Clear'}</span></td>
                <td><span class="status-pill status-pill--${escapeHtml(customer.status)}"><i class="ti ti-${customer.status === 'active' ? 'circle-check' : 'circle-minus'}"></i>${escapeHtml(customer.status)}</span></td>
                <td><div class="row-actions">
                    <button class="icon-button" type="button" data-customer-action="statement" data-account="${escapeHtml(customer.accountNumber)}" title="Ledger &amp; payment history" aria-label="Open ledger and payment history"><i class="ti ti-file-description"></i></button>
                    <button class="icon-button" type="button" data-customer-action="payment" data-account="${escapeHtml(customer.accountNumber)}" title="Add transaction" aria-label="Add transaction"><i class="ti ti-cash-plus"></i></button>
                    <button class="icon-button" type="button" data-customer-action="edit" data-account="${escapeHtml(customer.accountNumber)}" title="Edit" aria-label="Edit customer"><i class="ti ti-edit"></i></button>
                    <button class="icon-button icon-button--danger" type="button" data-customer-action="delete" data-account="${escapeHtml(customer.accountNumber)}" title="Delete" aria-label="Delete customer"><i class="ti ti-trash"></i></button>
                </div></td>
            </tr>`;
        }).join('');

        const noResults = customers.length === 0;
        byId('customerEmpty').hidden = !noResults;
        byId('customerTableBody').closest('.table-responsive').hidden = noResults;
        byId('customerResultCount').textContent = `${customers.length} of ${state.customers.length} customers`;
    }

    function renderPayments() {
        const term = byId('paymentSearch').value.trim().toLowerCase();
        const kind = byId('paymentKindFilter').value;
        const payments = sortPaymentRows(state.payments.filter((payment) => {
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
        }), tableSortState.payment);

        byId('paymentTableBody').innerHTML = payments.map((payment) => {
            const credit = payment.kind !== 'charge';
            return `
                <tr>
                    <td><span class="cell-primary">${formatDate(payment.date)}</span></td>
                    <td><span class="account-code">${escapeHtml(payment.receiptNumber)}</span></td>
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
        renderSortHeaders('customer');
        renderSortHeaders('payment');
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
        byId('customerAddress').value = TEMP_SERVICE_ADDRESSES.includes(customer?.address)
            ? customer.address
            : TEMP_SERVICE_ADDRESSES[0];
        byId('customerPlanType').value = TEMP_PLAN_TYPES.includes(customer?.planType)
            ? customer.planType
            : 'postpaid';
        byId('customerActivationDate').value = customer?.activationDate || today();
        byId('customerBillingScheduleMode').value = TEMP_BILLING_SCHEDULE_MODES.includes(customer?.billingScheduleMode)
            ? customer.billingScheduleMode
            : (customer ? 'day' : 'date');
        byId('customerNextBillingDate').min = customer ? '' : today();
        byId('customerNextBillingDate').value = customer?.nextBillingDate || defaultNextBillingDate();
        const storedRate = Number(customer?.monthlyRate);
        const selectedPlan = Object.hasOwn(TEMP_PLAN_RATES, customer?.planName)
            ? customer.planName
            : Object.keys(TEMP_PLAN_RATES).find((planName) => TEMP_PLAN_RATES[planName] === storedRate) || 'Old plan';
        byId('customerPlan').value = selectedPlan;
        byId('customerRate').value = String(TEMP_PLAN_RATES[selectedPlan]);
        byId('customerBillingDay').value = customer?.billingDay || 1;
        byId('customerOpeningBalance').value = customer?.openingBalance ?? 0;
        byId('customerStatus').value = customer?.status || 'active';
        byId('customerNotes').value = customer?.notes || '';
        updateCustomerBillingScheduleFields();
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
        const transactions = state.payments
            .filter((payment) => payment.accountNumber === accountNumber)
            .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt));
        const paymentHistory = transactions
            .filter((payment) => payment.kind === 'payment')
            .slice()
            .sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt));
        const totalCharges = transactions
            .filter((payment) => payment.kind === 'charge')
            .reduce((total, payment) => total + Number(payment.amount || 0), 0);
        const totalPayments = paymentHistory.reduce((total, payment) => total + Number(payment.amount || 0), 0);
        const planType = TEMP_PLAN_TYPES.includes(customer.planType) ? customer.planType : 'postpaid';
        const billingScheduleMode = TEMP_BILLING_SCHEDULE_MODES.includes(customer.billingScheduleMode)
            ? customer.billingScheduleMode
            : 'day';
        const nextBillingLabel = customer.nextBillingDate ? formatDate(customer.nextBillingDate) : 'Cycle pending';
        let runningBalance = Number(customer.openingBalance) || 0;
        const ledgerRows = transactions.map((payment) => {
            runningBalance += Number(payment.balanceImpact) || 0;
            const details = [payment.paymentMethod, payment.reference || payment.description].filter(Boolean).join(' · ') || '—';
            const debit = payment.kind === 'charge' ? formatMoney(payment.amount) : '—';
            const credit = payment.kind === 'charge' ? '—' : formatMoney(payment.amount);
            return `<tr><td>${formatDate(payment.date)}</td><td class="account-code">${escapeHtml(payment.receiptNumber)}</td><td><span class="kind-pill kind-pill--${escapeHtml(payment.kind)}">${escapeHtml(titleCase(payment.kind))}</span></td><td>${escapeHtml(details)}</td><td class="text-end transaction-debit">${debit}</td><td class="text-end transaction-credit">${credit}</td><td class="text-end"><strong class="${balanceClass(runningBalance)}">${formatMoney(runningBalance)}</strong></td></tr>`;
        }).join('');
        const paymentHistoryRows = paymentHistory.map((payment) => `
            <tr>
                <td>${formatDate(payment.date)}</td>
                <td class="account-code">${escapeHtml(payment.receiptNumber)}</td>
                <td>${escapeHtml(payment.paymentMethod || '—')}</td>
                <td>${escapeHtml(payment.reference || payment.description || '—')}</td>
                <td>${escapeHtml(payment.recordedBy || 'Admin')}</td>
                <td class="text-end"><strong class="transaction-credit">${formatMoney(payment.amount)}</strong></td>
            </tr>`).join('');
        byId('statementTitle').textContent = `${customer.fullName} — Ledger & payment history`;
        byId('statementContent').innerHTML = `
            <article class="statement-card">
                <div class="statement-heading">
                    <div>
                        <div class="statement-customer-line"><h3>${escapeHtml(customer.fullName)}</h3><span class="status-pill status-pill--${escapeHtml(customer.status)}">${escapeHtml(customer.status)}</span></div>
                        <p><span class="account-code">${escapeHtml(customer.accountNumber)}</span> · ${escapeHtml(customer.address || 'No address')}</p>
                        <p>${escapeHtml(customer.planName || 'No plan')} · ${formatMoney(customer.monthlyRate)} monthly · ${escapeHtml(titleCase(planType))} · ${billingScheduleMode === 'date' ? `Exact-date cycle (${escapeHtml(nextBillingLabel)})` : `Billing day ${customer.billingDay}`}</p>
                    </div>
                    <div class="statement-balance"><span>Current balance</span><strong class="${balanceClass(customer.balance)}">${formatMoney(customer.balance)}</strong><small>${customer.balance > 0 ? 'Amount due' : customer.balance < 0 ? 'Advance credit' : 'Account is clear'}</small></div>
                </div>
                <div class="statement-summary" aria-label="Customer ledger summary">
                    <div><span>Opening balance</span><strong>${formatMoney(customer.openingBalance)}</strong></div>
                    <div><span>Total charges</span><strong class="transaction-debit">${formatMoney(totalCharges)}</strong></div>
                    <div><span>Payments received</span><strong class="transaction-credit">${formatMoney(totalPayments)}</strong></div>
                    <div><span>Next billing</span><strong>${escapeHtml(nextBillingLabel)}</strong></div>
                </div>
                <section class="statement-section" aria-labelledby="ledgerHeading">
                    <div class="statement-section__heading"><div><span class="statement-section__icon"><i class="ti ti-list-details"></i></span><div><h4 id="ledgerHeading">Account ledger</h4><p>All charges, payments, rebates, and discounts in balance order.</p></div></div><span class="statement-count">${transactions.length} transaction${transactions.length === 1 ? '' : 's'}</span></div>
                    <div class="statement-table-wrap">
                        <table class="statement-table statement-table--ledger" id="customerLedgerTable"><thead><tr><th>Date</th><th>Receipt</th><th>Type</th><th>Details</th><th class="text-end">Debit</th><th class="text-end">Credit</th><th class="text-end">Balance</th></tr></thead><tbody><tr class="statement-opening-row"><td>—</td><td>—</td><td>Opening</td><td>Starting account balance</td><td class="text-end">—</td><td class="text-end">—</td><td class="text-end"><strong>${formatMoney(customer.openingBalance)}</strong></td></tr>${ledgerRows || '<tr><td class="statement-empty-row" colspan="7">No ledger transactions recorded.</td></tr>'}</tbody></table>
                    </div>
                </section>
                <section class="statement-section" aria-labelledby="paymentHistoryHeading">
                    <div class="statement-section__heading"><div><span class="statement-section__icon statement-section__icon--success"><i class="ti ti-history"></i></span><div><h4 id="paymentHistoryHeading">Payment history</h4><p>Payments received from this customer only.</p></div></div><div class="statement-section__total"><span>${paymentHistory.length} payment${paymentHistory.length === 1 ? '' : 's'}</span><strong>${formatMoney(totalPayments)}</strong></div></div>
                    <div class="statement-table-wrap">
                        <table class="statement-table statement-table--payments" id="customerPaymentHistory"><thead><tr><th>Date</th><th>Receipt</th><th>Method</th><th>Reference</th><th>Recorded by</th><th class="text-end">Amount</th></tr></thead><tbody>${paymentHistoryRows || '<tr><td class="statement-empty-row" colspan="6">No payments recorded for this customer.</td></tr>'}</tbody></table>
                    </div>
                </section>
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

    function synchronizeCustomerPlanAndRate(source) {
        if (source === 'plan') {
            byId('customerRate').value = String(TEMP_PLAN_RATES[byId('customerPlan').value] || 700);
            return;
        }
        const selectedRate = Number(byId('customerRate').value);
        byId('customerPlan').value = Object.keys(TEMP_PLAN_RATES)
            .find((planName) => TEMP_PLAN_RATES[planName] === selectedRate) || 'Old plan';
    }

    function updateCustomerBillingScheduleFields() {
        const billingScheduleMode = byId('customerBillingScheduleMode').value;
        const usesExactDate = billingScheduleMode === 'date';
        byId('customerNextBillingDateField').hidden = !usesExactDate;
        byId('customerNextBillingDate').disabled = !usesExactDate;
        byId('customerNextBillingDate').required = usesExactDate;
        byId('customerBillingDayField').hidden = usesExactDate;
        byId('customerBillingDay').disabled = usesExactDate;
        if (usesExactDate && !byId('customerNextBillingDate').value) {
            byId('customerNextBillingDate').value = defaultNextBillingDate();
        }
        updateCustomerCycleHint();
    }

    function updateCustomerCycleHint() {
        const planType = byId('customerPlanType').value;
        const billingScheduleMode = byId('customerBillingScheduleMode').value;
        const billingDay = Math.min(31, Math.max(1, Number(byId('customerBillingDay').value) || 1));
        const nextBillingDate = byId('customerNextBillingDate').value;
        const hint = byId('customerCycleHint');
        hint.classList.toggle('cycle-hint--prepaid', planType === 'prepaid');
        hint.classList.toggle('cycle-hint--prorate', planType === 'prorate');
        if (billingScheduleMode === 'date') {
            const selectedDate = nextBillingDate ? formatDate(nextBillingDate) : 'the selected date';
            hint.querySelector('span').textContent = `Opening balance stays manual. The first automatic full monthly charge is on ${selectedDate}, then it repeats monthly.`;
            return;
        }
        if (planType === 'prorate') {
            hint.querySelector('span').textContent = `The first charge is prorated from Activation date to Billing day ${billingDay}. Later cycles charge the full monthly rate.`;
            return;
        }
        hint.querySelector('span').textContent = `The full monthly rate is automatically charged every month on Billing day ${billingDay}. Opening balance remains exactly as entered.`;
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

    async function exportWorkspace(format) {
        const normalizedFormat = format === 'xlsx' ? 'xlsx' : 'json';
        const formatButtons = [byId('exportJsonBtn'), byId('exportExcelBtn')];
        formatButtons.forEach((button) => { button.disabled = true; });
        try {
            const response = await fetch(`${API_ROOT}/export?format=${normalizedFormat}`, {
                credentials: 'same-origin'
            });
            if (response.status === 401) {
                window.location.assign('/login.html');
                throw new Error('Your session expired. Sign in again.');
            }
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || `Export failed (${response.status}).`);
            }
            const blob = await response.blob();
            const fallback = `temp-workspace.${normalizedFormat === 'xlsx' ? 'xlsx' : 'json'}`;
            const filename = filenameFromDisposition(response.headers.get('Content-Disposition'), fallback);
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            link.hidden = true;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
            byId('exportFormatDialog').close();
            showToast(`Complete Temp backup exported as ${normalizedFormat === 'xlsx' ? 'Excel' : 'JSON'}.`);
        } catch (error) {
            showToast(error.message || 'Unable to export the Temp workspace.', 'error');
        } finally {
            formatButtons.forEach((button) => { button.disabled = false; });
        }
    }

    async function importWorkspace(file) {
        if (!file) return;
        const extension = file.name.toLowerCase().match(/\.(json|xlsx|xls)$/)?.[1];
        if (!extension) {
            showToast('Select an exported Temp JSON, XLSX, or XLS file.', 'error');
            byId('importWorkspaceFile').value = '';
            return;
        }
        if (!window.confirm('Importing this file will replace every Temp customer and transaction. Continue?')) {
            byId('importWorkspaceFile').value = '';
            return;
        }
        const importButton = byId('importWorkspaceBtn');
        importButton.disabled = true;
        try {
            const response = await fetch(`${API_ROOT}/import-file`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Import-Filename': encodeURIComponent(file.name)
                },
                body: file
            });
            if (response.status === 401) {
                window.location.assign('/login.html');
                throw new Error('Your session expired. Sign in again.');
            }
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || `Import failed (${response.status}).`);
            updateState(result);
            renderAll();
            showToast(result.message || 'Temp workspace imported.');
        } catch (error) {
            showToast(error.message || 'Unable to import that file.', 'error');
        } finally {
            importButton.disabled = false;
            byId('importWorkspaceFile').value = '';
        }
    }

    async function clearWorkspaceData() {
        const customerCount = state.customers.length;
        const transactionCount = state.payments.length;
        if (!customerCount && !transactionCount) {
            showToast('The Temp workspace is already empty.');
            return;
        }
        const confirmed = window.confirm(
            `Permanently delete all ${customerCount} Temp customers and ${transactionCount} transactions? `
            + 'This cannot be undone. Export a backup first if you may need these records.'
        );
        if (!confirmed) return;

        const button = byId('clearWorkspaceBtn');
        button.disabled = true;
        try {
            const result = await api('/workspace', { method: 'DELETE' });
            updateState(result);
            renderAll();
            showToast(result.message || 'All Temp data was cleared.');
        } catch (error) {
            showToast(error.message || 'Unable to clear the Temp workspace.', 'error');
        } finally {
            button.disabled = false;
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
    document.querySelectorAll('[data-sort-group]').forEach((button) => button.addEventListener('click', handleTableSort));
    byId('customerTableBody').addEventListener('click', handleCustomerAction);
    byId('paymentTableBody').addEventListener('click', handlePaymentAction);
    byId('addCustomerBtn').addEventListener('click', () => openCustomerDialog());
    byId('addPaymentBtn').addEventListener('click', () => openPaymentDialog());
    byId('customerForm').addEventListener('submit', saveCustomer);
    byId('customerPlan').addEventListener('change', () => synchronizeCustomerPlanAndRate('plan'));
    byId('customerRate').addEventListener('change', () => synchronizeCustomerPlanAndRate('rate'));
    byId('customerPlanType').addEventListener('change', updateCustomerCycleHint);
    byId('customerBillingScheduleMode').addEventListener('change', updateCustomerBillingScheduleFields);
    byId('customerNextBillingDate').addEventListener('change', updateCustomerCycleHint);
    byId('customerBillingDay').addEventListener('input', updateCustomerCycleHint);
    byId('paymentForm').addEventListener('submit', savePayment);
    byId('clearWorkspaceBtn').addEventListener('click', clearWorkspaceData);
    byId('refreshWorkspaceBtn').addEventListener('click', () => loadWorkspace({ notify: true }));
    byId('exportWorkspaceBtn').addEventListener('click', () => byId('exportFormatDialog').showModal());
    byId('exportJsonBtn').addEventListener('click', () => exportWorkspace('json'));
    byId('exportExcelBtn').addEventListener('click', () => exportWorkspace('xlsx'));
    byId('importWorkspaceBtn').addEventListener('click', () => byId('importWorkspaceFile').click());
    byId('importWorkspaceFile').addEventListener('change', (event) => importWorkspace(event.target.files?.[0]));
    byId('printStatementBtn').addEventListener('click', () => window.print());
    window.addEventListener('hashchange', () => activatePanel(location.hash.toLowerCase() === '#billing' ? 'billing' : 'customers', { updateHash: false }));

    renderSortHeaders('customer');
    renderSortHeaders('payment');
    activatePanel(location.hash.toLowerCase() === '#billing' ? 'billing' : 'customers', { updateHash: false });
    loadWorkspace();
})();
