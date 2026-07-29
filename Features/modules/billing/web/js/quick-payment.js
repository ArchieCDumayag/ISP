(function () {
    const form = document.getElementById('quickPayLookupForm');
    const accountInput = document.getElementById('quickPayAccount');
    const lookupBtn = document.getElementById('quickPayLookupBtn');
    const inputWrap = document.getElementById('quickPayInputWrap');
    const resultPanel = document.getElementById('quickPayResult');
    const balanceEl = document.getElementById('quickPayBalance');
    const fullAmountEl = document.getElementById('quickPayFullAmount');
    const customerNameEl = document.getElementById('quickPayCustomerName');
    const accountLabel = document.getElementById('quickPayAccountLabel');
    const planNameEl = document.getElementById('quickPayPlanName');
    const dueDateEl = document.getElementById('quickPayDueDate');
    const statusEl = document.getElementById('quickPayStatus');
    const payBtn = document.getElementById('quickPaySubmitBtn');
    const businessNameEl = document.getElementById('quickPayBusinessName');
    const logoEl = document.getElementById('quickPayLogo');
    const customAmountWrap = document.getElementById('quickPayCustomAmountWrap');
    const customAmountInput = document.getElementById('quickPayCustomAmount');

    const state = {
        accountNumber: '',
        amountDue: 0,
        amountMode: 'full',
        customAmount: 0,
        method: 'gcash',
        paymentMethods: ['gcash', 'paymaya', 'grabpay', 'shopeepay']
    };

    const methodLabels = {
        gcash: 'GCash',
        paymaya: 'Maya',
        maya: 'Maya',
        grabpay: 'GrabPay',
        grab: 'GrabPay',
        shopeepay: 'ShopeePay',
        shopee: 'ShopeePay'
    };

    const pesoFormatter = new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2
    });

    const normalizeAccount = (value) => {
        const raw = String(value || '').trim();
        const digits = raw.replace(/\D+/g, '');
        return digits || raw;
    };

    const parseAmount = (value) => {
        const amount = Number(String(value || '').replace(/[^\d.]/g, ''));
        return Number.isFinite(amount) ? amount : 0;
    };

    const formatCurrency = (value) => {
        const amount = Number(value);
        return pesoFormatter.format(Number.isFinite(amount) ? amount : 0);
    };

    const parseDate = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (dateOnly) {
            return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
        }
        const parsed = new Date(raw);
        return Number.isFinite(parsed.getTime()) ? parsed : null;
    };

    const formatDate = (value) => {
        const parsed = parseDate(value);
        if (!parsed) return 'Not set';
        return parsed.toLocaleDateString('en-PH', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const getSelectedAmount = () => {
        if (state.amountMode !== 'custom') return state.amountDue;
        return Math.max(parseAmount(customAmountInput?.value || state.customAmount), 0);
    };

    const setStatus = (message = '', type = 'info') => {
        const text = String(message || '').trim();
        statusEl.textContent = text;
        statusEl.hidden = !text;
        statusEl.classList.toggle('is-error', type === 'error');
        statusEl.classList.toggle('is-success', type === 'success');
    };

    const setLookupLoading = (loading) => {
        lookupBtn.disabled = Boolean(loading);
        lookupBtn.innerHTML = loading
            ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Checking...'
            : '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Check Balance';
    };

    const updatePayButton = (loading = false) => {
        const selectedAmount = getSelectedAmount();
        const methodLabel = methodLabels[state.method] || 'selected method';
        payBtn.disabled = Boolean(loading) || selectedAmount <= 0 || state.amountDue <= 0;
        payBtn.innerHTML = loading
            ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Opening...'
            : `<i class="fa-solid fa-lock" aria-hidden="true"></i> Pay ${formatCurrency(selectedAmount)} via ${methodLabel}`;
    };

    const setSelectedMethod = (method = 'gcash') => {
        const normalized = String(method || '').trim().toLowerCase();
        state.method = state.paymentMethods.includes(normalized) ? normalized : (state.paymentMethods[0] || 'gcash');
        document.querySelectorAll('.quick-pay-method').forEach((button) => {
            const buttonMethod = String(button.dataset.method || '').trim().toLowerCase();
            const supported = state.paymentMethods.includes(buttonMethod);
            const selected = supported && buttonMethod === state.method;
            button.hidden = !supported;
            button.disabled = !supported;
            button.classList.toggle('is-selected', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        updatePayButton();
    };

    const setAmountMode = (mode = 'full') => {
        state.amountMode = mode === 'custom' ? 'custom' : 'full';
        document.querySelectorAll('.quick-pay-amount-option').forEach((button) => {
            const selected = button.dataset.amountMode === state.amountMode;
            button.classList.toggle('is-selected', selected);
            const icon = button.querySelector('i');
            if (icon) {
                icon.className = selected ? 'fa-solid fa-circle-dot' : 'fa-regular fa-circle';
            }
        });
        if (customAmountWrap) customAmountWrap.hidden = state.amountMode !== 'custom';
        if (state.amountMode === 'custom') {
            customAmountInput.value = state.customAmount > 0 ? state.customAmount.toFixed(2) : '';
            window.setTimeout(() => customAmountInput?.focus(), 30);
        }
        updatePayButton();
    };

    const renderAccount = (account = {}) => {
        state.accountNumber = String(account.accountNumber || '').trim();
        state.amountDue = Math.max(Number(account.amountDue || 0), 0);
        state.customAmount = 0;
        state.amountMode = 'full';
        state.paymentMethods = Array.isArray(account.paymentMethods) && account.paymentMethods.length
            ? account.paymentMethods.map((method) => String(method || '').trim().toLowerCase()).filter(Boolean)
            : state.paymentMethods;

        balanceEl.textContent = formatCurrency(state.amountDue);
        fullAmountEl.textContent = formatCurrency(state.amountDue);
        if (customerNameEl) customerNameEl.textContent = String(account.customerName || 'Customer').trim() || 'Customer';
        accountLabel.textContent = state.accountNumber ? `#${state.accountNumber}` : '#';
        if (planNameEl) planNameEl.textContent = String(account.planName || 'Not set').trim() || 'Not set';
        if (dueDateEl) dueDateEl.textContent = formatDate(account.dueDate);
        resultPanel.hidden = false;
        resultPanel.classList.add('is-expanded');
        inputWrap?.classList.add('is-valid');
        setSelectedMethod(state.method);
        setAmountMode('full');

        if (state.amountDue <= 0) {
            setStatus('No outstanding balance for this account.', 'success');
            payBtn.disabled = true;
        } else {
            setStatus('');
        }
    };

    const apiPost = async (url, body) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            cache: 'no-store',
            body: JSON.stringify(body)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
            throw new Error(payload.error || payload.message || `Request failed (${response.status})`);
        }
        return payload;
    };

    const lookupAccount = async (event) => {
        event?.preventDefault();
        const accountNumber = normalizeAccount(accountInput.value);
        if (!accountNumber) {
            setStatus('Account number is required.', 'error');
            accountInput.focus();
            return;
        }
        accountInput.value = accountNumber;
        setStatus('');
        resultPanel.hidden = true;
        resultPanel.classList.remove('is-expanded');
        inputWrap?.classList.remove('is-valid');
        setLookupLoading(true);
        try {
            const payload = await apiPost('/api/customers/quick-payment/lookup', { accountNumber });
            renderAccount(payload.account || {});
        } catch (error) {
            setStatus(error.message || 'Unable to check balance.', 'error');
        } finally {
            setLookupLoading(false);
        }
    };

    const validatePaymentAmount = () => {
        const amount = getSelectedAmount();
        if (!amount || amount <= 0) {
            setStatus('Enter a valid payment amount.', 'error');
            customAmountInput?.focus();
            return 0;
        }
        if (amount > state.amountDue) {
            setStatus('Amount cannot be higher than the outstanding balance.', 'error');
            customAmountInput?.focus();
            return 0;
        }
        return Number(amount.toFixed(2));
    };

    const submitPayment = async () => {
        if (!state.accountNumber) {
            setStatus('Check an account number first.', 'error');
            accountInput.focus();
            return;
        }
        if (state.amountDue <= 0) {
            setStatus('No outstanding balance for this account.', 'success');
            return;
        }
        const amount = validatePaymentAmount();
        if (!amount) return;
        setStatus('');
        updatePayButton(true);
        try {
            const payload = await apiPost('/api/customers/quick-payment/ewallet', {
                accountNumber: state.accountNumber,
                method: state.method,
                amount
            });
            if (!payload.checkoutUrl) {
                throw new Error('Unable to create payment link.');
            }
            window.location.href = payload.checkoutUrl;
        } catch (error) {
            setStatus(error.message || 'Unable to create payment link.', 'error');
            updatePayButton(false);
        }
    };

    const loadBusinessProfile = async () => {
        try {
            const response = await fetch('/api/business-profile', { cache: 'no-store' });
            if (!response.ok) return;
            const profile = await response.json();
            const name = String(profile?.businessName || '').trim();
            if (name && businessNameEl) {
                businessNameEl.textContent = name;
                document.title = `Quick Payment - ${name}`;
            }
            if (profile?.logoUrl && logoEl) logoEl.src = profile.logoUrl;
        } catch {
            // Keep page defaults.
        }
    };

    const handleReturnStatus = () => {
        const params = new URLSearchParams(window.location.search);
        const status = String(params.get('status') || '').trim().toLowerCase();
        const account = normalizeAccount(params.get('account') || '');
        if (account) accountInput.value = account;
        if (status === 'paid') {
            setStatus('Payment completed. Balance may take a moment to update.', 'success');
        } else if (status === 'failed') {
            setStatus('Payment was not completed.', 'error');
        }
        if (account) lookupAccount();
    };

    form?.addEventListener('submit', lookupAccount);
    payBtn?.addEventListener('click', submitPayment);
    document.querySelectorAll('.quick-pay-method').forEach((button) => {
        button.addEventListener('click', () => setSelectedMethod(button.dataset.method));
    });
    document.querySelectorAll('.quick-pay-amount-option').forEach((button) => {
        button.addEventListener('click', () => setAmountMode(button.dataset.amountMode));
    });
    customAmountInput?.addEventListener('input', () => {
        state.customAmount = parseAmount(customAmountInput.value);
        updatePayButton();
    });

    loadBusinessProfile();
    handleReturnStatus();
})();
