(function () {
  if (typeof window === 'undefined') return;

  const normalizeFeedbackType = (type, fallback = 'info') => {
    const raw = String(type || fallback).trim().toLowerCase();
    if (raw === 'danger' || raw === 'error') return 'danger';
    if (raw === 'warn' || raw === 'warning') return 'warning';
    if (raw === 'success' || raw === 'ok') return 'success';
    if (raw === 'primary' || raw === 'info') return raw;
    return fallback;
  };

  const inferConfirmType = (message = '', title = '') => {
    const text = `${title} ${message}`.toLowerCase();
    if (/\b(delete|remove|archive|disconnect|clear|purge|permanent|cannot be undone)\b/.test(text)) return 'danger';
    if (/\b(warning|cancel|replace|stop)\b/.test(text)) return 'warning';
    return 'primary';
  };

  const iconForType = (type) => {
    if (type === 'danger') return 'ti-alert-triangle';
    if (type === 'warning') return 'ti-alert-circle';
    if (type === 'success') return 'ti-circle-check';
    return 'ti-info-circle';
  };

  if (!window.appConfirm) {
    const confirmQueue = [];
    let activeConfirm = null;
    let dialogElements = null;
    let lastFocusedElement = null;

    const ensureConfirmStyles = () => {
      if (document.getElementById('appConfirmStyles')) return;
      const style = document.createElement('style');
      style.id = 'appConfirmStyles';
      style.textContent = `
        #appConfirmOverlay {
          position: fixed;
          inset: 0;
          display: none;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.48);
          backdrop-filter: blur(2px);
          z-index: 20000;
          padding: 18px;
        }
        #appConfirmOverlay.show { display: flex; }
        #appConfirmDialog {
          width: min(460px, 96vw);
          margin: auto;
          pointer-events: auto;
        }
        #appConfirmBody {
          white-space: pre-wrap;
        }
        #appConfirmOverlay .app-confirm-icon {
          width: 3rem;
          height: 3rem;
          margin: 0 auto .75rem;
        }
        #appConfirmOverlay .app-confirm-cancel[hidden] {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
    };

    const ensureConfirmDialog = () => {
      if (dialogElements) return dialogElements;
      ensureConfirmStyles();
      const overlay = document.createElement('div');
      overlay.id = 'appConfirmOverlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.className = 'modal modal-blur app-confirm-modal';
      overlay.innerHTML = `
        <div id="appConfirmDialog" class="modal-dialog modal-sm modal-dialog-centered" role="document">
          <div class="modal-content">
            <div id="appConfirmStatus" class="modal-status bg-primary"></div>
            <div class="modal-body text-center py-4">
              <span id="appConfirmIcon" class="avatar avatar-lg bg-primary-lt text-primary app-confirm-icon">
                <i class="ti ti-info-circle" aria-hidden="true"></i>
              </span>
              <h3 id="appConfirmHead" class="modal-title mb-2">Please confirm</h3>
              <div id="appConfirmBody" class="text-secondary"></div>
            </div>
            <div id="appConfirmActions" class="modal-footer">
              <div class="w-100">
                <div class="row g-2">
                  <div class="col app-confirm-cancel">
                    <button type="button" class="app-confirm-btn cancel btn w-100 btn-outline-secondary" id="appConfirmCancel">Cancel</button>
                  </div>
                  <div class="col">
                    <button type="button" class="app-confirm-btn confirm btn w-100 btn-primary" id="appConfirmOk">OK</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const dialog = overlay.querySelector('#appConfirmDialog');
      const status = overlay.querySelector('#appConfirmStatus');
      const iconWrap = overlay.querySelector('#appConfirmIcon');
      const icon = iconWrap?.querySelector('i') || null;
      const title = overlay.querySelector('#appConfirmHead');
      const message = overlay.querySelector('#appConfirmBody');
      const okButton = overlay.querySelector('#appConfirmOk');
      const cancelButton = overlay.querySelector('#appConfirmCancel');
      const cancelCol = overlay.querySelector('.app-confirm-cancel');

      const resolveActive = (confirmed) => {
        if (!activeConfirm) return;
        const resolver = activeConfirm.resolve;
        activeConfirm = null;
        const focusedElement = document.activeElement;
        if (focusedElement && overlay.contains(focusedElement) && typeof focusedElement.blur === 'function') {
          focusedElement.blur();
        }
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
        resolver(Boolean(confirmed));
        queueNextConfirm();
        if (!activeConfirm && lastFocusedElement && lastFocusedElement.isConnected) {
          const nextFocusTarget = lastFocusedElement;
          lastFocusedElement = null;
          setTimeout(() => {
            try {
              nextFocusTarget.focus({ preventScroll: true });
            } catch {
              try { nextFocusTarget.focus(); } catch {}
            }
          }, 0);
        } else if (!activeConfirm) {
          lastFocusedElement = null;
        }
      };

      okButton.addEventListener('click', () => resolveActive(true));
      cancelButton.addEventListener('click', () => resolveActive(false));
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) resolveActive(false);
      });
      window.addEventListener('keydown', (event) => {
        if (!activeConfirm) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          resolveActive(false);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          resolveActive(true);
        }
      });

      dialogElements = { overlay, dialog, status, iconWrap, icon, title, message, okButton, cancelButton, cancelCol };
      return dialogElements;
    };

    const queueNextConfirm = () => {
      if (activeConfirm || !confirmQueue.length) return;
      const next = confirmQueue.shift();
      const { overlay, dialog, status, iconWrap, icon, title, message, okButton, cancelButton, cancelCol } = ensureConfirmDialog();
      activeConfirm = next;
      if (document.activeElement && document.activeElement !== document.body) {
        lastFocusedElement = document.activeElement;
      } else {
        lastFocusedElement = null;
      }
      const options = next.options || {};
      const heading = options.title || 'Please confirm';
      const type = normalizeFeedbackType(options.type, inferConfirmType(next.message, heading));
      const okClass = type === 'danger'
        ? 'btn-danger'
        : type === 'warning'
          ? 'btn-warning'
          : type === 'success'
            ? 'btn-success'
            : 'btn-primary';
      if (dialog) dialog.setAttribute('data-alert-type', type);
      if (status) status.className = `modal-status bg-${type}`;
      if (iconWrap) iconWrap.className = `avatar avatar-lg bg-${type}-lt text-${type} app-confirm-icon`;
      if (icon) icon.className = `ti ${iconForType(type)}`;
      title.textContent = heading;
      message.textContent = String(next.message || '').trim() || 'Are you sure?';
      okButton.textContent = options.okText || 'OK';
      okButton.className = `app-confirm-btn confirm btn w-100 ${okClass}`;
      cancelButton.textContent = options.cancelText || 'Cancel';
      cancelCol.hidden = Boolean(options.hideCancel);
      overlay.classList.add('show');
      overlay.setAttribute('aria-hidden', 'false');
      setTimeout(() => okButton.focus({ preventScroll: true }), 0);
    };

    window.appConfirm = (message, options = {}) => new Promise((resolve) => {
      confirmQueue.push({ message, options, resolve });
      queueNextConfirm();
    });
  }

  if (!window.appAlert && typeof window.appConfirm === 'function') {
    window.appAlert = (message, options = {}) => window.appConfirm(message, {
      title: options.title || 'Notice',
      okText: options.okText || 'OK',
      type: options.type || 'info',
      hideCancel: true
    }).then(() => undefined);
  }

  const nativeAlert = typeof window.alert === 'function' ? window.alert.bind(window) : null;
  if (!window.__tablerAlertPatched) {
    window.__tablerAlertPatched = true;
    window.alert = (message) => {
      if (typeof window.appAlert === 'function') {
        void window.appAlert(message, { title: 'Notice', type: 'info' });
        return undefined;
      }
      return nativeAlert ? nativeAlert(message) : undefined;
    };
  }

  if (!window.appToast) {
    let toastHost = null;

    const ensureToastStyles = () => {
      if (document.getElementById('appToastStyles')) return;
      const style = document.createElement('style');
      style.id = 'appToastStyles';
      style.textContent = `
        #appToastHost {
          position: fixed;
          right: 24px;
          bottom: 24px;
          z-index: 21000;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 10px;
          pointer-events: none;
        }
        #appToastHost .app-toast.alert {
          pointer-events: auto;
          max-width: min(420px, calc(100vw - 36px));
          border-radius: var(--tblr-border-radius-lg, 10px);
          box-shadow: var(--tblr-shadow-dropdown, 0 18px 40px rgba(15, 23, 42, 0.18));
          opacity: 0;
          transform: translateY(10px);
          transition: opacity 180ms ease, transform 180ms ease;
          word-break: break-word;
          margin: 0;
        }
        #appToastHost .app-toast.alert.show {
          opacity: 1;
          transform: translateY(0);
        }
        #appToastHost .app-toast .alert-message {
          font-weight: 600;
          line-height: 1.35;
        }
        body.theme-dark #appToastHost .app-toast.alert {
          box-shadow: 0 20px 42px rgba(2, 6, 23, 0.55);
        }
        @media (max-width: 768px) {
          #appToastHost {
            left: 16px;
            right: 16px;
            bottom: 16px;
            align-items: stretch;
          }
          #appToastHost .app-toast.alert {
            max-width: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          #appToastHost .app-toast.alert {
            transition: none;
            transform: none;
          }
        }
      `;
      document.head.appendChild(style);
    };

    const ensureToastHost = () => {
      if (toastHost && toastHost.isConnected) return toastHost;
      ensureToastStyles();
      toastHost = document.getElementById('appToastHost');
      if (!toastHost) {
        toastHost = document.createElement('div');
        toastHost.id = 'appToastHost';
        toastHost.setAttribute('aria-live', 'polite');
        toastHost.setAttribute('aria-atomic', 'false');
        document.body.appendChild(toastHost);
      }
      return toastHost;
    };

    window.appToast = (message, options = {}) => {
      const text = String(message ?? '').trim();
      if (!text) return () => {};
      const config = typeof options === 'string' ? { type: options } : (options || {});
      const type = normalizeFeedbackType(config.type, 'info');
      const tone = type === 'primary' ? 'info' : type;
      const duration = Number.isFinite(Number(config.duration))
        ? Math.max(1200, Number(config.duration))
        : 3000;
      const host = ensureToastHost();
      const alert = document.createElement('div');
      alert.className = `alert alert-important alert-${tone} alert-dismissible app-toast show`;
      alert.setAttribute('role', 'status');
      alert.setAttribute('aria-live', 'polite');
      alert.setAttribute('aria-atomic', 'true');
      const alertIcon = document.createElement('span');
      alertIcon.className = 'alert-icon';
      alertIcon.innerHTML = `<i class="ti ${iconForType(type)}" aria-hidden="true"></i>`;
      const alertBody = document.createElement('div');
      alertBody.className = 'alert-message';
      alertBody.textContent = text;
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'btn-close';
      closeButton.setAttribute('aria-label', 'Close notification');
      alert.appendChild(alertIcon);
      alert.appendChild(alertBody);
      alert.appendChild(closeButton);
      host.appendChild(alert);

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        alert.classList.remove('show');
        setTimeout(() => alert.remove(), 180);
      };
      const timerId = duration > 0 ? setTimeout(close, duration) : null;
      closeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (timerId) clearTimeout(timerId);
        close();
      });
      alert.addEventListener('click', () => {
        if (timerId) clearTimeout(timerId);
        close();
      });
      requestAnimationFrame(() => {
        alert.classList.add('show');
      });
      return close;
    };
  }
})();
