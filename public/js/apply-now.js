(() => {
    const PLANS_ENDPOINT = '/api/public/plans';
    const PROVINCES_ENDPOINT = '/api/public/philippines/provinces';
    const MUNICIPALITIES_ENDPOINT = '/api/public/philippines/municipalities';
    const BARANGAYS_ENDPOINT = '/api/public/philippines/barangays';
    const APPLICATION_SUBMIT_ENDPOINT = '/api/public/applications';

    const form = document.getElementById('applyNowForm');
    const planSelect = document.getElementById('applyPlanName');
    const statusMessage = document.getElementById('applyNowStatus');
    const submitButton = document.getElementById('applyNowSubmitBtn');
    const barangaySelect = document.getElementById('applyBarangay');
    const municipalitySelect = document.getElementById('applyMunicipality');
    const provinceSelect = document.getElementById('applyProvince');
    const planQueryValue = new URLSearchParams(window.location.search).get('plan');
    let municipalityRequestId = 0;
    let barangayRequestId = 0;
    const requiredFields = form ? Array.from(form.querySelectorAll('[required]')) : [];

    const currencyFormatter = new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    const showStatus = (message, type) => {
        if (!statusMessage) return;
        const safeMessage = String(message || '').trim();
        statusMessage.textContent = safeMessage;
        statusMessage.className = 'status-message';
        if (!safeMessage) return;
        statusMessage.classList.add('is-visible');
        statusMessage.classList.add(type === 'success' ? 'status-message--success' : 'status-message--error');
    };

    const setSubmitting = (isSubmitting) => {
        if (!submitButton) return;
        submitButton.disabled = isSubmitting;
        submitButton.textContent = isSubmitting ? 'Submitting...' : 'Submit Application';
    };

    const formatPlanLabel = (plan, category) => {
        const title = String(plan?.label || plan?.name || '').trim() || (category === 'prepaid' ? 'Prepaid Plan' : 'Postpaid Plan');
        const price = Number(plan?.price);
        if (!Number.isFinite(price)) return title;
        return `${title} - ${currencyFormatter.format(price)}`;
    };

    const applyPlanSelectionFromQuery = () => {
        if (!planSelect || !planQueryValue) return;
        const target = String(planQueryValue || '').trim().toLowerCase();
        const matchedOption = Array.from(planSelect.options).find((option) =>
            String(option.value || '').trim().toLowerCase() === target
        );
        if (matchedOption) {
            planSelect.value = matchedOption.value;
        }
    };

    const renderPlanOptions = (payload) => {
        if (!planSelect) return;
        const postpaidPlans = Array.isArray(payload?.plans?.postpaid) ? payload.plans.postpaid : [];
        const prepaidPlans = Array.isArray(payload?.plans?.prepaid) ? payload.plans.prepaid : [];

        planSelect.innerHTML = '';
        planSelect.appendChild(new Option('Select a plan', ''));

        const appendGroup = (label, items, category) => {
            if (!Array.isArray(items) || !items.length) return;
            const group = document.createElement('optgroup');
            group.label = label;
            items.forEach((plan) => {
                const value = String(plan?.name || plan?.label || '').trim();
                if (!value) return;
                group.appendChild(new Option(formatPlanLabel(plan, category), value));
            });
            if (group.children.length) {
                planSelect.appendChild(group);
            }
        };

        appendGroup('Postpaid Plans', postpaidPlans, 'postpaid');
        appendGroup('Prepaid Plans', prepaidPlans, 'prepaid');
        planSelect.disabled = false;
        applyPlanSelectionFromQuery();
    };

    const loadPlans = async () => {
        if (!planSelect) return;
        try {
            const response = await fetch(PLANS_ENDPOINT, {
                credentials: 'include',
                cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.ok === false) {
                throw new Error(payload?.error || 'Failed to load plans.');
            }
            renderPlanOptions(payload);
        } catch (error) {
            planSelect.innerHTML = '<option value="">Unable to load plans right now</option>';
            planSelect.disabled = true;
            showStatus(error.message || 'Unable to load plans right now.', 'error');
        }
    };

    const normalizeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');

    const setSelectOptions = (select, placeholder, items = []) => {
        if (!select) return;

        const currentValue = String(select.value || '').trim();
        select.innerHTML = '';
        select.appendChild(new Option(placeholder, ''));

        (Array.isArray(items) ? items : []).forEach((item) => {
            const code = normalizeText(item?.code);
            const name = normalizeText(item?.name);
            if (!code || !name) return;
            const option = new Option(name, code);
            option.dataset.label = name;
            select.appendChild(option);
        });

        const canRestoreValue = currentValue
            && Array.from(select.options).some((option) => String(option.value || '').trim() === currentValue);
        if (canRestoreValue) {
            select.value = currentValue;
        }

        select.disabled = items.length === 0;
        clearValidationState(select);
    };

    const setSelectLoading = (select, placeholder) => {
        if (!select) return;
        select.innerHTML = '';
        select.appendChild(new Option(placeholder, ''));
        select.disabled = true;
        clearValidationState(select);
    };

    const resetMunicipalitySelect = () => {
        setSelectOptions(municipalitySelect, 'Select province or independent city first', []);
    };

    const resetBarangaySelect = () => {
        setSelectOptions(barangaySelect, 'Select municipality first', []);
    };

    const getSelectedLabel = (select) => {
        if (!select) return '';
        const option = select.options[select.selectedIndex];
        if (!option || !String(option.value || '').trim()) return '';
        return normalizeText(option?.dataset?.label || option?.textContent || '');
    };

    const getFieldValue = (element) => {
        if (!element) return '';
        if (element.tagName === 'SELECT') {
            return normalizeText(element.value);
        }
        return normalizeText(element.value);
    };

    const setFieldInvalidState = (element, isInvalid) => {
        if (!element) return;
        const field = element.closest('.field');
        if (!field) return;
        field.classList.toggle('is-invalid', Boolean(isInvalid));
        element.setAttribute('aria-invalid', isInvalid ? 'true' : 'false');
    };

    const clearValidationState = (element) => {
        setFieldInvalidState(element, false);
    };

    const validateRequiredFields = () => {
        const invalidFields = [];

        requiredFields.forEach((element) => {
            const isInvalid = !getFieldValue(element);
            setFieldInvalidState(element, isInvalid);
            if (isInvalid) {
                invalidFields.push(element);
            }
        });

        return invalidFields;
    };

    const loadProvinces = async () => {
        if (!provinceSelect) return;

        setSelectLoading(provinceSelect, 'Loading provinces...');
        resetMunicipalitySelect();
        resetBarangaySelect();

        try {
            const response = await fetch(PROVINCES_ENDPOINT, {
                credentials: 'include',
                cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.ok === false) {
                throw new Error(payload?.error || 'Failed to load provinces.');
            }

            setSelectOptions(
                provinceSelect,
                'Select province / independent city',
                Array.isArray(payload?.provinces) ? payload.provinces : []
            );
        } catch (error) {
            setSelectLoading(provinceSelect, 'Unable to load provinces');
            showStatus(error.message || 'Unable to load provinces right now.', 'error');
        }
    };

    const loadMunicipalities = async (provinceCode) => {
        const safeProvinceCode = normalizeText(provinceCode);
        if (!safeProvinceCode || !municipalitySelect) {
            resetMunicipalitySelect();
            resetBarangaySelect();
            return;
        }

        const requestId = ++municipalityRequestId;
        setSelectLoading(municipalitySelect, 'Loading municipalities...');
        resetBarangaySelect();

        try {
            const response = await fetch(`${MUNICIPALITIES_ENDPOINT}?provinceCode=${encodeURIComponent(safeProvinceCode)}`, {
                credentials: 'include',
                cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (requestId !== municipalityRequestId) return;
            if (!response.ok || payload?.ok === false) {
                throw new Error(payload?.error || 'Failed to load municipalities.');
            }

            setSelectOptions(
                municipalitySelect,
                'Select municipality / city',
                Array.isArray(payload?.municipalities) ? payload.municipalities : []
            );
        } catch (error) {
            if (requestId !== municipalityRequestId) return;
            setSelectLoading(municipalitySelect, 'Unable to load municipalities');
            showStatus(error.message || 'Unable to load municipalities right now.', 'error');
        }
    };

    const loadBarangays = async (municipalityCode) => {
        const safeMunicipalityCode = normalizeText(municipalityCode);
        if (!safeMunicipalityCode || !barangaySelect) {
            resetBarangaySelect();
            return;
        }

        const requestId = ++barangayRequestId;
        setSelectLoading(barangaySelect, 'Loading barangays...');

        try {
            const response = await fetch(`${BARANGAYS_ENDPOINT}?municipalityCode=${encodeURIComponent(safeMunicipalityCode)}`, {
                credentials: 'include',
                cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (requestId !== barangayRequestId) return;
            if (!response.ok || payload?.ok === false) {
                throw new Error(payload?.error || 'Failed to load barangays.');
            }

            setSelectOptions(
                barangaySelect,
                'Select barangay',
                Array.isArray(payload?.barangays) ? payload.barangays : []
            );
        } catch (error) {
            if (requestId !== barangayRequestId) return;
            setSelectLoading(barangaySelect, 'Unable to load barangays');
            showStatus(error.message || 'Unable to load barangays right now.', 'error');
        }
    };

    const submitApplication = async (event) => {
        event.preventDefault();
        if (!form) return;

        showStatus('', 'error');
        const invalidFields = validateRequiredFields();
        if (invalidFields.length) {
            showStatus('Complete all required fields before submitting.', 'error');
            invalidFields[0].focus();
            return;
        }

        const formData = new FormData(form);
        const payload = {
            firstName: normalizeText(formData.get('firstName')),
            lastName: normalizeText(formData.get('lastName')),
            contactNumber: normalizeText(formData.get('contactNumber')),
            street: normalizeText(formData.get('street')),
            barangay: getSelectedLabel(barangaySelect),
            municipality: getSelectedLabel(municipalitySelect),
            province: getSelectedLabel(provinceSelect),
            planName: normalizeText(formData.get('planName'))
        };

        setSubmitting(true);
        try {
            const response = await fetch(APPLICATION_SUBMIT_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result?.ok === false) {
                throw new Error(result?.error || 'Failed to submit application.');
            }

            form.reset();
            requiredFields.forEach(clearValidationState);
            applyPlanSelectionFromQuery();
            municipalityRequestId += 1;
            barangayRequestId += 1;
            await loadProvinces();
            const referenceNumber = normalizeText(result?.jobNumber);
            const successMessage = referenceNumber
                ? `${result?.message || 'Application submitted successfully.'} Reference No: ${referenceNumber}`
                : (result?.message || 'Application submitted successfully.');
            showStatus(successMessage, 'success');
        } catch (error) {
            showStatus(error.message || 'Failed to submit application.', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    provinceSelect?.addEventListener('change', () => {
        showStatus('', 'error');
        loadMunicipalities(provinceSelect.value);
    });

    municipalitySelect?.addEventListener('change', () => {
        showStatus('', 'error');
        loadBarangays(municipalitySelect.value);
    });

    loadPlans();
    loadProvinces();
    requiredFields.forEach((element) => {
        const eventName = element.tagName === 'SELECT' ? 'change' : 'input';
        element.addEventListener(eventName, () => {
            if (getFieldValue(element)) {
                clearValidationState(element);
            }
        });
    });
    form?.addEventListener('submit', submitApplication);
})();
