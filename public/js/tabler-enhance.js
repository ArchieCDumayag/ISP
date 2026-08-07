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
  const modalSizeClasses = 'modal-sm modal-lg modal-xl modal-full-width modal-fullscreen'.split(' ');
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
  const inputGroupSelector = [
    '.input-group',
    '.input-group-field',
    '.input-with-icon',
    '.input-icon-wrapper',
    '.secure-input-wrap',
    '.select-wrapper',
    '.amount-field',
    '.date-field',
    '.time-field',
    '.search-field',
    '.payment-history-search',
    '.customer-search-field',
    '.pppoe-customer-search-field',
    '.genieacs-search-field'
  ].join(',');
  const formGridSelector = [
    '.form-grid',
    '.profile-edit-form__grid',
    '.automation-form-grid',
    '.modal-form-grid',
    '.settings-grid',
    '.filter-grid',
    '.quick-payment-grid',
    '.customer-form-grid',
    '.pppoe-assign-fields-grid'
  ].join(',');
  const formFeedbackSelector = [
    '.invalid-feedback',
    '.valid-feedback',
    '.field-error',
    '.error-message',
    '.success-message',
    '.validation-message',
    '.form-error',
    '.form-success'
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
  const tablerCardSelector = [
    '.section-frame',
    '.metric',
    '.metric-card',
    '.payment-history-metric',
    '.stat-card',
    '.stats-card',
    '.summary-card',
    '.dashboard-card',
    '.trend-card',
    '.settings-card',
    '.integration-card',
    '.access-card',
    '.finance-card',
    '.collector-card',
    '.collector-stat',
    '.report-card',
    '.coverage-card',
    '.plan-card',
    '.portal-card',
    '.public-card',
    '.login-panel',
    '.login-card',
    '.reset-card',
    '.card-table',
    '.chart-wrapper--tabler',
    '.chart-wrapper--luxury'
  ].join(',');
  const tablerToolbarSelector = [
    '.section-toolbar',
    '.header-actions',
    '.toolbar-actions',
    '.table-footer',
    '.payment-history-toolbar',
    '.payment-history-inline-filters',
    '.finance-toolbar',
    '.collector-toolbar',
    '.assignment-toolbar',
    '.filter-row',
    '.filters-row',
    '.map-tools',
    '.modal-actions',
    '.form-actions'
  ].join(',');
  const tablerAlertSelector = [
    '.alert',
    '.notice',
    '.banner',
    '.status-message',
    '.success-message',
    '.warning-message',
    '.error-banner',
    '.empty-state'
  ].join(',');
  const chartRootSelector = [
    '.chart-wrapper',
    '.chart-wrapper--tabler',
    '.chart-wrapper--luxury',
    '.chart-wrapper--bar',
    '.chart-wrapper--pie',
    '.chart-wrapper--doughnut',
    '.bar-chart',
    '.trend-panel:has(canvas)',
    '.trend-panel:has(.chart-wrapper)',
    '.dashboard-card:has(canvas)',
    '.report-card:has(canvas)',
    '.stat-card:has(canvas)',
    'canvas'
  ].join(',');
  const avatarSelector = [
    '.avatar',
    '.profile-avatar',
    '.logo-chip',
    '.brand-logo',
    '.profile-modal__branding-logo',
    '.profile-edit-logo__preview',
    '.subscriber-info-avatar',
    '.collector-avatar',
    '.collection-history-avatar',
    '.pppoe-avatar',
    '.tech-avatar',
    '.queue-customer-avatar',
    '.quick-pay-avatar',
    '.payment-locked-customer__avatar',
    '.subscriber-avatar',
    '.portal-avatar-button'
  ].join(',');
  const dropdownSelector = [
    '.dropdown',
    '.dropdown-menu',
    '.public-nav__dropdown',
    '.public-nav__dropdown-toggle',
    '.public-nav__dropdown-menu',
    '.public-nav__dropdown-link',
    '.filter-checklist',
    '.filter-checklist__trigger',
    '.filter-checklist__panel',
    '.filter-checklist__panel-head',
    '.filter-checklist__option',
    '.filter-checklist__empty',
    '.customer-search-list',
    '.customer-search-option',
    '.pppoe-customer-search-results',
    '.pppoe-customer-search-option',
    '.select-wrapper',
    'select'
  ].join(',');

  const addClasses = (element, classes) => {
    if (!element || !classes) return;
    String(classes).split(/\s+/).filter(Boolean).forEach((className) => {
      if (!element.classList.contains(className)) element.classList.add(className);
    });
  };

  const removeClasses = (element, classes) => {
    if (!element || !classes) return;
    String(classes).split(/\s+/).filter(Boolean).forEach((className) => {
      if (element.classList.contains(className)) element.classList.remove(className);
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
    if (shouldSpin) addClasses(element, 'ti-spin');
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
      button.classList.contains('chip') ||
      button.classList.contains('filter-chip')
    ) {
      addClasses(button, button.classList.contains('active') || button.classList.contains('is-active') ? 'btn-primary' : 'btn-outline-secondary');
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

  const tableActionSelector = [
    '.row-actions',
    '.table-actions',
    '.action-buttons',
    '.actions',
    '.btn-list',
    '[data-table-actions]'
  ].join(',');

  const numericColumnPattern = /\b(amount|balance|total|price|fee|cost|paid|discount|credit|debit|qty|quantity|count|mbps|gb|peso|php|rate|salary|cash|bill|due)\b/i;

  const looksNumericCell = (cell) => {
    const text = String(cell?.textContent || '').trim();
    if (!text) return false;
    return /^[-+]?(\u20b1|\$)?\s*[\d,]+(?:\.\d+)?(?:\s*(mbps|gb|%))?$/i.test(text);
  };

  const enhanceTableRows = (table) => {
    if (!table) return;
    const headerCells = Array.from(table.tHead?.rows?.[0]?.cells || table.querySelectorAll('thead th'));
    const numericIndexes = new Set();
    headerCells.forEach((th, index) => {
      th.setAttribute('scope', th.getAttribute('scope') || 'col');
      addClasses(th, 'tabler-table__heading');
      const headerText = String(th.textContent || '').trim();
      if (numericColumnPattern.test(headerText)) {
        numericIndexes.add(index);
        addClasses(th, 'text-end tabler-table__numeric');
      }
      if (th.matches('[data-sort], .sortable, [aria-sort]') || th.querySelector('[data-sort], .sort-icon, .sort-indicator')) {
        addClasses(th, 'tabler-table__sortable');
        th.setAttribute('aria-sort', th.getAttribute('aria-sort') || 'none');
      }
    });

    table.querySelectorAll('tbody tr').forEach((row) => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      row.classList.toggle('table-active', Boolean(checkbox?.checked));
      const cells = Array.from(row.cells || []);
      const isEmptyRow = cells.length === 1 && (
        cells[0].hasAttribute('colspan') ||
        cells[0].matches('.empty, .empty-state, [data-empty-state]')
      );
      if (isEmptyRow) {
        addClasses(cells[0], 'text-center text-secondary py-5 tabler-table__empty');
        return;
      }
      cells.forEach((cell, index) => {
        if (numericIndexes.has(index) || looksNumericCell(cell)) addClasses(cell, 'text-end tabler-table__numeric');
        if (cell.querySelector(tableActionSelector) || cell.querySelector('button, a.btn, .btn, [role="button"]')) {
          addClasses(cell, 'text-end text-nowrap tabler-table__actions');
        }
      });
    });
  };

  const enhanceTable = (table) => {
    if (!table) return;
    const firstRun = !processed.has(table);
    if (firstRun) {
      processed.add(table);
      addClasses(table, 'table table-vcenter table-hover card-table tabler-table');
      table.querySelectorAll('caption').forEach((caption) => addClasses(caption, 'caption-top text-secondary'));
      const parent = table.parentElement;
      if (parent && parent.tagName !== 'BODY') {
        addClasses(parent, 'table-responsive tabler-table-wrap');
        const tableLabel = table.getAttribute('aria-label') ||
          String(table.querySelector('caption')?.textContent || '').trim() ||
          String(table.closest('section, main, .card, .section-frame')?.querySelector('h1, h2, h3')?.textContent || '').trim();
        if (tableLabel && !parent.getAttribute('aria-label')) {
          parent.setAttribute('aria-label', tableLabel);
        }
        if (parent.getAttribute('aria-label')) {
          parent.setAttribute('role', parent.getAttribute('role') || 'region');
          parent.setAttribute('tabindex', parent.getAttribute('tabindex') || '0');
        }
      }
      table.addEventListener('change', (event) => {
        const input = event.target;
        if (!input?.matches?.('input[type="checkbox"]')) return;
        const row = input.closest('tbody tr');
        if (row) row.classList.toggle('table-active', input.checked);
      });
    }
    enhanceTableRows(table);
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
      input.classList.contains('toggle-input') ||
      label?.classList.contains('switch') ||
      label?.classList.contains('switch-line') ||
      label?.classList.contains('switch-field') ||
      label?.classList.contains('status-switch-field') ||
      input.closest('.switch, .switch-line, .switch-field, .status-switch-field')
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
        !child.classList.contains('switch-slider') &&
        !child.classList.contains('tabler-switch-slider') &&
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
    const field = control.closest(fieldContainerSelector);
    if (invalid) {
      addClasses(control, 'is-invalid');
      if (field) addClasses(field, 'tabler-field--invalid');
    }
    if (valid && !invalid) {
      addClasses(control, 'is-valid');
      if (field) addClasses(field, 'tabler-field--valid');
    }
  };

  const enhanceTextInput = (input) => {
    if (!input || isChoiceInput(input)) return;
    const type = getInputType(input);
    if (buttonLikeInputTypes.has(type)) return;

    addClasses(input, 'tabler-control');
    if (type === 'range') {
      addClasses(input, 'form-range tabler-range');
      removeClasses(input, 'form-control');
    } else {
      addClasses(input, 'form-control');
      if (type === 'color') addClasses(input, 'form-control-color tabler-color-input');
      if (type === 'file') addClasses(input, 'tabler-file-input');
      if (type === 'date' || type === 'datetime-local' || type === 'month' || type === 'time' || type === 'week') addClasses(input, 'tabler-date-input');
      if (type === 'number') addClasses(input, 'tabler-number-input');
      if (type === 'password') addClasses(input, 'tabler-password-input');
    }

    markControlLabels(input);
    syncValidationState(input);
  };

  const enhanceTextArea = (textarea) => {
    addClasses(textarea, 'form-control tabler-control tabler-textarea');
    markControlLabels(textarea);
    syncValidationState(textarea);
  };

  const enhanceSelect = (select) => {
    addClasses(select, 'form-select tabler-control tabler-select tabler-dropdown-select');
    if (select.multiple || Number(select.getAttribute('size') || 0) > 1) addClasses(select, 'tabler-select--multiple');
    markControlLabels(select);
    syncValidationState(select);
  };

  const enhanceSelectGroups = (root) => {
    queryAll(root, selectGroupSelector).forEach((group) => {
      if (!group.querySelector('input[type="checkbox"], input[type="radio"]')) return;
      addClasses(group, 'form-selectgroup form-selectgroup-pills tabler-selectgroup');
      group.querySelectorAll('label').forEach((label) => {
        const input = label.querySelector('input[type="checkbox"], input[type="radio"]');
        if (!input || isSwitchInput(input)) return;
        addClasses(label, 'form-selectgroup-item tabler-selectgroup-item');
        removeClasses(label, 'form-check');
        addClasses(input, 'form-selectgroup-input');
        removeClasses(input, 'form-check-input');
        addClasses(ensureLabelContentClass(label, input, 'form-selectgroup-label'), 'tabler-selectgroup-label');
      });
    });
  };

  const hasChoiceLabelContent = (container, input) => {
    if (!container) return false;
    return Array.from(container.childNodes).some((node) => {
      if (node === input) return false;
      if (node.nodeType === Node.TEXT_NODE) return Boolean(node.textContent.trim());
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      if (node.matches('input[type="checkbox"], input[type="radio"], .switch-slider, .tabler-switch-slider, .status-switch-indicator')) return false;
      return Boolean(String(node.textContent || '').trim()) || Boolean(node.querySelector?.('span, strong, small, i, svg'));
    });
  };

  const enhanceChoiceInput = (input) => {
    if (!input) return;
    const label = input.closest('label');
    if (label?.classList.contains('form-selectgroup-item')) {
      addClasses(input, 'form-selectgroup-input');
      removeClasses(input, 'form-check-input');
      addClasses(ensureLabelContentClass(label, input, 'form-selectgroup-label'), 'tabler-selectgroup-label');
      return;
    }

    const switchLike = isSwitchInput(input);
    addClasses(input, switchLike ? 'form-check-input tabler-switch-input' : 'form-check-input tabler-check-input');
    if (switchLike) input.setAttribute('role', input.getAttribute('role') || 'switch');
    if (label) {
      addClasses(label, switchLike ? 'form-check form-switch tabler-check tabler-switch' : 'form-check tabler-check');
      label.querySelectorAll('.switch-slider').forEach((slider) => {
        addClasses(slider, 'tabler-switch-slider');
        slider.setAttribute('aria-hidden', 'true');
      });
      if (!switchLike || hasChoiceLabelContent(label, input)) {
        addClasses(ensureLabelContentClass(label, input, 'form-check-label'), switchLike ? 'tabler-switch-label' : 'tabler-check-label');
      }
      if (label.closest(checkListContainerSelector)) {
        addClasses(label, 'list-group-item');
        if (!input.disabled) addClasses(label, 'list-group-item-action');
      }
      return;
    }

    const parent = input.parentElement;
    const choiceCount = parent?.querySelectorAll?.('input[type="checkbox"], input[type="radio"]').length || 0;
    if (parent && choiceCount === 1 && !parent.matches('td, th, .input-group-text')) {
      addClasses(parent, switchLike ? 'form-check form-switch tabler-check tabler-switch' : 'form-check tabler-check');
      const textLabel = Array.from(parent.children).find((child) => (
        child !== input &&
        !child.matches('input, button, select, textarea') &&
        !child.querySelector('input, button, select, textarea')
      ));
      if (textLabel) addClasses(textLabel, switchLike ? 'form-check-label tabler-switch-label' : 'form-check-label tabler-check-label');
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

  const enhanceInputGroups = (root) => {
    queryAll(root, inputGroupSelector).forEach((wrapper) => {
      if (!wrapper || wrapper.closest('.sidebar, .topbar, datalist')) return;
      addClasses(wrapper, 'tabler-input-group');
      if (wrapper.matches('.input-group, .secure-input-wrap')) addClasses(wrapper, 'input-group');
      if (wrapper.matches('.input-with-icon, .input-icon-wrapper, .secure-input-wrap') || wrapper.querySelector(':scope > i, :scope > .ti')) {
        addClasses(wrapper, 'input-icon tabler-input-icon');
      }
      if (wrapper.matches('.select-wrapper')) addClasses(wrapper, 'tabler-select-wrap');
      wrapper.querySelectorAll('.input-group-text, .input-addon, .prefix, .suffix, .currency-prefix, .unit-suffix')
        .forEach((addon) => addClasses(addon, 'input-group-text tabler-input-addon'));
      wrapper.querySelectorAll('button, a.btn, [role="button"]').forEach(enhanceButton);
    });
  };

  const enhanceFormFeedback = (root) => {
    queryAll(root, formFeedbackSelector).forEach((message) => {
      if (!message || message.closest('.sidebar, .topbar')) return;
      if (!message.closest('form, .tabler-form, .tabler-form-modal, .modal, .modal-overlay, .profile-edit-modal, .reset-overlay')) return;
      addClasses(message, 'tabler-form-feedback');
      const tokens = getElementTokenText(message);
      if (message.classList.contains('success-message') || message.classList.contains('form-success') || /\b(success|valid|saved|complete)\b/.test(tokens)) {
        addClasses(message, 'valid-feedback d-block');
      } else {
        addClasses(message, 'invalid-feedback d-block');
      }
    });
  };

  const enhanceDropdown = (element) => {
    if (!element || element.closest('.sidebar-menu')) return;

    if (element.matches('select')) {
      addClasses(element, 'form-select tabler-control tabler-select tabler-dropdown-select');
      element.closest('.select-wrapper')?.classList.add('tabler-select-wrap', 'tabler-dropdown');
      return;
    }

    if (element.matches('.select-wrapper')) {
      addClasses(element, 'tabler-select-wrap tabler-dropdown');
      element.querySelectorAll('select').forEach(enhanceSelect);
      return;
    }

    if (element.matches('.public-nav__dropdown, .filter-checklist, .dropdown')) {
      addClasses(element, 'dropdown tabler-dropdown');
      return;
    }

    if (element.matches('.public-nav__dropdown-toggle, .filter-checklist__trigger')) {
      addClasses(element, 'dropdown-toggle tabler-dropdown-toggle');
      if (element.matches('button')) addClasses(element, 'btn btn-outline-secondary');
      if (!element.getAttribute('aria-haspopup')) element.setAttribute('aria-haspopup', 'true');
      return;
    }

    if (element.matches('.public-nav__dropdown-menu, .filter-checklist__panel, .customer-search-list, .pppoe-customer-search-results, .dropdown-menu')) {
      addClasses(element, 'dropdown-menu tabler-dropdown-menu');
      if (element.matches('.customer-search-list, .pppoe-customer-search-results')) addClasses(element, 'tabler-results-dropdown');
      return;
    }

    if (element.matches('.filter-checklist__panel-head')) {
      addClasses(element, 'dropdown-header tabler-dropdown-header');
      return;
    }

    if (element.matches('.public-nav__dropdown-link, .filter-checklist__option, .customer-search-option, .pppoe-customer-search-option')) {
      addClasses(element, 'dropdown-item tabler-dropdown-item');
      if (element.matches('label') && element.querySelector('input[type="checkbox"], input[type="radio"]')) addClasses(element, 'form-check tabler-check');
      return;
    }

    if (element.matches('.filter-checklist__empty')) addClasses(element, 'dropdown-item-text text-secondary tabler-dropdown-empty');
  };

  const enhanceDropdowns = (root) => {
    queryAll(root, dropdownSelector).forEach(enhanceDropdown);
  };

  const enhanceFormStructure = (root) => {
    queryAll(root, 'form').forEach((form) => addClasses(form, 'tabler-form'));
    queryAll(root, 'fieldset').forEach((fieldset) => addClasses(fieldset, 'form-fieldset'));
    queryAll(root, 'legend').forEach((legend) => addClasses(legend, 'form-label'));
    queryAll(root, formGridSelector).forEach((grid) => addClasses(grid, 'tabler-form-grid'));
    queryAll(root, fieldContainerSelector).forEach((field) => addClasses(field, 'mb-3 tabler-form-field'));
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
    enhanceInputGroups(root);
    enhanceSearchBars(root);
    enhanceFormFeedback(root);
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

  const modalRootSelector = [
    '.modal',
    '.modal-overlay',
    '.profile-edit-modal',
    '.profile-modal',
    '.logs-modal',
    '.account-browser-player',
    '.account-wifi-modal',
    '.account-devices-modal',
    '[data-tabler-modal]'
  ].join(',');

  const visibleDialogSelector = [
    'dialog[open]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]'
  ].join(',');

  const isElementTreeVisible = (element) => {
    if (!element?.isConnected) return false;
    if (element.matches('dialog') && !element.open) return false;
    let current = element;
    while (current && current !== document.documentElement) {
      if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      current = current.parentElement;
    }
    return element.getClientRects().length > 0;
  };

  const hasOpenDialog = () => Array.from(document.querySelectorAll(visibleDialogSelector))
    .some(isElementTreeVisible);

  const hasBackdropClass = (element) => Array.from(element?.classList || []).some((className) => (
    className === 'modal-backdrop'
    || className.endsWith('__backdrop')
    || className.endsWith('-backdrop')
  ));

  const isInteractiveModalControl = (element) => Boolean(element?.closest?.(
    'button, a, input, select, textarea, label, [role="button"]'
  ));

  const isModalRoot = (element) => {
    if (!element?.matches) return false;
    if (isInteractiveModalControl(element)) return false;
    if (element.matches('[data-tabler-modal], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return true;
    return Array.from(element.classList || []).some((className) => (
      className === 'modal'
      || className === 'modal-overlay'
      || className.endsWith('-modal')
    ));
  };

  const blockImplicitModalDismissal = (event) => {
    if (!hasOpenDialog()) return;
    if (event.type === 'keydown') {
      if (event.key !== 'Escape') return;
    } else {
      const target = event.target;
      if (!hasBackdropClass(target) && !isModalRoot(target)) return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  document.addEventListener('keydown', blockImplicitModalDismissal, true);
  document.addEventListener('mousedown', blockImplicitModalDismissal, true);
  document.addEventListener('click', blockImplicitModalDismissal, true);

  const modalContentSelector = [
    ':scope > .modal-dialog > .modal-content',
    ':scope > .modal-content',
    ':scope > .modal-container',
    ':scope > .profile-edit-modal__content',
    ':scope > .profile-modal__content',
    ':scope > .logs-modal__content',
    ':scope > .account-browser-player__panel',
    ':scope > .account-wifi-modal__dialog',
    ':scope > .account-devices-modal__dialog'
  ].join(',');

  const modalHeaderSelector = [
    ':scope > .modal-header',
    ':scope > .profile-edit-modal__header',
    ':scope > .profile-modal__header',
    ':scope > .logs-modal__header',
    ':scope > .account-browser-player__header',
    ':scope > .account-wifi-modal__header',
    ':scope > .account-devices-modal__header'
  ].join(',');

  const modalBodySelector = [
    ':scope > .modal-body',
    ':scope > .profile-edit-form',
    ':scope > .profile-modal__body',
    ':scope > .logs-modal__body',
    ':scope > .account-browser-player__body',
    ':scope > .account-devices-modal__table-wrap'
  ].join(',');

  const modalFooterSelector = [
    ':scope > .modal-footer',
    ':scope > .form-actions',
    ':scope > .profile-edit-modal__footer',
    ':scope > .profile-modal__footer',
    ':scope > .logs-modal__footer',
    ':scope > .account-wifi-modal__actions'
  ].join(',');

  const modalCloseSelector = [
    '.modal-close',
    '.close-modal',
    '.close-btn',
    '.logs-modal__close',
    '.profile-modal__close',
    '.profile-edit-modal__close',
    '.account-browser-player__close',
    '.account-wifi-modal__close',
    '.account-devices-modal__close',
    '[data-modal-close]',
    '[data-dismiss="modal"]',
    '[data-bs-dismiss="modal"]',
    '[data-browser-player-close]',
    '[data-account-wifi-close]',
    '[data-account-devices-close]'
  ].join(',');

  const collectModals = (root) => {
    const modals = new Set();
    if (!root) return [];
    if (root.nodeType === 1 && root.matches(modalRootSelector)) modals.add(root);
    root.querySelectorAll?.(modalRootSelector).forEach((modal) => modals.add(modal));
    return Array.from(modals);
  };

  const resolveModalContent = (modal) => {
    if (!modal) return null;
    return modal.querySelector(modalContentSelector) ||
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
    addClasses(dialog, 'modal-dialog modal-dialog-centered');
    dialog.setAttribute('role', dialog.getAttribute('role') || 'document');
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
    const directFooters = getScopedChildren(form, '.modal-footer, .form-actions, .account-wifi-modal__actions');
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

  const getExplicitModalSize = (modal, content) => {
    const explicit = [
      modal?.dataset?.tablerModalSize,
      modal?.dataset?.modalSize,
      modal?.dataset?.size,
      content?.dataset?.tablerModalSize,
      content?.dataset?.modalSize,
      content?.dataset?.size
    ].find(Boolean);
    const value = String(explicit || '').trim().toLowerCase();
    if (!value) return '';
    if (/^(sm|small|compact)$/.test(value)) return 'sm';
    if (/^(lg|large)$/.test(value)) return 'lg';
    if (/^(xl|wide)$/.test(value)) return 'xl';
    if (/^(full|full-width|fullwidth|fullscreen)$/.test(value)) return 'full';
    return '';
  };

  const getModalTokens = (modal, content) => [
    getElementTokenText(modal),
    getElementTokenText(content)
  ].filter(Boolean).join(' ');

  const inferModalSize = (modal, content) => {
    const explicit = getExplicitModalSize(modal, content);
    if (explicit) return explicit;

    const tokens = getModalTokens(modal, content);
    const classHas = (className) => modal.classList.contains(className) || content.classList.contains(className);
    if (classHas('modal-full-width') || classHas('modal-fullscreen')) return 'full';
    if (classHas('modal-xl') || classHas('modal-wide')) return 'xl';
    if (classHas('modal-lg') || classHas('modal-large')) return 'lg';
    if (classHas('modal-sm') || classHas('modal-compact')) return 'sm';
    if (/(full-width|fullwidth|fullscreen|full-screen|map|coverage|browser-player|customer-add-embed|iframe|statement-preview)/.test(tokens)) return 'full';
    if (/(small|compact|confirm|delete|remove|credit-override|status|password|login|pin)/.test(tokens)) return 'sm';
    if (/(wide|history|ledger|breakdown|traffic|session|integration|details|customer-view|payments-view|preview|devices|queue|import|\btable\b|draft|payment-modal)/.test(tokens)) return 'xl';
    if (modal.querySelector('form')) return 'lg';
    return 'default';
  };

  const shouldScrollModal = (modal, content) => {
    const tokens = getModalTokens(modal, content);
    if (/(scroll|scrollable|history|ledger|breakdown|traffic|session|details|view|preview|devices|queue|import|\btable\b|list)/.test(tokens)) return true;
    if (modal.querySelector('form')) return true;
    if (content.querySelector('table, .table-responsive, iframe, .list-group, .logs-modal__list, .history-modal-body, .subscriber-scroll')) return true;
    return String(content.textContent || '').trim().length > 900 ||
      Array.from(content.children || []).filter((child) => !child.matches('.modal-header, .modal-footer, .modal-status')).length > 5;
  };

  const syncModalSize = (dialog, size) => {
    if (!dialog) return;
    modalSizeClasses.forEach((className) => dialog.classList.remove(className));
    if (size === 'sm') addClasses(dialog, 'modal-sm');
    if (size === 'lg') addClasses(dialog, 'modal-lg');
    if (size === 'xl') addClasses(dialog, 'modal-xl');
    if (size === 'full') addClasses(dialog, 'modal-full-width');
  };

  const syncModalKindClasses = (modal, hasForm, scrollable, size, hasFrame) => {
    removeClasses(modal, 'tabler-modal--form tabler-modal--simple tabler-modal--scrollable tabler-modal--full-width tabler-modal--small tabler-modal--iframe');
    addClasses(modal, hasForm ? 'tabler-modal--form tabler-form-modal' : 'tabler-modal--simple');
    if (!hasForm) removeClasses(modal, 'tabler-form-modal');
    if (scrollable) addClasses(modal, 'tabler-modal--scrollable');
    if (size === 'full') addClasses(modal, 'tabler-modal--full-width');
    if (size === 'sm') addClasses(modal, 'tabler-modal--small');
    if (hasFrame) addClasses(modal, 'tabler-modal--iframe');
    const kind = hasForm ? 'form' : size === 'full' ? 'full-width' : size === 'sm' ? 'small' : scrollable ? 'scrollable' : 'simple';
    modal.dataset.tablerModalKind = kind;
  };

  const normalizeModalRegions = (modal, content) => {
    const header = content.querySelector(modalHeaderSelector);
    if (header) {
      addClasses(header, 'modal-header');
      const title = header.querySelector('h1, h2, h3, h4, h5, h6');
      if (title) addClasses(title, 'modal-title');
      header.querySelectorAll(modalCloseSelector).forEach((button) => {
        if (!button.matches('button, a')) return;
        addClasses(button, 'btn-close');
        removeClasses(button, 'btn btn-icon btn-ghost-secondary btn-outline-secondary');
        button.setAttribute('aria-label', button.getAttribute('aria-label') || 'Close');
        if (button.matches('button') && !button.getAttribute('type')) button.setAttribute('type', 'button');
        const text = button.textContent.trim();
        if (!text || text === 'x' || text === 'X' || text.charCodeAt(0) === 215 || button.querySelector('.ti')) {
          button.innerHTML = '';
        }
      });
    }

    content.querySelectorAll(modalFooterSelector).forEach((footer) => addClasses(footer, 'modal-footer'));
    content.querySelectorAll('.modal-footer, .form-actions').forEach((footer) => {
      addClasses(footer, 'modal-footer');
      footer.querySelectorAll('button, a').forEach((button) => addClasses(button, 'btn'));
    });

    content.querySelectorAll(modalBodySelector).forEach((body) => addClasses(body, 'modal-body'));

    if (
      !content.querySelector(':scope > .modal-body') &&
      !content.querySelector(':scope > form')
    ) {
      const bodyChildren = Array.from(content.children).filter((child) => (
        !child.classList.contains('modal-header') &&
        !child.classList.contains('modal-footer') &&
        !child.classList.contains('modal-status')
      ));
      if (bodyChildren.length) {
        const body = document.createElement('div');
        body.className = 'modal-body';
        content.insertBefore(body, bodyChildren[0]);
        bodyChildren.forEach((child) => body.appendChild(child));
      }
    }

    modal.querySelectorAll('.form-field, .form-group, .reset-field').forEach((field) => addClasses(field, 'mb-3'));
    modal.querySelectorAll('label:not(.form-check):not(.btn):not(.form-selectgroup-item):not(.switch-field):not(.status-switch-field)')
      .forEach((label) => {
        if (shouldUseFormLabel(label)) addClasses(label, 'form-label');
      });
  };

  const enhanceModal = (modal) => {
    if (!modal) return;
    const content = resolveModalContent(modal);
    if (!content) return;

    addClasses(modal, 'tabler-modal');
    modal.setAttribute('data-bs-backdrop', 'static');
    modal.setAttribute('data-bs-keyboard', 'false');
    modal.setAttribute('data-modal-dismiss-policy', 'explicit');
    if (modal.classList.contains('modal')) addClasses(modal, 'modal-blur');
    addClasses(content, 'modal-content');
    const dialog = ensureModalDialog(modal, content);
    resetModalContentLayout(content);
    normalizeModalRegions(modal, content);

    const hasNestedDialog = content.matches('[role="dialog"]') || Boolean(content.querySelector('[role="dialog"]'));
    if (!hasNestedDialog) {
      modal.setAttribute('role', modal.getAttribute('role') || 'dialog');
      modal.setAttribute('aria-modal', modal.getAttribute('aria-modal') || 'true');
    }
    if (modal.matches('.modal, .modal-overlay') && !modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');

    content.querySelectorAll('form').forEach((form) => addClasses(form, 'tabler-modal-form'));
    getScopedChildren(content, 'form').forEach(normalizeDirectForm);
    content.querySelectorAll('.modal-body form, .modal-body .modal-form, .modal-body .customer-form, .modal-body .plan-form, .modal-body .job-form')
      .forEach((form) => addClasses(form, 'tabler-modal-form'));

    const hasForm = Boolean(modal.querySelector('form'));
    const hasFrame = Boolean(content.querySelector(':scope > iframe, :scope > .modal-body > iframe, .account-browser-player__frame'));
    const size = inferModalSize(modal, content);
    const scrollable = shouldScrollModal(modal, content);
    syncModalSize(dialog, size);
    dialog?.classList.toggle('modal-dialog-scrollable', scrollable);
    syncModalKindClasses(modal, hasForm, scrollable, size, hasFrame);

    processedFormModals.add(modal);
  };

  const enhanceModals = (root) => {
    collectModals(root).forEach((modal) => {
      enhanceModal(modal);
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
        addClasses(tab, 'active');
      }
    });
  };

  const inferTone = (element) => {
    const tokens = getElementTokenText(element);
    const text = String(element?.textContent || '').toLowerCase();
    const combined = `${tokens} ${text}`;
    if (/(danger|error|failed|fail|reject|rejected|inactive|unpaid|overdue|offline|disabled|delete|remove)/.test(combined)) return 'danger';
    if (/(warning|warn|pending|partial|review|attention|queued|draft|hold)/.test(combined)) return 'warning';
    if (/(success|active|paid|online|complete|completed|approved|connected|ok|valid)/.test(combined)) return 'success';
    if (/(info|notice|neutral|basic|standard|reference|sync|import)/.test(combined)) return 'info';
    return 'primary';
  };

  const applyBadgeTone = (element) => {
    if (!element) return;
    const tone = element.classList.contains('note') &&
      !element.classList.contains('warning') &&
      !element.classList.contains('danger') &&
      !element.classList.contains('error') &&
      !element.classList.contains('success') &&
      !element.classList.contains('accent')
      ? 'secondary'
      : inferTone(element);
    addClasses(element, 'badge rounded-pill tabler-badge');
    const desiredVariant = tone === 'secondary'
      ? 'bg-secondary-lt text-secondary'
      : tone === 'danger'
        ? 'text-bg-danger'
        : tone === 'warning'
          ? 'text-bg-warning'
          : tone === 'success'
            ? 'text-bg-success'
            : tone === 'info'
              ? 'text-bg-info'
              : 'text-bg-primary';
    const hasDesiredVariant = desiredVariant.split(/\s+/).every((className) => element.classList.contains(className));
    if (element.dataset.tablerTone !== tone || !hasDesiredVariant) {
      removeClasses(element, 'text-bg-primary text-bg-secondary text-bg-success text-bg-danger text-bg-warning text-bg-info text-secondary bg-primary-lt bg-secondary-lt bg-success-lt bg-danger-lt bg-warning-lt bg-info-lt');
      addClasses(element, desiredVariant);
      element.dataset.tablerTone = tone;
    }
  };

  const enhanceCards = (root) => {
    queryAll(root, tablerCardSelector).forEach((card) => {
      if (!card || card.closest('.sidebar, .topbar, .dropdown-menu')) return;
      if (card.matches('table')) return;
      addClasses(card, 'card tabler-card');
      if (card.matches('.metric, .metric-card, .payment-history-metric, .stat-card, .stats-card, .summary-card, .collector-stat')) {
        addClasses(card, 'tabler-metric-card');
      }
      if (card.matches('.section-frame')) addClasses(card, 'tabler-section-card');
      if (card.matches('.chart-wrapper--tabler, .chart-wrapper--luxury')) addClasses(card, 'tabler-chart-card');
      if (card.matches('.login-panel, .login-card, .reset-card')) addClasses(card, 'tabler-auth-card');
    });
  };

  const resolveChartContainer = (element) => {
    if (!element) return null;
    if (element.matches('canvas')) {
      return element.closest('.chart-wrapper, .bar-chart, .trend-panel, .dashboard-card, .report-card, .stat-card') ||
        element.parentElement;
    }
    return element;
  };

  const enhanceChart = (element) => {
    const container = resolveChartContainer(element);
    if (!container || container.closest('.sidebar, .topbar')) return;

    addClasses(container, 'tabler-chart');
    if (container.matches('.chart-wrapper, .chart-wrapper--tabler, .chart-wrapper--luxury, .chart-wrapper--bar, .chart-wrapper--pie, .chart-wrapper--doughnut, .bar-chart')) {
      addClasses(container, 'card tabler-card tabler-chart-card');
    }
    if (container.matches('.trend-panel, .dashboard-card, .report-card, .stat-card')) {
      addClasses(container, 'card tabler-card tabler-chart-panel');
    }
    if (container.matches('.chart-wrapper--pie, .chart-wrapper--doughnut') || container.querySelector('canvas[id*="Pie"], canvas[id*="Doughnut"]')) {
      addClasses(container, 'tabler-chart--pie');
    }
    if (container.matches('.chart-wrapper--bar, .bar-chart') || container.querySelector('canvas[id*="Bar"], canvas[id*="Daily"]')) {
      addClasses(container, 'tabler-chart--bar');
    }
    if (container.querySelector('canvas[id*="Line"], canvas[id*="Monthly"]')) {
      addClasses(container, 'tabler-chart--line');
    }

    container.querySelectorAll('canvas').forEach((canvas) => {
      addClasses(canvas, 'tabler-chart-canvas');
      canvas.setAttribute('role', canvas.getAttribute('role') || 'img');
      if (!canvas.getAttribute('aria-label')) {
        const title = container.closest('.trend-panel, .card, section')?.querySelector('h1, h2, h3')?.textContent?.trim();
        if (title) canvas.setAttribute('aria-label', `${title} chart`);
      }
    });

    container.querySelectorAll('.chart-empty-msg').forEach((message) => {
      addClasses(message, 'empty tabler-empty tabler-chart-empty');
    });
  };

  const enhanceCharts = (root) => {
    queryAll(root, chartRootSelector).forEach(enhanceChart);
    queryAll(root, '.trend-chart-meta, .trend-chart-total, .trend-chart-breakdown, .trend-highlight-grid, .trend-luxury-metrics')
      .forEach((element) => addClasses(element, 'tabler-chart-meta'));
    queryAll(root, '.trend-highlight-card, .trend-luxury-metric, .trend-chart-total, .trend-chart-breakdown-item, .trend-chart-breakdown__empty, .trend-chart-insight')
      .forEach((element) => addClasses(element, 'card tabler-card tabler-chart-stat'));
    queryAll(root, '.trend-chart-breakdown-swatch').forEach((swatch) => addClasses(swatch, 'badge'));
  };

  const avatarToneMap = {
    1: 'primary',
    2: 'purple',
    3: 'orange',
    4: 'teal'
  };

  const getAvatarTone = (avatar) => {
    if (!avatar) return 'primary';
    const explicitTones = ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'blue', 'azure', 'indigo', 'purple', 'pink', 'red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan'];
    const explicitTone = explicitTones.find((tone) => (
      avatar.classList.contains(`bg-${tone}-lt`) ||
      avatar.classList.contains(`text-${tone}`)
    ));
    if (explicitTone) return explicitTone;
    if (avatar.classList.contains('collector-avatar--tone-2') || avatar.classList.contains('collection-history-avatar--tone-2')) return avatarToneMap[2];
    if (avatar.classList.contains('collector-avatar--tone-3') || avatar.classList.contains('collection-history-avatar--tone-3')) return avatarToneMap[3];
    if (avatar.classList.contains('collector-avatar--tone-4') || avatar.classList.contains('collection-history-avatar--tone-4')) return avatarToneMap[4];
    const tokens = getElementTokenText(avatar);
    const text = String(avatar.textContent || '').toLowerCase();
    const combined = `${tokens} ${text}`;
    if (/(danger|error|failed|fail|reject|rejected|inactive|unpaid|overdue|offline|disabled|disconnect|disconnected|delete|remove)/.test(combined)) return 'danger';
    if (/(warning|warn|pending|partial|review|attention|queued|draft|hold)/.test(combined)) return 'warning';
    if (/(success|active|paid|online|complete|completed|approved|connected|ok|valid)/.test(combined)) return 'success';
    if (/(teal|cyan|portal|quick|sms|subscriber)/.test(combined)) return 'teal';
    return 'primary';
  };

  const avatarSizeClass = (avatar) => {
    if (!avatar) return '';
    if (avatar.classList.contains('avatar-xl') || avatar.classList.contains('quick-pay-avatar') || avatar.classList.contains('portal-avatar-button')) return 'avatar-xl';
    if (
      avatar.classList.contains('avatar-lg') ||
      avatar.classList.contains('app-confirm-icon') ||
      avatar.classList.contains('view-profile-card') ||
      avatar.closest('.view-profile-header, .profile-modal__branding')
    ) {
      return 'avatar-lg';
    }
    if (
      avatar.classList.contains('avatar-sm') ||
      avatar.classList.contains('profile-avatar') ||
      avatar.classList.contains('logo-chip') ||
      avatar.classList.contains('brand-logo') ||
      avatar.classList.contains('pppoe-avatar') ||
      avatar.classList.contains('tech-avatar') ||
      avatar.classList.contains('queue-customer-avatar') ||
      avatar.classList.contains('payment-locked-customer__avatar') ||
      avatar.classList.contains('collection-history-avatar')
    ) {
      return 'avatar-sm';
    }
    return '';
  };

  const enhanceAvatar = (avatar) => {
    if (!avatar || avatar.matches('img, svg, i')) return;
    addClasses(avatar, 'avatar tabler-avatar');

    const size = avatarSizeClass(avatar);
    if (size) addClasses(avatar, size);

    const tone = getAvatarTone(avatar);
    const toneClasses = `bg-${tone}-lt text-${tone}`;
    const existingTone = avatar.dataset.tablerAvatarTone;
    if (existingTone !== tone || !toneClasses.split(/\s+/).every((className) => avatar.classList.contains(className))) {
      removeClasses(avatar, 'bg-primary-lt bg-secondary-lt bg-success-lt bg-danger-lt bg-warning-lt bg-info-lt bg-blue-lt bg-azure-lt bg-indigo-lt bg-purple-lt bg-pink-lt bg-red-lt bg-orange-lt bg-yellow-lt bg-lime-lt bg-green-lt bg-teal-lt bg-cyan-lt text-primary text-secondary text-success text-danger text-warning text-info text-blue text-azure text-indigo text-purple text-pink text-red text-orange text-yellow text-lime text-green text-teal text-cyan text-white');
      addClasses(avatar, toneClasses);
      avatar.dataset.tablerAvatarTone = tone;
    }

    if (avatar.matches('button, a')) {
      addClasses(avatar, 'btn btn-icon tabler-avatar-button');
      if (!avatar.getAttribute('aria-label')) avatar.setAttribute('aria-label', 'Open account menu');
    } else if (!avatar.getAttribute('aria-label') && !avatar.querySelector('img')) {
      avatar.setAttribute('aria-hidden', avatar.getAttribute('aria-hidden') || 'true');
    }

    avatar.querySelectorAll('img').forEach((img) => {
      addClasses(img, 'avatar-img');
      img.setAttribute('alt', img.getAttribute('alt') || '');
    });
    avatar.querySelectorAll('i').forEach((icon) => {
      mapIconElement(icon);
      icon.setAttribute('aria-hidden', icon.getAttribute('aria-hidden') || 'true');
    });
  };

  const enhanceAvatars = (root) => {
    queryAll(root, avatarSelector).forEach((avatar) => {
      if (!avatar || avatar.closest('.sidebar-menu')) return;
      enhanceAvatar(avatar);
    });
  };

  const enhanceToolbars = (root) => {
    queryAll(root, tablerToolbarSelector).forEach((toolbar) => {
      if (!toolbar || toolbar.closest('.sidebar, .topbar')) return;
      addClasses(toolbar, 'tabler-toolbar');
    });
  };

  const enhanceChips = (root) => {
    queryAll(root, '.chip, .filter-chip, .status-pill, .plan-pill, .note, .target-pill, .metric-pill, .sidebar-badge').forEach((chip) => {
      if (!chip) return;
      const isInteractive = chip.matches('button, a, [role="button"], [role="radio"], [role="tab"]');
      if (isInteractive) {
        addClasses(chip, 'btn btn-sm rounded-pill tabler-chip');
        const isActive = chip.classList.contains('active') ||
          chip.classList.contains('is-active') ||
          chip.getAttribute('aria-checked') === 'true' ||
          chip.getAttribute('aria-selected') === 'true' ||
          chip.getAttribute('aria-pressed') === 'true';
        const desiredVariant = isActive ? 'btn-primary' : 'btn-outline-secondary';
        if (chip.dataset.tablerChipVariant !== desiredVariant || !chip.classList.contains(desiredVariant)) {
          removeClasses(chip, 'btn-primary btn-outline-primary btn-outline-secondary text-bg-primary text-bg-secondary text-bg-success text-bg-danger text-bg-warning text-bg-info');
          addClasses(chip, desiredVariant);
          chip.dataset.tablerChipVariant = desiredVariant;
        }
        if (chip.matches('button') && !chip.hasAttribute('aria-checked') && !chip.hasAttribute('aria-selected')) {
          const nextPressed = isActive ? 'true' : 'false';
          if (chip.getAttribute('aria-pressed') !== nextPressed) chip.setAttribute('aria-pressed', nextPressed);
        }
      } else {
        applyBadgeTone(chip);
      }
    });
  };

  const enhanceAlerts = (root) => {
    queryAll(root, tablerAlertSelector).forEach((alert) => {
      if (!alert || alert.closest('.sidebar, .topbar, table')) return;
      addClasses(alert, 'alert tabler-alert');
      const tone = inferTone(alert);
      const alertTone = tone === 'primary' ? 'info' : tone;
      const desiredVariant = `alert-${alertTone}`;
      if (alert.dataset.tablerAlertTone !== alertTone || !alert.classList.contains(desiredVariant)) {
        removeClasses(alert, 'alert-primary alert-secondary alert-success alert-danger alert-warning alert-info');
        addClasses(alert, desiredVariant);
        alert.dataset.tablerAlertTone = alertTone;
      }
    });
  };

  const enhanceEmptyStates = (root) => {
    queryAll(root, '.empty, .empty-state, .archive-empty, .draft-empty, .payments-empty-cell, .finance-empty, .genieacs-table-empty, .collection-history-empty').forEach((empty) => {
      if (!empty || empty.closest('table')) return;
      addClasses(empty, 'empty tabler-empty');
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
      applyBadgeTone(badge);
    });
  };

  const enhance = (root = document) => {
    root.querySelectorAll('i').forEach(mapIconElement);
    root.querySelectorAll('iconify-icon').forEach(replaceIconify);
    root.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, a.button, a[class*="-button"], a.public-nav__link--accent, a.public-nav__link--login, .receipt-actions a, [role="button"]').forEach(enhanceButton);
    root.querySelectorAll('table').forEach(enhanceTable);
    enhanceCards(root);
    enhanceToolbars(root);
    enhanceForms(root);
    enhanceDropdowns(root);
    enhanceLists(root);
    fitFloatingLists(root);
    enhanceModals(root);
    enhanceCharts(root);
    enhanceAvatars(root);
    enhanceTabs(root);
    enhanceChips(root);
    enhanceAlerts(root);
    enhanceEmptyStates(root);
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
