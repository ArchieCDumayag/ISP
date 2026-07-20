(function () {
  if (window.__tablerEnhanceLoaded) return;
  window.__tablerEnhanceLoaded = true;

  const iconMap = {
    'fa-gauge': 'dashboard',
    'fa-users': 'users',
    'fa-user-plus': 'user-plus',
    'fa-user-check': 'user-check',
    'fa-user-clock': 'user-clock',
    'fa-user-xmark': 'user-x',
    'fa-user-group': 'users-group',
    'fa-users-viewfinder': 'users',
    'fa-inbox': 'inbox',
    'fa-box-archive': 'archive',
    'fa-box': 'box',
    'fa-list': 'list-details',
    'fa-list-check': 'list-check',
    'fa-list-alt': 'list-details',
    'fa-location-dot': 'map-pin',
    'fa-map-location-dot': 'map-pin',
    'fa-map-marker-alt': 'map-pin',
    'fa-location-arrow': 'navigation',
    'fa-map': 'map',
    'fa-file-invoice-dollar': 'file-invoice',
    'fa-file-invoice': 'file-invoice',
    'fa-file-lines': 'file-text',
    'fa-file-circle-check': 'file-check',
    'fa-file-pen': 'file-pencil',
    'fa-clock-rotate-left': 'history',
    'fa-clock': 'clock',
    'fa-money-check': 'receipt',
    'fa-diagram-project': 'network',
    'fa-server': 'server',
    'fa-user-tie': 'user-dollar',
    'fa-ticket': 'ticket',
    'fa-clipboard-check': 'clipboard-check',
    'fa-wallet': 'wallet',
    'fa-money-check-dollar': 'receipt-2',
    'fa-network-wired': 'network',
    'fa-bell': 'bell',
    'fa-user-shield': 'shield-lock',
    'fa-comment-sms': 'message-2',
    'fa-right-to-bracket': 'login-2',
    'fa-user': 'user',
    'fa-lock': 'lock',
    'fa-eye': 'eye',
    'fa-eye-slash': 'eye-off',
    'fa-window-restore': 'window',
    'fa-hashtag': 'hash',
    'fa-check': 'check',
    'fa-minus': 'minus',
    'fa-percent': 'percentage',
    'fa-credit-card': 'credit-card',
    'fa-info': 'info-circle',
    'fa-circle-info': 'info-circle',
    'fa-exclamation': 'alert-circle',
    'fa-circle-exclamation': 'alert-circle',
    'fa-shield-halved': 'shield-half',
    'fa-shield-heart': 'shield-heart',
    'fa-circle-check': 'circle-check',
    'fa-circle-xmark': 'circle-x',
    'fa-circle-dot': 'circle-dot',
    'fa-circle-up': 'circle-arrow-up',
    'fa-circle': 'circle',
    'fa-wifi': 'wifi',
    'fa-xmark': 'x',
    'fa-xmark-circle': 'circle-x',
    'fa-bolt': 'bolt',
    'fa-mobile-screen': 'device-mobile',
    'fa-mobile-screen-button': 'device-mobile',
    'fa-plus': 'plus',
    'fa-user-minus': 'user-minus',
    'fa-user-slash': 'user-off',
    'fa-pen': 'pencil',
    'fa-pencil': 'pencil',
    'fa-pen-to-square': 'edit',
    'fa-trash': 'trash',
    'fa-trash-can': 'trash',
    'fa-floppy-disk': 'device-floppy',
    'fa-download': 'download',
    'fa-upload': 'upload',
    'fa-sign-out': 'logout',
    'fa-spinner': 'loader-2',
    'fa-circle-notch': 'loader-2',
    'fa-save': 'device-floppy',
    'fa-print': 'printer',
    'fa-magnifying-glass': 'search',
    'fa-magnifying-glass-minus': 'zoom-out',
    'fa-magnifying-glass-plus': 'zoom-in',
    'fa-search': 'search',
    'fa-filter': 'filter',
    'fa-calendar': 'calendar',
    'fa-calendar-days': 'calendar',
    'fa-calendar-day': 'calendar',
    'fa-calendar-check': 'calendar-check',
    'fa-caret-down': 'caret-down',
    'fa-chevron-left': 'chevron-left',
    'fa-chevron-right': 'chevron-right',
    'fa-chevron-down': 'chevron-down',
    'fa-chevron-up': 'chevron-up',
    'fa-arrow-left': 'arrow-left',
    'fa-arrow-right': 'arrow-right',
    'fa-arrow-up': 'arrow-up',
    'fa-arrow-down': 'arrow-down',
    'fa-up-right-from-square': 'external-link',
    'fa-up-right-and-down-left-from-center': 'arrows-maximize',
    'fa-expand': 'arrows-maximize',
    'fa-clipboard-text': 'clipboard-list',
    'fa-sack-dollar': 'cash',
    'fa-hand-holding-dollar': 'cash',
    'fa-chart-column': 'chart-bar',
    'fa-chart-line': 'chart-line',
    'fa-chart-pie': 'chart-pie',
    'fa-triangle-exclamation': 'alert-triangle',
    'fa-money-bill': 'cash',
    'fa-phone': 'phone',
    'fa-envelope': 'mail',
    'fa-house': 'home',
    'fa-gear': 'settings',
    'fa-cog': 'settings',
    'fa-bars': 'menu-2',
    'fa-folder-open': 'folder-open',
    'fa-layer-group': 'layers-intersect',
    'fa-rotate-right': 'refresh',
    'fa-arrows-rotate': 'refresh',
    'fa-rotate': 'refresh',
    'fa-rotate-left': 'arrow-back-up',
    'fa-link': 'link',
    'fa-router': 'router',
    'fa-signal': 'antenna-bars-5',
    'fa-copy': 'copy',
    'fa-laptop': 'device-laptop',
    'fa-mountain': 'mountain',
    'fa-satellite-dish': 'satellite',
    'fa-scale-balanced': 'scale',
    'fa-headset': 'headset',
    'fa-paper-plane': 'send',
    'fa-right-from-bracket': 'logout',
    'fa-receipt': 'receipt',
    'fa-code-branch': 'git-branch',
    'fa-memory': 'database',
    'fa-microchip': 'cpu',
    'fa-sitemap': 'sitemap',
    'fa-wand-magic-sparkles': 'wand',
    'fa-comment-medical': 'message-plus',
    'fa-comment': 'message',
    'fa-gavel': 'gavel',
    'fa-globe': 'globe',
    'fa-key': 'key',
    'fa-screwdriver-wrench': 'tools',
    'fa-sliders': 'adjustments-horizontal',
    'fa-wave-square': 'waveform',
    'fa-times': 'x',
    'fa-gift': 'gift',
    'fa-tags': 'tags',
    'fa-house-signal': 'home-signal',
    'fa-toggle-on': 'toggle-right',
    'fa-toggle-off': 'toggle-left'
  };

  const iconifyMap = {
    'ph:list-duotone': 'menu-2',
    'ph:moon-stars-duotone': 'moon-stars',
    'ph:sun-dim-duotone': 'sun',
    'ph:clipboard-text-duotone': 'clipboard-list',
    'ph:upload-simple-duotone': 'upload',
    'ph:download-simple-duotone': 'download',
    'ph:sign-out-duotone': 'logout',
    'ph:x-circle-duotone': 'circle-x',
    'ph:pencil-simple-duotone': 'pencil',
    'ph:trash-duotone': 'trash',
    'ph:eye-duotone': 'eye',
    'ph:eye-slash-duotone': 'eye-off'
  };

  const processed = new WeakSet();
  const processedFormModals = new WeakSet();
  const buttonLikeInputTypes = new Set(['button', 'submit', 'reset', 'image', 'hidden']);
  const fieldContainerSelector = [
    '.form-field',
    '.form-group',
    '.reset-field',
    '.settings-field',
    '.profile-edit-field',
    '.filter-field',
    '.input-field',
    '.input-group-field',
    '.billing-field',
    '.payment-field',
    '.quick-payment-field',
    '.expense-field',
    '.coverage-field',
    '.schedule-field',
    '.template-field',
    '.amount-field',
    '.date-field',
    '.time-field',
    '.search-field',
    '.archive-filter-field',
    '.customer-filter-field',
    '.automation-delivery-field',
    '.schedule-date-inline',
    '.schedule-time-inline',
    '.schedule-delay-inline',
    '.schedule-repeat-inline',
    '.schedule-mode-inline'
  ].join(',');
  const hintSelector = [
    '.field-hint',
    '.form-help-text',
    '.input-hint',
    '.help-text',
    '.hint',
    '.status-switch-hint',
    '.plan-hint',
    '.muted-hint',
    '.modal-hint',
    '.form-note'
  ].join(',');
  const selectGroupSelector = [
    '.role-checklist',
    '.recipient-type-selector',
    '.delivery-options',
    '.delivery-method-options',
    '.channel-selectors',
    '.method-options',
    '.payment-method-options',
    '.segmented-control',
    '.map-tools__layers',
    '.radio-group',
    '.checkbox-group',
    '.option-group'
  ].join(',');
  const searchWrapperSelector = [
    '.search-field',
    '.assignment-search',
    '.map-tools__search',
    '.recipient-search',
    '.draft-search-field',
    '.archive-search-field',
    '.payment-history-search',
    '.genieacs-bind-search',
    '.genieacs-search-field',
    '.pppoe-customer-search-field',
    '.customer-search-field',
    '.search-input-wrapper',
    '.secure-input-wrap',
    '.input-with-icon',
    '.input-icon-wrapper',
    '.topbar-search'
  ].join(',');
  const listContainerSelector = [
    'ul',
    'ol',
    '[role="listbox"]',
    '.assignment-area-list',
    '.recipient-picker__list',
    '.subscriber-scroll',
    '.customer-search-list',
    '.pppoe-customer-search-results',
    '.portal-notification-list',
    '.logs-modal__list',
    '.monthly-list',
    '.statement-list',
    '.trend-chart-breakdown',
    '.filter-checklist__options'
  ].join(',');
  const listItemSelector = [
    'li',
    'button',
    'a',
    'label',
    'article',
    '[role="option"]',
    '.assignment-area-option',
    '.recipient-picker__option',
    '.subscriber-option',
    '.customer-search-option',
    '.pppoe-customer-search-option',
    '.portal-notification-item',
    '.filter-checklist__option'
  ].join(',');
  const checkListContainerSelector = [
    '.filter-checklist__panel',
    '.filter-checklist__options',
    '.assignment-area-list',
    '.recipient-picker__list',
    '.subscriber-scroll',
    '.map-tools__filters',
    '.page-checklist',
    '.download-page-checklist'
  ].join(',');

  const addClasses = (element, classes) => {
    if (!element || !classes) return;
    String(classes).split(/\s+/).filter(Boolean).forEach((className) => {
      element.classList.add(className);
    });
  };

  const removeClasses = (element, classes) => {
    if (!element || !classes) return;
    String(classes).split(/\s+/).filter(Boolean).forEach((className) => {
      element.classList.remove(className);
    });
  };

  const mapIconifyName = (name) => iconifyMap[String(name || '').trim()] || '';

  const mapIconElement = (element) => {
    if (!element) return;
    const hasLegacyIconClass = Array.from(element.classList).some((className) => (
      className === 'fa' ||
      className === 'fas' ||
      className === 'far' ||
      className === 'fab' ||
      className === 'fa-solid' ||
      className === 'fa-regular' ||
      className === 'fa-brands' ||
      className.startsWith('fa-')
    ));
    if (element.classList.contains('ti') && !hasLegacyIconClass) return;
    let iconName = '';
    const shouldSpin = element.classList.contains('fa-spin');
    element.classList.forEach((className) => {
      if (!iconName && iconMap[className]) iconName = iconMap[className];
    });
    element.classList.forEach((className) => {
      if (!iconName && /^fa-[a-z0-9-]+$/.test(className) && className !== 'fa-spin') {
        iconName = className.slice(3);
      }
    });
    if (!iconName) return;

    Array.from(element.classList).forEach((className) => {
      if (
        className === 'fa' ||
        className === 'fas' ||
        className === 'far' ||
        className === 'fab' ||
        className === 'fa-solid' ||
        className === 'fa-regular' ||
        className === 'fa-brands' ||
        className.startsWith('fa-') ||
        className === 'ti' ||
        className.startsWith('ti-')
      ) {
        element.classList.remove(className);
      }
    });
    addClasses(element, `ti ti-${iconName}`);
    if (shouldSpin) element.classList.add('ti-spin');
    element.setAttribute('aria-hidden', element.getAttribute('aria-hidden') || 'true');
  };

  const replaceIconify = (element) => {
    const iconName = mapIconifyName(element.getAttribute('icon'));
    if (!iconName) return;
    const replacement = document.createElement('i');
    replacement.className = `${element.className || ''} ti ti-${iconName}`.trim();
    replacement.setAttribute('aria-hidden', element.getAttribute('aria-hidden') || 'true');
    const lightIcon = mapIconifyName(element.getAttribute('data-icon-light') || element.dataset.iconLight);
    const darkIcon = mapIconifyName(element.getAttribute('data-icon-dark') || element.dataset.iconDark);
    if (lightIcon) replacement.dataset.tiLight = lightIcon;
    if (darkIcon) replacement.dataset.tiDark = darkIcon;
    element.replaceWith(replacement);
  };

  const enhanceButton = (button) => {
    if (!button || processed.has(button)) return;
    processed.add(button);

    const isIconOnly = button.classList.contains('topbar-btn') ||
      button.classList.contains('ghost-icon') ||
      button.classList.contains('footer-btn') ||
      button.classList.contains('modal-close') ||
      button.classList.contains('close-modal') ||
      button.classList.contains('toggle-password') ||
      button.classList.contains('profile-modal__close') ||
      button.classList.contains('logs-modal__close') ||
      button.classList.contains('profile-edit-modal__close') ||
      button.classList.contains('ghost-btn--icon') ||
      button.getAttribute('aria-label') && button.textContent.trim().length <= 2;

    addClasses(button, 'btn');
    if (isIconOnly) addClasses(button, 'btn-icon');

    const action = String(button.dataset.action || '').toLowerCase();
    const text = button.textContent.trim();
    const firstChar = text.charCodeAt(0);
    if (text.length === 1 && (firstChar === 8249 || text === '<')) button.innerHTML = '<i class="ti ti-chevron-left" aria-hidden="true"></i>';
    if (text.length === 1 && (firstChar === 8250 || text === '>')) button.innerHTML = '<i class="ti ti-chevron-right" aria-hidden="true"></i>';

    if (
      button.classList.contains('primary-btn') ||
      button.classList.contains('add-btn') ||
      button.classList.contains('save-btn') ||
      button.classList.contains('login-btn') ||
      button.classList.contains('button--primary') ||
      button.classList.contains('portal-primary-button') ||
      button.classList.contains('public-nav__link--accent') ||
      button.id === 'receiptContinueBtn' ||
      button.matches('button[type="submit"]:not(.ghost-btn):not(.secondary-btn)')
    ) {
      addClasses(button, 'btn-primary');
    } else if (
      button.classList.contains('ghost-btn--danger') ||
      button.classList.contains('delete-btn') ||
      button.classList.contains('danger') ||
      action === 'delete' ||
      action === 'remove'
    ) {
      addClasses(button, 'btn-outline-danger');
    } else if (button.classList.contains('topbar-btn')) {
      addClasses(button, 'btn-ghost-secondary');
    } else if (
      button.classList.contains('ghost-btn') ||
      button.classList.contains('secondary-btn') ||
      button.classList.contains('portal-icon-button') ||
      button.classList.contains('public-nav__link--login') ||
      button.classList.contains('receipt-secondary') ||
      button.classList.contains('assignment-bulk-btn') ||
      button.classList.contains('footer-btn')
    ) {
      addClasses(button, 'btn-outline-secondary');
    }
  };

  const enhanceTable = (table) => {
    if (!table || processed.has(table)) return;
    processed.add(table);
    addClasses(table, 'table table-vcenter table-hover');
    const parent = table.parentElement;
    if (parent && !parent.classList.contains('table-responsive') && parent.tagName !== 'BODY') {
      parent.classList.add('table-responsive');
    }
  };

  const queryAll = (root, selector) => {
    const matches = [];
    if (!root) return matches;
    if (root.nodeType === 1 && root.matches(selector)) matches.push(root);
    if (root.querySelectorAll) {
      root.querySelectorAll(selector).forEach((element) => matches.push(element));
    }
    return matches;
  };

  const getInputType = (input) => String(input.getAttribute('type') || 'text').toLowerCase();

  const isChoiceInput = (input) => input && input.matches('input[type="checkbox"], input[type="radio"]');

  const getElementTokenText = (element) => {
    if (!element) return '';
    return [
      element.id,
      element.getAttribute('name'),
      element.getAttribute('type'),
      element.getAttribute('placeholder'),
      element.getAttribute('aria-label'),
      element.getAttribute('role'),
      typeof element.className === 'string' ? element.className : ''
    ].filter(Boolean).join(' ').toLowerCase();
  };

  const isSearchInput = (input) => {
    if (!input || input.tagName !== 'INPUT') return false;
    const type = getInputType(input);
    if (type === 'search') return true;
    if (buttonLikeInputTypes.has(type) || isChoiceInput(input)) return false;
    const tokens = getElementTokenText(input);
    return /\b(search|query)\b/.test(tokens) ||
      input.closest(searchWrapperSelector) ||
      /search/.test(String(input.getAttribute('placeholder') || '').toLowerCase());
  };

  const isSwitchInput = (input) => {
    const label = input?.closest('label');
    return Boolean(input && (
      input.getAttribute('role') === 'switch' ||
      input.classList.contains('switch-input') ||
      input.classList.contains('status-switch-input') ||
      label?.classList.contains('switch-field') ||
      label?.classList.contains('status-switch-field')
    ));
  };

  const isListExcluded = (element) => Boolean(element?.closest(
    '.sidebar, .sidebar-menu, .topbar, .nav, .nav-tabs, .dropdown-menu, table, .table-responsive, .form-selectgroup, datalist'
  ));

  const getControlLabels = (control) => {
    if (!control) return [];
    const labels = control.labels ? Array.from(control.labels) : [];
    const wrapped = control.closest('label');
    if (wrapped && !labels.includes(wrapped)) labels.unshift(wrapped);
    return labels;
  };

  const ensureLabelContentClass = (label, input, className) => {
    if (!label || !input) return null;
    let content = Array.from(label.children).find((child) => (
      child !== input &&
      (child.classList.contains(className) ||
        child.classList.contains('form-check-label') ||
        child.classList.contains('form-selectgroup-label'))
    ));
    if (!content) {
      content = Array.from(label.children).find((child) => (
        child !== input &&
        child.tagName === 'SPAN' &&
        !child.classList.contains('ti') &&
        !child.classList.contains('status-switch-state') &&
        !child.classList.contains('status-switch-indicator')
      ));
    }
    if (!content) {
      const span = document.createElement('span');
      const movableNodes = Array.from(label.childNodes).filter((node) => (
        node !== input &&
        !(node.nodeType === Node.ELEMENT_NODE && node.matches('input[type="checkbox"], input[type="radio"]')) &&
        !(node.nodeType === Node.TEXT_NODE && !node.textContent.trim())
      ));
      input.after(span);
      movableNodes.forEach((node) => span.appendChild(node));
      content = span;
    }
    addClasses(content, className);
    return content;
  };

  const getWrappedControlLabelText = (label, control) => {
    if (!label || !control || control.closest('label') !== label || isChoiceInput(control)) return null;
    return Array.from(label.children).find((child) => (
      child !== control &&
      !child.matches('input, select, textarea, button') &&
      !child.querySelector('input, select, textarea, button') &&
      (
        child.classList.contains('form-label') ||
        child.classList.contains('profile-edit-form__label') ||
        child.classList.contains('field-label') ||
        child.classList.contains('label-text') ||
        child.tagName === 'SPAN'
      )
    ));
  };

  const shouldUseFormLabel = (label) => {
    if (!label) return false;
    if (label.matches('.form-check, .form-selectgroup-item, .btn, .button, .switch-field, .status-switch-field, .method-card')) return false;
    if (label.closest('.nav-tabs, .sidebar, .topbar, .table-responsive, table')) return false;
    const choice = label.querySelector('input[type="checkbox"], input[type="radio"]');
    const textControl = label.querySelector('input:not([type="checkbox"]):not([type="radio"]), select, textarea');
    if (textControl && getWrappedControlLabelText(label, textControl)) return false;
    return !choice || Boolean(textControl);
  };

  const markControlLabels = (control) => {
    getControlLabels(control).forEach((label) => {
      const wrappedLabelText = getWrappedControlLabelText(label, control);
      if (wrappedLabelText) {
        addClasses(wrappedLabelText, 'form-label');
        if (control.required) addClasses(wrappedLabelText, 'required');
        return;
      }
      if (shouldUseFormLabel(label)) addClasses(label, 'form-label');
      if (control.required && shouldUseFormLabel(label)) addClasses(label, 'required');
    });
  };

  const syncValidationState = (control) => {
    if (!control) return;
    const invalid = control.getAttribute('aria-invalid') === 'true' ||
      control.classList.contains('invalid') ||
      control.closest('.field-error, .has-error, .is-error');
    const valid = control.getAttribute('aria-invalid') === 'false' ||
      control.classList.contains('valid') ||
      control.closest('.field-valid, .has-success, .is-success');
    if (invalid) addClasses(control, 'is-invalid');
    if (valid && !invalid) addClasses(control, 'is-valid');
  };

  const enhanceTextInput = (input) => {
    if (!input || isChoiceInput(input)) return;
    const type = getInputType(input);
    if (buttonLikeInputTypes.has(type)) return;

    if (type === 'range') {
      addClasses(input, 'form-range');
      removeClasses(input, 'form-control');
    } else {
      addClasses(input, 'form-control');
      if (type === 'color') addClasses(input, 'form-control-color');
    }

    markControlLabels(input);
    syncValidationState(input);
  };

  const enhanceTextArea = (textarea) => {
    addClasses(textarea, 'form-control');
    markControlLabels(textarea);
    syncValidationState(textarea);
  };

  const enhanceSelect = (select) => {
    addClasses(select, 'form-select');
    markControlLabels(select);
    syncValidationState(select);
  };

  const enhanceSelectGroups = (root) => {
    queryAll(root, selectGroupSelector).forEach((group) => {
      if (!group.querySelector('input[type="checkbox"], input[type="radio"]')) return;
      addClasses(group, 'form-selectgroup form-selectgroup-pills');
      group.querySelectorAll('label').forEach((label) => {
        const input = label.querySelector('input[type="checkbox"], input[type="radio"]');
        if (!input || isSwitchInput(input)) return;
        addClasses(label, 'form-selectgroup-item');
        removeClasses(label, 'form-check');
        addClasses(input, 'form-selectgroup-input');
        removeClasses(input, 'form-check-input');
        ensureLabelContentClass(label, input, 'form-selectgroup-label');
      });
    });
  };

  const enhanceChoiceInput = (input) => {
    if (!input) return;
    const label = input.closest('label');
    if (label?.classList.contains('form-selectgroup-item')) {
      addClasses(input, 'form-selectgroup-input');
      removeClasses(input, 'form-check-input');
      ensureLabelContentClass(label, input, 'form-selectgroup-label');
      return;
    }

    addClasses(input, 'form-check-input');
    if (label) {
      addClasses(label, isSwitchInput(input) ? 'form-check form-switch' : 'form-check');
      ensureLabelContentClass(label, input, 'form-check-label');
      if (label.closest(checkListContainerSelector)) {
        addClasses(label, 'list-group-item');
        if (!input.disabled) addClasses(label, 'list-group-item-action');
      }
      return;
    }

    const parent = input.parentElement;
    const choiceCount = parent?.querySelectorAll?.('input[type="checkbox"], input[type="radio"]').length || 0;
    if (parent && choiceCount === 1 && !parent.matches('td, th, .input-group-text')) {
      addClasses(parent, isSwitchInput(input) ? 'form-check form-switch' : 'form-check');
      const textLabel = Array.from(parent.children).find((child) => (
        child !== input &&
        !child.matches('input, button, select, textarea') &&
        !child.querySelector('input, button, select, textarea')
      ));
      if (textLabel) addClasses(textLabel, 'form-check-label');
    }
  };

  const ensureSearchIconAddon = (wrapper, input) => {
    if (!wrapper || !input) return;
    addClasses(wrapper, 'input-icon tabler-input-icon tabler-search-bar');
    let addon = Array.from(wrapper.children).find((child) => (
      child.classList.contains('input-icon-addon') &&
      child.dataset.tablerSearchIcon === 'true'
    ));
    if (!addon) {
      addon = document.createElement('span');
      addon.className = 'input-icon-addon';
      addon.dataset.tablerSearchIcon = 'true';
      const icon = input.previousElementSibling?.matches?.('i')
        ? input.previousElementSibling
        : null;
      if (icon) {
        icon.before(addon);
        addon.appendChild(icon);
        mapIconElement(icon);
      } else {
        addon.innerHTML = '<i class="ti ti-search" aria-hidden="true"></i>';
        input.before(addon);
      }
    }
    if (addon.nextElementSibling !== input) input.before(addon);
  };

  const enhanceSearchInput = (input) => {
    if (!isSearchInput(input)) return;
    addClasses(input, 'form-control tabler-search-input');
    input.setAttribute('role', input.getAttribute('role') || 'searchbox');
    if (!input.getAttribute('aria-label') && input.getAttribute('placeholder')) {
      input.setAttribute('aria-label', input.getAttribute('placeholder'));
    }
    let wrapper = input.closest(searchWrapperSelector) || input.closest('.input-icon');
    if (!wrapper || isListExcluded(wrapper)) {
      const parent = input.parentElement;
      const siblingControls = parent?.querySelectorAll?.('input, select, textarea').length || 0;
      if (parent && !parent.matches('td, th') && siblingControls <= 1 && !parent.classList.contains('input-group')) {
        wrapper = parent;
      }
    }
    if (!wrapper || wrapper === document.body || wrapper.tagName === 'FORM') {
      wrapper = document.createElement('div');
      input.before(wrapper);
      wrapper.appendChild(input);
    }
    ensureSearchIconAddon(wrapper, input);
  };

  const enhanceSearchBars = (root) => {
    queryAll(root, 'input').forEach((input) => {
      if (isSearchInput(input)) enhanceSearchInput(input);
    });
  };

  const enhanceFormStructure = (root) => {
    queryAll(root, 'form').forEach((form) => addClasses(form, 'tabler-form'));
    queryAll(root, 'fieldset').forEach((fieldset) => addClasses(fieldset, 'form-fieldset'));
    queryAll(root, 'legend').forEach((legend) => addClasses(legend, 'form-label'));
    queryAll(root, fieldContainerSelector).forEach((field) => addClasses(field, 'mb-3'));
    queryAll(root, hintSelector).forEach((hint) => addClasses(hint, 'form-hint'));
    queryAll(root, '.secure-input-wrap, .input-with-icon, .input-icon-wrapper')
      .forEach((wrapper) => addClasses(wrapper, 'input-icon tabler-input-icon'));
  };

  const enhanceStandaloneLabels = (root) => {
    queryAll(root, 'label').forEach((label) => {
      if (shouldUseFormLabel(label)) addClasses(label, 'form-label');
    });
  };

  const enhanceForms = (root) => {
    enhanceFormStructure(root);
    queryAll(root, 'input').forEach(enhanceTextInput);
    queryAll(root, 'textarea').forEach(enhanceTextArea);
    queryAll(root, 'select').forEach(enhanceSelect);
    enhanceSelectGroups(root);
    queryAll(root, 'input[type="checkbox"], input[type="radio"]').forEach(enhanceChoiceInput);
    enhanceSearchBars(root);
    enhanceStandaloneLabels(root);
  };

  const shouldEnhanceList = (container) => {
    if (!container || isListExcluded(container)) return false;
    if (container.matches('datalist, select, .nav, .nav-tabs, .dropdown-menu, .sidebar-menu ul')) return false;
    if (container.matches('[role="listbox"], .assignment-area-list, .recipient-picker__list, .subscriber-scroll, .customer-search-list, .pppoe-customer-search-results, .portal-notification-list, .logs-modal__list, .monthly-list, .statement-list, .trend-chart-breakdown, .filter-checklist__options')) return true;
    if (!container.matches('ul, ol')) return false;
    const tokens = getElementTokenText(container);
    return /(list|history|notes|breakdown|notification|activity|results|options|monthly)/.test(tokens);
  };

  const enhanceListItem = (item, container) => {
    if (!item || item.matches('script, template')) return;
    addClasses(item, 'list-group-item');
    const isAction = item.matches('button, a, [role="option"], [tabindex], [data-action], [data-push-action], .customer-search-option, .pppoe-customer-search-option');
    if (isAction && !item.matches(':disabled, .disabled')) addClasses(item, 'list-group-item-action');
    if (item.matches('label') && item.querySelector('input[type="checkbox"], input[type="radio"]')) {
      addClasses(item, 'form-check');
      if (container?.matches(checkListContainerSelector)) addClasses(item, 'tabler-check-row');
    }
    item.querySelectorAll?.('input[type="checkbox"], input[type="radio"]').forEach(enhanceChoiceInput);
  };

  const enhanceList = (container) => {
    if (!shouldEnhanceList(container)) return;
    addClasses(container, 'list-group tabler-list');
    if (container.matches('ol')) addClasses(container, 'list-group-numbered');
    if (container.matches('[role="listbox"], .customer-search-list, .pppoe-customer-search-results, .recipient-picker__list, .subscriber-scroll')) {
      addClasses(container, 'list-group-flush list-group-hoverable tabler-results-list');
    } else {
      addClasses(container, 'list-group-flush');
    }
    if (container.matches(checkListContainerSelector)) addClasses(container, 'tabler-check-list');
    Array.from(container.children)
      .filter((child) => child.matches(listItemSelector))
      .forEach((child) => enhanceListItem(child, container));
  };

  const enhanceLists = (root) => {
    queryAll(root, listContainerSelector).forEach(enhanceList);
  };

  const fitFloatingLists = (root) => {
    queryAll(root, '.filter-checklist__panel, .customer-search-list, .pppoe-customer-search-results').forEach((panel) => {
      const isHidden = panel.hidden ||
        panel.getAttribute('aria-hidden') === 'true' ||
        window.getComputedStyle(panel).display === 'none';
      if (isHidden) return;
      panel.style.removeProperty('--tabler-panel-shift');
      const rect = panel.getBoundingClientRect();
      const gutter = 12;
      let shift = 0;
      if (rect.right > window.innerWidth - gutter) {
        shift = window.innerWidth - gutter - rect.right;
      }
      if (rect.left + shift < gutter) {
        shift += gutter - (rect.left + shift);
      }
      if (shift) panel.style.setProperty('--tabler-panel-shift', `${Math.round(shift)}px`);
    });
  };

  const getScopedChildren = (element, selector) => {
    if (!element) return [];
    return Array.from(element.children).filter((child) => child.matches(selector));
  };

  const collectFormModals = (root) => {
    const selector = '.modal, .modal-overlay, .profile-edit-modal, .profile-modal, [role="dialog"]';
    const modals = new Set();
    if (root.nodeType === 1 && root.matches(selector)) modals.add(root);
    root.querySelectorAll(selector).forEach((modal) => modals.add(modal));
    return Array.from(modals).filter((modal) => modal.querySelector('form'));
  };

  const resolveModalContent = (modal) => {
    if (!modal) return null;
    return modal.querySelector(':scope > .modal-dialog > .modal-content') ||
      modal.querySelector(':scope > .modal-content') ||
      modal.querySelector(':scope > .modal-container') ||
      modal.querySelector(':scope > .profile-edit-modal__content') ||
      modal.querySelector(':scope > .profile-modal__content') ||
      modal.firstElementChild;
  };

  const ensureModalDialog = (modal, content) => {
    if (!modal || !content) return null;
    const existingDialog = content.parentElement?.classList.contains('modal-dialog')
      ? content.parentElement
      : null;
    const dialog = existingDialog || document.createElement('div');
    if (!existingDialog) {
      content.before(dialog);
      dialog.appendChild(content);
    }
    addClasses(dialog, 'modal-dialog');
    dialog.setAttribute('role', dialog.getAttribute('role') || 'document');
    const compact = content.classList.contains('modal-compact') ||
      content.classList.contains('modal-sm') ||
      modal.classList.contains('modal-compact') ||
      modal.classList.contains('modal-sm');
    if (compact) {
      dialog.classList.add('modal-sm');
      dialog.classList.remove('modal-lg');
    } else {
      dialog.classList.add('modal-lg');
    }
    return dialog;
  };

  const resetModalContentLayout = (content) => {
    if (!content) return;
    content.style.setProperty('position', 'relative', 'important');
    content.style.setProperty('inset', 'auto', 'important');
    content.style.setProperty('top', 'auto', 'important');
    content.style.setProperty('right', 'auto', 'important');
    content.style.setProperty('bottom', 'auto', 'important');
    content.style.setProperty('left', 'auto', 'important');
    content.style.setProperty('transform', 'none', 'important');
    content.style.setProperty('margin', '0', 'important');
    content.style.setProperty('width', '100%', 'important');
    content.style.setProperty('max-width', 'none', 'important');
  };

  const normalizeDirectForm = (form) => {
    if (!form || form.dataset.tablerModalBodyReady === 'true') return;
    form.dataset.tablerModalBodyReady = 'true';
    addClasses(form, 'tabler-modal-form');

    const directBodies = getScopedChildren(form, '.modal-body');
    const directFooters = getScopedChildren(form, '.modal-footer, .form-actions');
    directFooters.forEach((footer) => addClasses(footer, 'modal-footer'));

    if (directBodies.length) return;

    const bodyChildren = Array.from(form.children).filter((child) => (
      !child.classList.contains('modal-footer') &&
      !child.classList.contains('form-actions')
    ));
    if (!bodyChildren.length) return;

    const body = document.createElement('div');
    body.className = 'modal-body';
    form.insertBefore(body, bodyChildren[0]);
    bodyChildren.forEach((child) => body.appendChild(child));
  };

  const enhanceFormModal = (modal) => {
    if (!modal) return;
    modal.dataset.tablerFormModal = 'true';
    addClasses(modal, 'tabler-form-modal');
    modal.setAttribute('role', modal.getAttribute('role') || 'dialog');
    modal.setAttribute('aria-modal', modal.getAttribute('aria-modal') || 'true');
    if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');

    const content = resolveModalContent(modal);
    if (!content) return;
    addClasses(content, 'modal-content');
    ensureModalDialog(modal, content);
    resetModalContentLayout(content);

    const header = content.querySelector(':scope > .modal-header') || content.querySelector('.modal-header');
    if (header) {
      addClasses(header, 'modal-header');
      const title = header.querySelector('h1, h2, h3, h4, h5, h6');
      if (title) addClasses(title, 'modal-title');
      header.querySelectorAll('.modal-close, .close-modal, .close-btn, [data-modal-close]').forEach((button) => {
        addClasses(button, 'btn-close');
        button.classList.remove('btn', 'btn-icon', 'btn-ghost-secondary', 'btn-outline-secondary');
        button.setAttribute('aria-label', button.getAttribute('aria-label') || 'Close');
        if (!button.textContent.trim() || button.querySelector('.ti')) {
          button.innerHTML = '';
        }
      });
    }

    content.querySelectorAll('form').forEach((form) => addClasses(form, 'tabler-modal-form'));
    getScopedChildren(content, 'form').forEach(normalizeDirectForm);
    content.querySelectorAll('.form-actions').forEach((footer) => addClasses(footer, 'modal-footer'));
    content.querySelectorAll('.modal-footer').forEach((footer) => {
      addClasses(footer, 'modal-footer');
      footer.querySelectorAll('button, a').forEach((button) => addClasses(button, 'btn'));
    });
    content.querySelectorAll('.modal-body form, .modal-body .modal-form, .modal-body .customer-form, .modal-body .plan-form, .modal-body .job-form')
      .forEach((form) => addClasses(form, 'tabler-modal-form'));

    modal.querySelectorAll('.form-field, .form-group, .reset-field').forEach((field) => addClasses(field, 'mb-3'));
    modal.querySelectorAll('label:not(.form-check):not(.btn):not(.form-selectgroup-item):not(.switch-field):not(.status-switch-field)')
      .forEach((label) => {
        if (shouldUseFormLabel(label)) addClasses(label, 'form-label');
      });

    processedFormModals.add(modal);
  };

  const enhanceFormModals = (root) => {
    collectFormModals(root).forEach((modal) => {
      enhanceFormModal(modal);
    });
  };

  const enhanceTabs = (root) => {
    root.querySelectorAll('[role="tablist"], .tabs, .tab-list, .sms-tabs, .assignment-filter-tabs').forEach((list) => {
      addClasses(list, 'nav nav-tabs');
    });
    root.querySelectorAll('[role="tab"], .tab-btn, .filter-tab, .sms-tab-link, .assignment-filter-tab, [data-tab]').forEach((tab) => {
      addClasses(tab, 'nav-link');
      if (
        tab.classList.contains('active') ||
        tab.classList.contains('is-active') ||
        tab.getAttribute('aria-selected') === 'true'
      ) {
        tab.classList.add('active');
      }
    });
  };

  const enhanceSidebarToggles = (root) => {
    root.querySelectorAll('.menu-toggle').forEach((toggle) => {
      if (toggle.querySelector('.menu-toggle__chevron')) return;
      const chevron = document.createElement('i');
      chevron.className = 'ti ti-chevron-down menu-toggle__chevron';
      chevron.setAttribute('aria-hidden', 'true');
      toggle.appendChild(chevron);
    });
  };

  const enhanceBadges = (root) => {
    root.querySelectorAll('.status, .status-pill, .plan-pill, .note, .target-pill, .metric-pill, .sidebar-badge').forEach((badge) => {
      addClasses(badge, 'badge');
    });
  };

  const enhance = (root = document) => {
    root.querySelectorAll('i').forEach(mapIconElement);
    root.querySelectorAll('iconify-icon').forEach(replaceIconify);
    root.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, a.button, a[class*="-button"], a.public-nav__link--accent, a.public-nav__link--login, .receipt-actions a, [role="button"]').forEach(enhanceButton);
    root.querySelectorAll('table').forEach(enhanceTable);
    enhanceForms(root);
    enhanceLists(root);
    fitFloatingLists(root);
    enhanceFormModals(root);
    enhanceTabs(root);
    enhanceSidebarToggles(root);
    enhanceBadges(root);
  };

  const scheduleEnhance = (() => {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        enhance(document);
      });
    };
  })();

  document.addEventListener('DOMContentLoaded', () => {
    enhance(document);
    const observer = new MutationObserver(scheduleEnhance);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', scheduleEnhance);
  });
})();
