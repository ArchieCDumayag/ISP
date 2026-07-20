(function () {
    const form = document.getElementById('customerLoginForm');
    const loginIdInput = document.getElementById('customerLoginId');
    const passwordInput = document.getElementById('customerPassword');
    const submitBtn = document.getElementById('customerLoginSubmit');
    const errorEl = document.getElementById('customerLoginError');
    const toggleBtn = document.getElementById('toggleCustomerPassword');
    const rememberInput = document.getElementById('customerRememberMe');
    const businessNameEl = document.getElementById('portalBusinessName');
    const logoEl = document.getElementById('portalLogo');
    const REMEMBER_KEY = 'customerPortalRememberedLogin';

    const showError = (message) => {
        const text = String(message || '').trim();
        errorEl.textContent = text;
        errorEl.hidden = !text;
    };

    const setSubmitting = (submitting) => {
        submitBtn.disabled = Boolean(submitting);
        submitBtn.innerHTML = submitting
            ? '<i class="fa-solid fa-spinner fa-spin"></i> Logging in...'
            : 'LOG IN';
    };

    const loadBusinessProfile = async () => {
        try {
            const response = await fetch('/api/business-profile', { cache: 'no-store' });
            if (!response.ok) return;
            const profile = await response.json();
            const name = String(profile?.businessName || '').trim();
            if (name) {
                document.title = `Customer Portal - ${name}`;
                if (businessNameEl && !businessNameEl.dataset.keepLabel) {
                    businessNameEl.textContent = name;
                }
            }
            if (profile?.logoUrl && logoEl) logoEl.src = profile.logoUrl;
        } catch {
            // Keep defaults.
        }
    };

    const loadRememberedLogin = () => {
        try {
            const savedLogin = localStorage.getItem(REMEMBER_KEY) || '';
            if (savedLogin && loginIdInput && !loginIdInput.value) {
                loginIdInput.value = savedLogin;
            }
            if (rememberInput) rememberInput.checked = Boolean(savedLogin || rememberInput.checked);
        } catch {
            // Keep the default form state.
        }
    };

    const saveRememberedLogin = (loginId) => {
        try {
            if (rememberInput?.checked) {
                localStorage.setItem(REMEMBER_KEY, loginId);
            } else {
                localStorage.removeItem(REMEMBER_KEY);
            }
        } catch {
            // Storage may be unavailable in some in-app browsers.
        }
    };

    toggleBtn?.addEventListener('click', () => {
        const hidden = passwordInput.type === 'password';
        passwordInput.type = hidden ? 'text' : 'password';
        toggleBtn.innerHTML = hidden ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
    });

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        showError('');
        const loginId = String(loginIdInput.value || '').trim();
        const password = String(passwordInput.value || '');
        if (!loginId || !password) {
            showError('Username/account number and password are required.');
            return;
        }
        setSubmitting(true);
        try {
            const numericLogin = /^\d+$/.test(loginId);
            const response = await fetch('/api/customers/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    username: numericLogin ? '' : loginId,
                    accountNumber: numericLogin ? loginId : '',
                    password
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.ok) {
                throw new Error(data.error || 'Login failed.');
            }
            saveRememberedLogin(loginId);
            window.location.href = '/customer-portal.html';
        } catch (error) {
            showError(error.message || 'Unable to log in.');
        } finally {
            setSubmitting(false);
        }
    });

    loadRememberedLogin();
    loadBusinessProfile();
})();
