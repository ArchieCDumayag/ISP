(function () {
  if (typeof window === 'undefined' || window.appConfirm) return;

  const confirmQueue = [];
  let activeConfirm = null;
  let dialogElements = null;

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
        background: rgba(15, 23, 42, 0.52);
        backdrop-filter: blur(4px);
        z-index: 20000;
        padding: 18px;
      }
      #appConfirmOverlay.show { display: flex; }
      #appConfirmDialog {
        width: min(460px, 96vw);
        border-radius: 14px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: #ffffff;
        color: #0f172a;
        box-shadow: 0 24px 44px rgba(2, 6, 23, 0.28);
        overflow: hidden;
      }
      #appConfirmHead {
        padding: 16px 18px 10px;
        font-size: 0.95rem;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      #appConfirmBody {
        padding: 4px 18px 16px;
        font-size: 0.95rem;
        line-height: 1.45;
        white-space: pre-wrap;
      }
      #appConfirmActions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 12px 18px 16px;
        border-top: 1px solid rgba(148, 163, 184, 0.22);
        background: rgba(248, 250, 252, 0.82);
      }
      #appConfirmActions .app-confirm-btn {
        border: 1px solid rgba(148, 163, 184, 0.45);
        border-radius: 10px;
        padding: 9px 14px;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        background: #ffffff;
        color: #334155;
      }
      #appConfirmActions .app-confirm-btn.confirm {
        border-color: rgba(37, 99, 235, 0.3);
        background: linear-gradient(135deg, #00a6d6, #007bff);
        color: #ffffff;
      }
      #appConfirmActions .app-confirm-btn:focus-visible {
        outline: 2px solid rgba(37, 99, 235, 0.5);
        outline-offset: 2px;
      }
      body.theme-dark #appConfirmDialog {
        background: #0f172a;
        color: #e2e8f0;
        border-color: rgba(71, 85, 105, 0.7);
        box-shadow: 0 24px 44px rgba(2, 6, 23, 0.6);
      }
      body.theme-dark #appConfirmActions {
        background: rgba(15, 23, 42, 0.9);
        border-top-color: rgba(71, 85, 105, 0.55);
      }
      body.theme-dark #appConfirmActions .app-confirm-btn {
        background: rgba(30, 41, 59, 0.9);
        color: #e2e8f0;
        border-color: rgba(100, 116, 139, 0.7);
      }
      body.theme-dark #appConfirmActions .app-confirm-btn.confirm {
        border-color: rgba(59, 130, 246, 0.45);
        background: linear-gradient(135deg, #0ea5e9, #2563eb);
        color: #ffffff;
      }
    `;
    document.head.appendChild(style);
  };

  const queueNextConfirm = () => {
    if (activeConfirm || !confirmQueue.length) return;
    const next = confirmQueue.shift();
    const { overlay, title, message, okButton, cancelButton } = ensureConfirmDialog();
    activeConfirm = next;
    const options = next.options || {};
    title.textContent = options.title || 'Please confirm';
    message.textContent = String(next.message || '').trim() || 'Are you sure?';
    okButton.textContent = options.okText || 'OK';
    cancelButton.textContent = options.cancelText || 'Cancel';
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => okButton.focus({ preventScroll: true }), 0);
  };

  const ensureConfirmDialog = () => {
    if (dialogElements) return dialogElements;
    ensureConfirmStyles();
    const overlay = document.createElement('div');
    overlay.id = 'appConfirmOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div id="appConfirmDialog">
        <div id="appConfirmHead">Please confirm</div>
        <div id="appConfirmBody"></div>
        <div id="appConfirmActions">
          <button type="button" class="app-confirm-btn cancel" id="appConfirmCancel">Cancel</button>
          <button type="button" class="app-confirm-btn confirm" id="appConfirmOk">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const title = overlay.querySelector('#appConfirmHead');
    const message = overlay.querySelector('#appConfirmBody');
    const okButton = overlay.querySelector('#appConfirmOk');
    const cancelButton = overlay.querySelector('#appConfirmCancel');

    const resolveActive = (confirmed) => {
      if (!activeConfirm) return;
      const resolver = activeConfirm.resolve;
      activeConfirm = null;
      overlay.classList.remove('show');
      overlay.setAttribute('aria-hidden', 'true');
      resolver(Boolean(confirmed));
      queueNextConfirm();
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

    dialogElements = { overlay, title, message, okButton, cancelButton };
    return dialogElements;
  };

  window.appConfirm = (message, options) => new Promise((resolve) => {
    confirmQueue.push({ message, options, resolve });
    queueNextConfirm();
  });
})();
