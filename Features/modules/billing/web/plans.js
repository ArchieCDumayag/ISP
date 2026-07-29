(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const API_ENDPOINT = '/api/plans';

    const planModal = document.getElementById('planModal');
    const planForm = document.getElementById('planForm');
    const modalTitle = document.getElementById('planModalTitle');
    const modalSubtitle = document.getElementById('planModalSubtitle');
    const priceSuffixAddon = document.getElementById('planPriceSuffix');
    const toast = document.getElementById('planToast');
    const routerBindingsContainer = document.getElementById('planRouterBindings');
    const MONTHLY_PRICE_SUFFIX = '/ month';
    const metrics = {
      prepaid: document.getElementById('metric-prepaid'),
      postpaid: document.getElementById('metric-postpaid'),
      activeSubscribers: document.getElementById('metric-active-subscribers'),
    };

    const state = {
      plans: {
        prepaid: [],
        postpaid: [],
      },
      planUsageCounts: new Map(),
      editing: null,
      toastTimer: null,
      loading: false,
      error: null,
      routers: [],
      mikrotikEnabled: false,
      defaultRouterId: '',
      routerProfilesById: new Map(),
    };

    const ensureCategoryKey = (value) => {
      const raw = String(value || '').trim().toLowerCase();
      return raw === 'postpaid' ? 'postpaid' : 'prepaid';
    };

    const normalizeRouterId = (value) => String(value || '').trim();

    const normalizeProfileBindings = (value) => {
      let source = value;
      if (typeof source === 'string') {
        const trimmed = source.trim();
        if (!trimmed) return {};
        try {
          source = JSON.parse(trimmed);
        } catch (_error) {
          return {};
        }
      }
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return {};
      }
      return Object.entries(source).reduce((acc, [routerId, profile]) => {
        const normalizedRouterId = normalizeRouterId(routerId);
        const normalizedProfile = String(profile || '').trim();
        if (normalizedRouterId && normalizedProfile) {
          acc[normalizedRouterId] = normalizedProfile;
        }
        return acc;
      }, {});
    };

    const coerceNumber = (value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    };

    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const formatPrice = (value) => {
      const numeric = coerceNumber(value);
      return '&#8369;' + numeric.toLocaleString('en-PH');
    };

    const getField = (name) => (planForm?.elements?.namedItem(name) || null);
    const tableSelector = () => document.querySelector('.plans-table');

    const getRoutersFromSettings = (settings) =>
      Array.isArray(settings?.mikrotikRouters) ? settings.mikrotikRouters : [];

    const resolveMikrotikEnabledState = (settings = {}) => {
      if (typeof window.resolveMikrotikEnabledState === 'function') {
        return window.resolveMikrotikEnabledState(settings);
      }
      const globalEnabled = Boolean(settings?.mikrotik?.enabled);
      const routers = getRoutersFromSettings(settings);
      const hasRouter = Boolean(globalEnabled && routers.some((router) => {
        if (router?.enabled === false) return false;
        const address = String(router?.address || '').trim();
        const username = String(router?.username || '').trim();
        const password = String(router?.password ?? '').trim();
        return Boolean(address && username && password);
      }));
      const legacy = settings?.mikrotik || {};
      const legacyEnabled = Boolean(
        globalEnabled
        && String(legacy?.address || '').trim()
        && String(legacy?.username || '').trim()
        && String(legacy?.password ?? '').trim()
      );
      return { enabled: Boolean(hasRouter || legacyEnabled) };
    };

    const resolveDefaultRouterId = (settings, routers = []) => {
      const preferred = normalizeRouterId(settings?.mikrotikDefaultId);
      if (preferred && routers.some((router) => normalizeRouterId(router?.id) === preferred)) {
        return preferred;
      }
      const explicitDefault = routers.find((router) => router?.isDefault);
      if (explicitDefault?.id) return normalizeRouterId(explicitDefault.id);
      return normalizeRouterId(routers[0]?.id);
    };

    const normalizePlanPriceSuffix = (_category, value) => {
      const raw = String(value || '').trim();
      if (!raw) return MONTHLY_PRICE_SUFFIX;
      if (/\bday\b|\bdays\b|daily|validity/i.test(raw)) return MONTHLY_PRICE_SUFFIX;
      return raw.replace(/^\/month$/i, MONTHLY_PRICE_SUFFIX);
    };

    const normalizePlan = (plan) => {
      if (!plan || typeof plan !== 'object') return null;
      const id = String(plan.id || '').trim();
      if (!id) return null;
      const category = ensureCategoryKey(plan.category);
      const actions = Array.isArray(plan.actions) && plan.actions.length
        ? Array.from(new Set(plan.actions.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)))
        : ['edit', 'delete'];
      ['edit', 'delete'].forEach((action) => {
        if (!actions.includes(action)) actions.push(action);
      });
      return {
        id,
        category,
        label: String(plan.label || '').trim(),
        name: String(plan.name || '').trim(),
        description: String(plan.description || '').trim(),
        profile: String(plan.profile || '').trim(),
        profileBindings: normalizeProfileBindings(plan.profileBindings || plan.profile_bindings),
        price: coerceNumber(plan.price),
        priceSuffix: normalizePlanPriceSuffix(category, plan.priceSuffix),
        validity: coerceNumber(plan.validity),
        benefits: Array.isArray(plan.benefits)
          ? plan.benefits.map((entry) => String(entry || '').trim()).filter(Boolean)
          : [],
        actions,
        createdAt: plan.createdAt || '',
        updatedAt: plan.updatedAt || '',
      };
    };

    const getPlansForCategory = (category) => state.plans[category] || [];

    const getAllPlans = () => [
      ...getPlansForCategory('postpaid'),
      ...getPlansForCategory('prepaid'),
    ];

    const buildEditingProfileBindings = (plan = state.editing?.plan || null) => {
      const existingBindings = normalizeProfileBindings(plan?.profileBindings);
      const legacyDefaultProfile = String(plan?.profile || '').trim();
      if (!legacyDefaultProfile || !state.routers.length) {
        return existingBindings;
      }
      const nextBindings = { ...existingBindings };
      state.routers.forEach((router) => {
        const routerId = normalizeRouterId(router?.id);
        if (routerId && !nextBindings[routerId]) {
          nextBindings[routerId] = legacyDefaultProfile;
        }
      });
      return nextBindings;
    };

    const buildPlanProfileSummary = (plan) => {
      const bindings = normalizeProfileBindings(plan?.profileBindings);
      const bindingEntries = Object.entries(bindings);
      const legacyDefaultProfile = String(plan?.profile || '').trim();
      if (bindingEntries.length) {
        return 'Configured for ' + bindingEntries.length + ' router' + (bindingEntries.length === 1 ? '' : 's');
      }
      if (legacyDefaultProfile) {
        return 'Legacy default: ' + legacyDefaultProfile;
      }
      return '-';
    };

    const setPlansFromPayload = (payload) => {
      const next = { prepaid: [], postpaid: [] };
      if (payload && typeof payload === 'object') {
        Object.keys(payload).forEach((categoryKey) => {
          const list = Array.isArray(payload[categoryKey]) ? payload[categoryKey] : [];
          const category = ensureCategoryKey(categoryKey);
          list.forEach((plan) => {
            const normalized = normalizePlan({ ...plan, category });
            if (normalized) {
              next[category].push(normalized);
            }
          });
        });
      }
      state.plans = next;
    };

    const removePlanFromState = (planId) => {
      Object.keys(state.plans).forEach((category) => {
        state.plans[category] = getPlansForCategory(category).filter((plan) => plan.id !== planId);
      });
      state.planUsageCounts.delete(planId);
    };

    const findPlan = (category, planId) => getPlansForCategory(category).find((plan) => plan.id === planId);

    const normalizeProfileList = (profiles = []) => Array.from(
      new Set(
        (Array.isArray(profiles) ? profiles : [])
          .map((entry) => String(entry || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    const isHiddenRouterProfile = (value) => {
      const normalized = String(value || '').trim().toLowerCase();
      return normalized === 'default' || normalized === 'default-encryption';
    };

    const getUnknownEditingBindings = () => {
      const existing = normalizeProfileBindings(state.editing?.plan?.profileBindings);
      if (!Object.keys(existing).length) return {};
      const knownRouterIds = new Set((state.routers || []).map((router) => normalizeRouterId(router?.id)).filter(Boolean));
      return Object.entries(existing).reduce((acc, [routerId, profile]) => {
        if (!knownRouterIds.has(routerId) && profile) {
          acc[routerId] = profile;
        }
        return acc;
      }, {});
    };

    const collectProfileBindingsFromForm = () => {
      const next = { ...getUnknownEditingBindings() };
      document.querySelectorAll('[data-plan-router-profile]').forEach((select) => {
        const routerId = normalizeRouterId(select.getAttribute('data-router-id'));
        const profile = String(select.value || '').trim();
        if (routerId && profile) {
          next[routerId] = profile;
        }
      });
      return next;
    };

    const getMissingRouterProfileLabels = (bindings = {}) => {
      const normalizedBindings = normalizeProfileBindings(bindings);
      return (state.routers || []).reduce((missing, router) => {
        const routerId = normalizeRouterId(router?.id);
        if (!routerId || normalizedBindings[routerId]) {
          return missing;
        }
        const label = String(router?.label || router?.address || routerId || 'Router').trim();
        missing.push(label);
        return missing;
      }, []);
    };

    const updatePlanTableMikrotikVisibility = () => {
      const table = tableSelector();
      const headerCell = table?.querySelector('thead th:nth-child(4)');
      if (headerCell) {
        headerCell.style.display = state.mikrotikEnabled ? '' : 'none';
      }
      Array.from(table?.querySelectorAll('tbody tr') || []).forEach((row) => {
        if (row.children[3]) {
          row.children[3].style.display = state.mikrotikEnabled ? '' : 'none';
        }
      });
    };

    const applyMikrotikPlanVisibility = () => {
      const bindingsField = routerBindingsContainer?.closest('.form-field');
      if (bindingsField) {
        bindingsField.style.display = state.mikrotikEnabled ? '' : 'none';
      }
      updatePlanTableMikrotikVisibility();
    };

    const renderRouterBindingFields = (bindings = {}) => {
      if (!routerBindingsContainer) return;
      const normalizedBindings = normalizeProfileBindings(bindings);
      routerBindingsContainer.innerHTML = '';

      if (!state.routers.length) {
        routerBindingsContainer.innerHTML = '<p style="margin:0;color:#64748b;font-size:.92rem;">No MikroTik routers configured yet.</p>';
        return;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'router-profile-grid';

      state.routers.forEach((router) => {
        const routerId = normalizeRouterId(router?.id);
        const label = String(router?.label || router?.address || routerId || 'Router').trim();
        const field = document.createElement('div');
        field.className = 'form-field router-profile-field';

        const fieldLabel = document.createElement('label');
        fieldLabel.className = 'form-label';
        fieldLabel.setAttribute('for', `plan-router-profile-${routerId}`);
        fieldLabel.textContent = label;

        const selectWrapper = document.createElement('div');
        selectWrapper.className = 'input-group input-group-flat';

        const select = document.createElement('select');
        select.id = `plan-router-profile-${routerId}`;
        select.className = 'form-select';
        select.setAttribute('data-plan-router-profile', 'true');
        select.setAttribute('data-router-id', routerId);
        select.required = true;

        const routerProfiles = state.routerProfilesById.get(routerId) || [];
        const selectedValue = String(normalizedBindings[routerId] || '').trim();
        const options = normalizeProfileList(
          [...routerProfiles, selectedValue].filter((profile) => !isHiddenRouterProfile(profile) || profile === selectedValue)
        );

        select.innerHTML = '<option value="">Select router profile</option>' + options.map((value) => (
          '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>'
        )).join('');
        select.value = selectedValue;

        selectWrapper.appendChild(select);
        field.appendChild(fieldLabel);
        field.appendChild(selectWrapper);
        wrapper.appendChild(field);
      });

      routerBindingsContainer.appendChild(wrapper);

      const unknownBindings = getUnknownEditingBindings();
      const unknownCount = Object.keys(unknownBindings).length;
      if (unknownCount) {
        const note = document.createElement('div');
        note.style.marginTop = '10px';
        note.style.fontSize = '.82rem';
        note.style.color = '#92400e';
        note.textContent = unknownCount + ' saved router binding' + (unknownCount === 1 ? ' is' : 's are') + ' kept for routers that are not currently configured.';
        routerBindingsContainer.appendChild(note);
      }
    };

    const loadProfiles = async () => {
      const nextRouterProfiles = new Map();
      let routers = [];
      let defaultRouterId = '';

      const addRouterProfile = (routerId, profile) => {
        const normalizedRouterId = normalizeRouterId(routerId);
        const normalizedProfile = String(profile || '').trim();
        if (!normalizedProfile) return;
        if (!normalizedRouterId) return;
        const existing = nextRouterProfiles.get(normalizedRouterId) || [];
        if (!existing.includes(normalizedProfile)) {
          nextRouterProfiles.set(normalizedRouterId, [...existing, normalizedProfile]);
        }
      };

      try {
        const res = await fetch('/api/integrations', { headers: { Accept: 'application/json' }, cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.warn('Failed to fetch MikroTik profiles:', data?.error || data?.message || res.status);
        } else {
          const settings = data?.settings || {};
          state.mikrotikEnabled = Boolean(resolveMikrotikEnabledState(settings).enabled);
          if (state.mikrotikEnabled) {
            routers = getRoutersFromSettings(settings);
            if (!routers.length && settings?.mikrotik) {
              routers = [{
                id: settings.mikrotikDefaultId || settings.mikrotik.id || 'default',
                label: settings.mikrotik.label || 'Default router',
                address: settings.mikrotik.address || '',
              }];
            }
            defaultRouterId = resolveDefaultRouterId(settings, routers);

            const accounts = Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [];
            accounts.forEach((account) => {
              const accountRouterId = normalizeRouterId(account?.routerId) || defaultRouterId || '';
              addRouterProfile(accountRouterId, account?.profile);
            });

            await Promise.all(routers.map(async (router) => {
              const routerId = normalizeRouterId(router?.id);
              if (!routerId) return;
              try {
                const response = await fetch('/api/mikrotik/pppoe/profiles?routerId=' + encodeURIComponent(routerId), {
                  headers: { Accept: 'application/json' },
                  cache: 'no-store'
                });
                const body = await response.json().catch(() => ({}));
                if (!response.ok) {
                  console.warn('Failed to fetch router profiles for', routerId, body?.error || body?.message || response.status);
                  return;
                }
                const profiles = Array.isArray(body?.profiles) ? body.profiles : [];
                profiles.forEach((profile) => addRouterProfile(routerId, profile));
              } catch (error) {
                console.warn('Unable to load router profiles for', routerId, error?.message || error);
              }
            }));
          } else {
            routers = [];
            defaultRouterId = '';
          }
        }
      } catch (error) {
        state.mikrotikEnabled = false;
        console.warn('Unable to load MikroTik router data:', error?.message || error);
      }

      state.routers = Array.isArray(routers) ? routers : [];
      state.defaultRouterId = defaultRouterId;
      state.routerProfilesById = new Map(
        Array.from(nextRouterProfiles.entries()).map(([routerId, profiles]) => [routerId, normalizeProfileList(profiles)])
      );

      const draftBindings = collectProfileBindingsFromForm();
      renderRouterBindingFields(
        Object.keys(draftBindings).length
          ? draftBindings
          : buildEditingProfileBindings(state.editing?.plan)
      );
      applyMikrotikPlanVisibility();
    };

    const ACTION_META = {
      edit: { icon: 'ti ti-pencil', label: 'Edit' },
      delete: { icon: 'ti ti-trash', label: 'Delete' },
    };

    const renderPlansTable = () => {
      const table = tableSelector();
      if (!table) return;
      const tbody = table.querySelector('tbody');
      if (!tbody) return;

      const plans = getAllPlans();
      if (!plans.length) {
        tbody.innerHTML = '';
        document.getElementById('emptyStatePlans').style.display = 'block';
        updatePlanTableMikrotikVisibility();
        return;
      }

      document.getElementById('emptyStatePlans').style.display = 'none';

      fetch('/api/customers', { cache: 'no-store' })
        .then((res) => res.json())
        .then((data) => {
          const customers = Array.isArray(data) ? data : (data.customers || []);
          const usageCounts = new Map();
          const rows = plans.map((plan, idx) => {
            const totalClients = customers.filter((customer) =>
              String(customer?.planName || '').toLowerCase() === String(plan?.name || '').toLowerCase()
            ).length;
            usageCounts.set(plan.id, totalClients);
            const categoryLabel = plan.category === 'postpaid' ? 'Postpaid' : 'Prepaid';
            const categoryHint = plan.category === 'postpaid' ? 'Monthly billing' : 'Monthly prepaid';
            const categoryIcon = plan.category === 'postpaid' ? 'ti ti-calendar-dollar me-1' : 'ti ti-bolt me-1';
            const categoryBadgeClass = plan.category === 'postpaid' ? 'bg-orange-lt text-orange' : 'bg-cyan-lt text-cyan';
            const actions = (plan.actions || []).map((actionType) => {
              const meta = ACTION_META[actionType];
              if (!meta) return '';
              const actionClass = actionType === 'delete' ? 'btn-outline-danger' : 'btn-ghost-secondary';
              const isDeleteBlocked = actionType === 'delete' && totalClients > 0;
              const ariaLabel = meta.label + ' ' + escapeHtml(plan.name);
              const title = isDeleteBlocked
                ? 'Cannot delete. ' + totalClients + ' customer' + (totalClients === 1 ? '' : 's') + ' still use this plan.'
                : meta.label;
              const disabledAttr = isDeleteBlocked ? ' disabled aria-disabled="true"' : '';
              return '<button class="btn btn-icon btn-sm ' + actionClass + '" type="button" data-plan-action="' + actionType + '" data-plan-id="' + escapeHtml(plan.id) + '" data-category="' + escapeHtml(plan.category) + '" aria-label="' + ariaLabel + '" title="' + escapeHtml(title) + '"' + disabledAttr + '><i class="' + meta.icon + '" aria-hidden="true"></i></button>';
            }).join('');
            const priceSuffix = '<span class="text-secondary ms-1">' + escapeHtml(normalizePlanPriceSuffix(plan.category, plan.priceSuffix)) + '</span>';
            const profileSummary = buildPlanProfileSummary(plan);
            return (
              '<tr class="plan-row plan-row--' + escapeHtml(plan.category) + '" data-plan-id="' + escapeHtml(plan.id) + '" data-category="' + escapeHtml(plan.category) + '">' +
                '<td class="text-center text-secondary">' + (idx + 1) + '</td>' +
                '<td class="col-name"><span class="fw-semibold">' + escapeHtml(plan.name) + '</span></td>' +
                '<td class="text-center"><span class="fw-semibold">' + formatPrice(plan.price) + '</span>' + priceSuffix + '</td>' +
                '<td class="text-center text-secondary">' + escapeHtml(profileSummary) + '</td>' +
                '<td class="text-center text-secondary">' + (plan.createdAt ? new Date(plan.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-') + '</td>' +
                '<td class="text-center text-secondary">' + (plan.updatedAt ? new Date(plan.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-') + '</td>' +
                '<td class="text-center">' + totalClients + '</td>' +
                '<td><div class="plans-type-cell"><span class="badge ' + categoryBadgeClass + '"><i class="' + categoryIcon + '" aria-hidden="true"></i>' + categoryLabel + '</span><span class="text-secondary small">' + categoryHint + '</span></div></td>' +
                '<td class="col-actions text-center"><div class="btn-list flex-nowrap justify-content-center">' + actions + '</div></td>' +
              '</tr>'
            );
          }).join('');
          state.planUsageCounts = usageCounts;
          tbody.innerHTML = rows;
          updatePlanTableMikrotikVisibility();
        })
        .catch(() => {
          state.planUsageCounts = new Map();
          updatePlanTableMikrotikVisibility();
        });
    };

    const renderMetrics = () => {
      Object.keys(metrics).forEach((category) => {
        if (metrics[category] && category !== 'activeSubscribers') {
          metrics[category].textContent = getPlansForCategory(category).length;
        }
      });
    };

    const renderAll = () => {
      renderMetrics();
      renderPlansTable();
    };

    const updateActiveSubscribers = async () => {
      if (!metrics.activeSubscribers) return;
      try {
        const response = await fetch('/api/customers', { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Failed to fetch customer data');
        const data = await response.json();
        const customers = Array.isArray(data) ? data : (data.customers || []);
        const activeCount = customers.filter((customer) => String(customer.status).trim() === 'active').length;
        metrics.activeSubscribers.textContent = activeCount.toLocaleString('en-US');
      } catch (error) {
        console.error('Failed to update active subscribers count:', error);
        metrics.activeSubscribers.textContent = 'N/A';
      }
    };

    const showToast = (message) => {
      if (typeof window.appToast === 'function') {
        window.appToast(message, { type: 'info' });
        return;
      }
      if (!toast) return;
      toast.textContent = message;
      toast.classList.add('show');
      if (state.toastTimer) {
        clearTimeout(state.toastTimer);
      }
      state.toastTimer = setTimeout(() => {
        toast.classList.remove('show');
      }, 2800);
    };

    const applyCategoryUI = (selectedCategory, plan = null) => {
      const normalized = ensureCategoryKey(selectedCategory);
      const validityField = document.getElementById('planValidityField');
      if (validityField) {
        validityField.style.display = 'none';
        const validityInput = validityField.querySelector('input');
        if (validityInput) {
          validityInput.value = '';
        }
      }
      if (priceSuffixAddon) priceSuffixAddon.textContent = MONTHLY_PRICE_SUFFIX;
      if (modalSubtitle) {
        modalSubtitle.textContent = normalized === 'prepaid' ? 'Prepaid monthly plan' : 'Postpaid monthly plan';
      }
    };

    const closeModal = () => {
      state.editing = null;
      if (planModal) {
        planModal.classList.remove('show');
        planModal.setAttribute('aria-hidden', 'true');
      }
      planForm?.reset();
      renderRouterBindingFields({});
      applyMikrotikPlanVisibility();
    };

    const openModal = (category, plan = null) => {
      if (!planForm || !planModal) return;
      state.editing = plan ? { category, plan } : null;
      if (modalTitle) modalTitle.textContent = plan ? 'Edit plan' : 'Add plan';
      if (modalSubtitle) modalSubtitle.textContent = category === 'prepaid' ? 'Prepaid monthly plan' : 'Postpaid monthly plan';

      const categoryField = document.getElementById('planCategory');
      const planIdField = getField('planId');
      const nameField = getField('name');
      const priceField = getField('price');

      if (categoryField) categoryField.value = category;
      if (planIdField) planIdField.value = plan ? plan.id : '';
      if (nameField) nameField.value = plan ? plan.name : '';
      if (priceField) priceField.value = plan ? plan.price : '';

      renderRouterBindingFields(buildEditingProfileBindings(plan));
      applyMikrotikPlanVisibility();
      void loadProfiles();

      applyCategoryUI(categoryField?.value || category, plan);

      planModal.classList.add('show');
      planModal.setAttribute('aria-hidden', 'false');
      setTimeout(() => {
        nameField?.focus();
      }, 50);
    };

    const parseJsonSafely = async (response) => {
      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch (_error) {
        return null;
      }
    };

    const handleJsonResponse = async (response) => {
      const data = await parseJsonSafely(response);
      if (!response.ok) {
        const message = (data && data.message) ? data.message : 'Request failed with status ' + response.status;
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      return data;
    };

    const loadPlans = async () => {
      state.loading = true;
      state.error = null;
      renderAll();
      try {
        const response = await fetch(API_ENDPOINT, { headers: { Accept: 'application/json' } });
        const data = await handleJsonResponse(response);
        setPlansFromPayload(data && data.plans ? data.plans : {});
      } catch (error) {
        console.error('Failed to load plans:', error);
        state.error = error.message || 'Failed to load plans.';
        showToast(state.error);
      } finally {
        state.loading = false;
        await loadProfiles();
        renderAll();
      }
    };

    const handleFormSubmit = async (event) => {
      event.preventDefault();
      if (!planForm) return;
      const unlock = window.withSubmitLock ? window.withSubmitLock(planForm, { label: 'Saving...' }) : null;
      if (window.withSubmitLock && !unlock) return;

      const categoryField = document.getElementById('planCategory');
      const planIdField = getField('planId');
      const nameField = getField('name');
      const priceField = getField('price');

      const category = ensureCategoryKey(categoryField?.value || 'prepaid');
      const existingId = String(planIdField?.value || '').trim();
      const name = String(nameField?.value || '').trim();
      const profileBindings = state.mikrotikEnabled
        ? collectProfileBindingsFromForm()
        : normalizeProfileBindings(state.editing?.plan?.profileBindings);
      const price = coerceNumber(priceField?.value || 0);
      const priceSuffix = MONTHLY_PRICE_SUFFIX;
      const validity = null;

      if (!name) {
        alert('Please complete the required fields.');
        if (unlock) unlock();
        return;
      }

      const missingRouterLabels = getMissingRouterProfileLabels(profileBindings);
      if (missingRouterLabels.length) {
        alert('Assign a MikroTik profile for each router: ' + missingRouterLabels.join(', '));
        if (unlock) unlock();
        return;
      }

      const payload = {
        category,
        name,
        profile: '',
        profileBindings,
        price,
        priceSuffix,
        validity,
        benefits: [],
      };

      if (existingId) {
        payload.id = existingId;
      }

      const endpoint = existingId ? API_ENDPOINT + '/' + encodeURIComponent(existingId) : API_ENDPOINT;
      const method = existingId ? 'PUT' : 'POST';

      try {
        const response = await fetch(endpoint, {
          method,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await handleJsonResponse(response);
        await loadPlans();
        renderAll();
        closeModal();
        showToast((data && data.message) ? data.message : (existingId ? 'Plan updated.' : 'Plan created.'));
      } catch (error) {
        console.error('Failed to save plan:', error);
        showToast(error.message || 'Failed to save plan.');
      } finally {
        if (unlock) unlock();
      }
    };

    const confirmDelete = async (category, planId) => {
      const plan = findPlan(category, planId);
      if (!plan) {
        showToast('Plan not found.');
        return;
      }
      const assignedCustomers = Number(state.planUsageCounts.get(planId) || 0);
      if (assignedCustomers > 0) {
        showToast('Cannot delete plan. Remove or change the ' + assignedCustomers + ' customer' + (assignedCustomers === 1 ? '' : 's') + ' using it first.');
        return;
      }
      const message = 'Delete ' + plan.name + '? This cannot be undone.';
      const confirmed = window.appConfirm
        ? await window.appConfirm(message, { title: 'Delete Plan' })
        : window.confirm(message);
      if (!confirmed) return;

      try {
        const response = await fetch(API_ENDPOINT + '/' + encodeURIComponent(planId), {
          method: 'DELETE',
          headers: { Accept: 'application/json' },
        });
        const data = await handleJsonResponse(response);
        removePlanFromState(planId);
        renderAll();
        showToast((data && data.message) ? data.message : plan.name + ' removed.');
      } catch (error) {
        console.error('Failed to delete plan:', error);
        showToast(error.message || 'Failed to delete plan.');
      }
    };

    document.querySelectorAll('button[data-action="add-plan"]').forEach((button) => {
      button.addEventListener('click', () => {
        const category = ensureCategoryKey(button.getAttribute('data-category'));
        openModal(category);
      });
    });

    document.addEventListener('click', (event) => {
      const actionButton = event.target.closest('[data-plan-action]');
      if (!actionButton) return;
      const category = ensureCategoryKey(actionButton.getAttribute('data-category'));
      const planId = actionButton.getAttribute('data-plan-id');
      const action = actionButton.getAttribute('data-plan-action');
      const plan = findPlan(category, planId);
      if (!plan) return;
      if (action === 'edit') {
        openModal(category, plan);
      } else if (action === 'delete') {
        confirmDelete(category, planId);
      } else {
        showToast('Action not yet supported.');
      }
    });

    planForm?.addEventListener('submit', handleFormSubmit);

    document.getElementById('planCategory')?.addEventListener('change', (event) => {
      applyCategoryUI(event.target.value, state.editing?.plan || null);
    });

    document.querySelectorAll('[data-action="close-plan-modal"]').forEach((button) => {
      button.addEventListener('click', closeModal);
    });

    planModal?.addEventListener('click', (event) => {
      if (event.target === planModal) {
        closeModal();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && planModal?.classList.contains('show')) {
        closeModal();
      }
    });

    toast?.addEventListener('click', () => {
      toast.classList.remove('show');
      if (state.toastTimer) {
        clearTimeout(state.toastTimer);
      }
    });

    renderAll();
    applyMikrotikPlanVisibility();
    void loadPlans();
    void updateActiveSubscribers();
  });
})();
