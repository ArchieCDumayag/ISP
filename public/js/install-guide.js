(() => {
  const formatFileSize = (bytes) => {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value >= 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (value >= 1024) {
      return `${Math.round(value / 1024)} KB`;
    }
    return `${value} B`;
  };

  const applySlot = (card, slot) => {
    if (!card || !slot) return;

    const nameEl = card.querySelector('[data-app-download-name]');
    const iconEl = card.querySelector('[data-app-download-icon]');
    const linkEl = card.querySelector('[data-app-download-link]');
    const labelEl = card.querySelector('[data-app-download-label]');

    const appName = String(slot.name || '').trim() || 'Official Mobile App';
    if (nameEl) {
      nameEl.textContent = appName;
    }

    card.classList.toggle('app-download-card--custom-icon', Boolean(slot.iconUrl));

    if (iconEl && slot.iconUrl) {
      iconEl.src = slot.iconUrl;
    }
    if (iconEl) {
      iconEl.alt = `${appName} icon`;
    }

    if (linkEl) {
      const defaultHref = String(linkEl.dataset.defaultHref || linkEl.getAttribute('href') || '#').trim() || '#';
      const appUrl = String(slot.appUrl || '').trim();
      const hasDownload = Boolean(appUrl);

      linkEl.setAttribute('href', hasDownload ? appUrl : defaultHref);
      linkEl.classList.toggle('is-disabled', !hasDownload);
      linkEl.setAttribute('aria-disabled', hasDownload ? 'false' : 'true');
      if (hasDownload) {
        linkEl.removeAttribute('tabindex');
      } else {
        linkEl.setAttribute('tabindex', '-1');
      }

      if (labelEl) {
        labelEl.textContent = hasDownload ? 'Download Apps' : 'App Not Available';
      }

      if (hasDownload && slot.appFileName) {
        linkEl.setAttribute('download', String(slot.appFileName));
      } else {
        linkEl.removeAttribute('download');
      }

      const fileSize = formatFileSize(slot.appSizeBytes);
      if (hasDownload && slot.appFileName) {
        linkEl.title = fileSize ? `${slot.appFileName} (${fileSize})` : slot.appFileName;
      } else {
        linkEl.title = 'App download is not available yet.';
      }
    }
  };

  const loadDownloadApps = async () => {
    const cards = Array.from(document.querySelectorAll('[data-app-download-slot]'));
    if (!cards.length) return;

    try {
      const response = await fetch('/api/app-downloads', {
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) return;

      const slotMap = new Map(
        (Array.isArray(data.slots) ? data.slots : []).map((slot) => [String(slot.slot || ''), slot])
      );

      cards.forEach((card) => {
        const slot = slotMap.get(String(card.dataset.appDownloadSlot || '').trim());
        if (!slot) return;
        applySlot(card, slot);
      });
    } catch {
      // Keep static fallback content when app download data is unavailable.
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    loadDownloadApps();
  });
})();
