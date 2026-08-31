(() => {
  const refs = {
    form: document.getElementById('collectorUpdateForm'),
    apk: document.getElementById('collectorUpdateApk'),
    versionName: document.getElementById('collectorUpdateVersionName'),
    versionCode: document.getElementById('collectorUpdateVersionCode'),
    notes: document.getElementById('collectorUpdateNotes'),
    required: document.getElementById('collectorUpdateRequired'),
    minimumCode: document.getElementById('collectorUpdateMinimumCode'),
    publish: document.getElementById('collectorUpdatePublish'),
    refresh: document.getElementById('collectorUpdateRefresh'),
    result: document.getElementById('collectorUpdateResult'),
    status: document.getElementById('collectorUpdateStatus'),
    currentVersion: document.getElementById('collectorUpdateVersion'),
    currentVersionCode: document.getElementById('collectorUpdateCurrentVersionCode'),
    size: document.getElementById('collectorUpdateSize'),
    published: document.getElementById('collectorUpdatePublished'),
    sha: document.getElementById('collectorUpdateSha'),
    manifestLink: document.getElementById('collectorManifestLink'),
    apkLink: document.getElementById('collectorApkLink')
  };

  let currentUpdate = null;

  const formatBytes = (value) => {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '—';
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (value) => {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
  };

  const setLink = (element, url) => {
    const active = Boolean(url);
    element.href = active ? url : '#';
    element.classList.toggle('disabled', !active);
    element.setAttribute('aria-disabled', active ? 'false' : 'true');
  };

  const setResult = (message = '', type = 'info') => {
    refs.result.textContent = message;
    refs.result.className = `alert alert-${type} mt-3 mb-0${message ? '' : ' d-none'}`;
  };

  const setLoading = (loading) => {
    refs.publish.disabled = loading;
    refs.refresh.disabled = loading;
    refs.publish.innerHTML = loading
      ? '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Publishing…'
      : '<i class="ti ti-cloud-upload me-1" aria-hidden="true"></i> Publish Update';
  };

  const renderStatus = (data) => {
    currentUpdate = data?.available ? data.update : null;
    refs.status.textContent = currentUpdate ? 'Available' : 'Not published';
    refs.status.className = currentUpdate ? 'text-success fw-semibold' : 'text-secondary';
    refs.currentVersion.textContent = currentUpdate?.versionName || '—';
    refs.currentVersionCode.textContent = currentUpdate?.versionCode ?? '—';
    refs.size.textContent = formatBytes(currentUpdate?.fileSize);
    refs.published.textContent = formatDate(currentUpdate?.publishedAt);
    refs.sha.textContent = currentUpdate?.sha256 || '—';
    setLink(refs.manifestLink, data?.manifestUrl || '');
    setLink(refs.apkLink, currentUpdate?.apkUrl || '');

    if (currentUpdate && !refs.versionCode.value) {
      refs.versionCode.value = String(Number(currentUpdate.versionCode) + 1);
    }
  };

  const loadStatus = async () => {
    refs.refresh.disabled = true;
    try {
      const response = await fetch('/api/collector-app-updates', { credentials: 'include', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Failed to load Collector update status.');
      renderStatus(data);
    } catch (error) {
      setResult(error.message || 'Failed to load Collector update status.', 'danger');
    } finally {
      refs.refresh.disabled = false;
    }
  };

  refs.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setResult('');
    if (!refs.form.reportValidity()) return;

    const file = refs.apk.files?.[0];
    if (!file || !file.name.toLowerCase().endsWith('.apk')) {
      setResult('Select a valid APK file.', 'danger');
      return;
    }
    if (file.size <= 0 || file.size > 80 * 1024 * 1024) {
      setResult('APK must be between 1 byte and 80 MB.', 'danger');
      return;
    }

    const versionCode = Number(refs.versionCode.value);
    if (currentUpdate && versionCode < Number(currentUpdate.versionCode)) {
      setResult(`Version code cannot be lower than ${currentUpdate.versionCode}.`, 'danger');
      return;
    }

    const confirmation = `Publish THRE3J Collector ${refs.versionName.value.trim()} (version code ${versionCode}) to all phones?`;
    const confirmed = window.appConfirm
      ? await window.appConfirm(confirmation, { title: 'Publish Collector Update', confirmText: 'Publish Update' })
      : window.confirm(confirmation);
    if (!confirmed) return;

    const query = new URLSearchParams({
      versionName: refs.versionName.value.trim(),
      versionCode: String(versionCode),
      releaseNotes: refs.notes.value.trim(),
      required: refs.required.checked ? 'true' : 'false',
      minimumVersionCode: refs.minimumCode.value || '0'
    });

    try {
      setLoading(true);
      setResult('Uploading and verifying the APK…', 'info');
      const response = await fetch(`/api/collector-app-updates/publish?${query.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.android.package-archive' },
        credentials: 'include',
        body: file
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Failed to publish Collector update.');
      refs.apk.value = '';
      renderStatus({ ok: true, available: true, update: data.update, manifestUrl: data.manifestUrl });
      setResult(data.message || 'Collector update published.', 'success');
    } catch (error) {
      setResult(error.message || 'Failed to publish Collector update.', 'danger');
    } finally {
      setLoading(false);
    }
  });

  refs.refresh.addEventListener('click', loadStatus);
  loadStatus();
})();
