document.addEventListener('DOMContentLoaded', () => {
    const locale = 'en-PH';
    const appTimeZone = window.__APP_TIMEZONE__ || 'Asia/Manila';
    const utcOffsetSuffix = 'Z';
    const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
    const SQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    const ISO_DATETIME_NO_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
    const searchInput = document.getElementById('paymentHistorySearch');
    const areaFilter = document.getElementById('paymentHistoryArea');
    const methodFilter = document.getElementById('paymentHistoryMethod');
    const recordedByFilter = document.getElementById('paymentHistoryRecordedBy');
    const startDateInput = document.getElementById('paymentHistoryStartDate');
    const endDateInput = document.getElementById('paymentHistoryEndDate');
    const sortSelect = document.getElementById('paymentHistorySort');
    const pageSizeSelect = document.getElementById('paymentHistoryPageSize');
    const tableBody = document.getElementById('paymentHistoryTableBody');
    const summaryEl = document.getElementById('paymentHistorySummary');
    const pageInfoEl = document.getElementById('paymentHistoryPageInfo');
    const prevBtn = document.getElementById('paymentHistoryPrev');
    const nextBtn = document.getElementById('paymentHistoryNext');
    const importBtn = document.getElementById('paymentHistoryImportBtn');
    const importFileInput = document.getElementById('paymentHistoryImportFile');
    const exportMonthInput = document.getElementById('paymentHistoryExportMonth');
    const exportBtn = document.getElementById('paymentHistoryExportBtn');
    const backupBtn = document.getElementById('paymentHistoryBackupBtn');
    const clearBtn = document.getElementById('paymentHistoryClearBtn');
    const metricEntriesEl = document.getElementById('historyMetricEntries');
    const metricPaymentsEl = document.getElementById('historyMetricPayments');
    const metricReferencesEl = document.getElementById('historyMetricReferences');
    const metricAccountsEl = document.getElementById('historyMetricAccounts');

    const currencyFormatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const countFormatter = new Intl.NumberFormat(locale);
    const dateFormatter = new Intl.DateTimeFormat(locale, {
        timeZone: appTimeZone,
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
    const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
        timeZone: appTimeZone,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
    const dateKeyFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: appTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const state = {
        allRows: [],
        filteredRows: [],
        page: 1,
        pageSize: Number(pageSizeSelect?.value) || 25
    };

    const formatCurrency = (value) => currencyFormatter.format(Number(value) || 0);
    const formatCount = (value) => countFormatter.format(Number(value) || 0);
    const normalizeText = (value) => String(value || '').trim().toLowerCase();
    const hideAllocationMetadata = (value) => String(value ?? '')
        .replace(/\s*\[ALLOC:\s*[\s\S]*?\]\s*/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    const showToast = (message, type = 'info') => {
        const text = String(message || '').trim();
        if (!text) return;
        if (typeof window.appToast === 'function') {
            window.appToast(text, { type });
            return;
        }
        window.alert(text);
    };
    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const getInitials = (value) => {
        const words = String(value || '').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return 'NA';
        return words.slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join('');
    };

    const parseDateOnlyParts = (value) => {
        const raw = String(value ?? '').trim();
        if (!raw) return null;
        const match = raw.match(DATE_ONLY_RE);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
        return { year, month, day };
    };

    const buildStableDate = (year, month, day) => new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

    const safeDate = (raw) => {
        if (!raw && raw !== 0) return null;
        const text = String(raw).trim();
        if (!text) return null;

        const dateOnlyParts = parseDateOnlyParts(text);
        if (dateOnlyParts) {
            return buildStableDate(dateOnlyParts.year, dateOnlyParts.month, dateOnlyParts.day);
        }
        if (SQL_DATETIME_RE.test(text)) {
            const parsed = new Date(text.replace(' ', 'T') + utcOffsetSuffix);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        if (ISO_DATETIME_NO_TZ_RE.test(text)) {
            const parsed = new Date(`${text}${utcOffsetSuffix}`);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        const parsed = new Date(text);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const toDateKey = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
        const parts = dateKeyFormatter.formatToParts(date);
        const year = parts.find((part) => part.type === 'year')?.value || '';
        const month = parts.find((part) => part.type === 'month')?.value || '';
        const day = parts.find((part) => part.type === 'day')?.value || '';
        if (!year || !month || !day) return '';
        return `${year}-${month}-${day}`;
    };

    const compareIdentity = (left, right) => {
        if (left.accountNumber !== right.accountNumber) return left.accountNumber.localeCompare(right.accountNumber);
        return String(left.id).localeCompare(String(right.id));
    };

    const compareNewestFirst = (left, right) => {
        if (right.timestamp !== left.timestamp) return right.timestamp - left.timestamp;
        if (left.dateKey !== right.dateKey) return String(right.dateKey).localeCompare(String(left.dateKey));
        return compareIdentity(left, right);
    };

    const compareOldestFirst = (left, right) => {
        if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
        if (left.dateKey !== right.dateKey) return String(left.dateKey).localeCompare(String(right.dateKey));
        return compareIdentity(left, right);
    };

    const resolveDirection = (entry) => {
        const direction = normalizeText(entry?.direction || entry?.nature);
        if (direction === 'debit' || direction === 'credit') return direction;
        const kind = normalizeText(entry?.kind);
        if (kind === 'charge' || kind === 'debit' || kind === 'bill') return 'debit';
        return 'credit';
    };

    const resolveKind = (entry) => {
        const kind = normalizeText(entry?.kind);
        if (kind) return kind;
        return resolveDirection(entry) === 'debit' ? 'charge' : 'payment';
    };

    const getCustomerArea = (customer) => String(
        customer?.area
        || customer?.coverageArea
        || customer?.cluster
        || ''
    ).trim();

    const getCustomerName = (customer, accountNumber) => {
        const firstName = String(customer?.firstName || '').trim();
        const lastName = String(customer?.lastName || '').trim();
        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
        const fallback = String(customer?.name || customer?.fullName || '').trim();
        return fullName || fallback || `Account ${accountNumber}`;
    };

    const formatRecorderLabel = (entry) => {
        const recorder = entry?.recordedBy || {};
        const name = String(recorder?.name || recorder?.username || '').trim();
        const role = normalizeText(recorder?.role);
        const roles = role.split(/[,/|;]+|\s+\+\s+|\s+and\s+/i).map((item) => item.trim()).filter(Boolean);
        if (name && roles.includes('collector')) return `${name} (Collector)`;
        if (name && roles.includes('admin')) return `${name} (Admin)`;
        if (name && role) return `${name} (${role.charAt(0).toUpperCase()}${role.slice(1)})`;
        if (name) return name;

        const method = String(entry?.paymentMethod || entry?.method || entry?.channel || '').trim();
        if (entry?.xenditId) return 'Xendit';
        if (method) return method;
        return 'System';
    };

    const resolvePaymentMethodLabel = (entry) => {
        const rawMethod = String(
            entry?.paymentMethod
            || entry?.payment_method
            || entry?.method
            || entry?.channel
            || entry?.paymentChannel
            || entry?.payment_channel
            || ''
        ).trim();
        const normalized = normalizeText(rawMethod).replace(/[\s-]+/g, '_');

        if (normalized.includes('gcash') || normalized.includes('ph_gcash')) return 'GCash';
        if (normalized === 'cash' || normalized.includes('_cash') || normalized.includes('cash_')) return 'Cash';
        if (entry?.xenditId || entry?.xendit_id) return rawMethod || 'Xendit';
        return rawMethod || 'Cash';
    };

    const resolvePaymentMethodKey = (label) => {
        const normalized = normalizeText(label);
        if (normalized === 'gcash') return 'gcash';
        if (normalized === 'cash') return 'cash';
        return normalized;
    };

    const formatEntryDate = (rawDate, dateObj) => {
        if (!dateObj) return String(rawDate || 'No date');
        const hasTime = /T\d{2}:\d{2}/.test(String(rawDate || '')) || /\d{2}:\d{2}(:\d{2})?/.test(String(rawDate || ''));
        return hasTime ? dateTimeFormatter.format(dateObj) : dateFormatter.format(dateObj);
    };

    async function fetchJSON(url, options = {}) {
        const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload?.error || payload?.message || `Request failed: ${response.status}`);
            error.status = response.status;
            error.payload = payload;
            throw error;
        }
        return payload;
    }

    const setButtonBusy = (button, busy) => {
        if (!button) return;
        button.disabled = Boolean(busy);
        if (busy) {
            button.setAttribute('aria-busy', 'true');
        } else {
            button.removeAttribute('aria-busy');
        }
    };

    const describeBackup = (backup = {}) => {
        const filename = String(backup.filename || '').trim();
        const entryCount = Number(backup.entryCount) || 0;
        const accountCount = Number(backup.accountCount) || 0;
        const countText = `${formatCount(entryCount)} ${entryCount === 1 ? 'entry' : 'entries'}`;
        const accountText = `${formatCount(accountCount)} ${accountCount === 1 ? 'account' : 'accounts'}`;
        return filename
            ? `${filename} (${countText}, ${accountText})`
            : `${countText}, ${accountText}`;
    };
    const describePaymentImport = (payload = {}) => {
        const imported = Number(payload.imported) || 0;
        const duplicates = Number(payload.duplicates) || 0;
        const skipped = Number(payload.skipped) || 0;
        const cash = Number(payload?.methods?.cash) || 0;
        const gcash = Number(payload?.methods?.gcash) || 0;
        const importedText = `${formatCount(imported)} ${imported === 1 ? 'payment' : 'payments'}`;
        const methodText = `Cash ${formatCount(cash)}, GCash ${formatCount(gcash)}`;
        const extras = [];
        if (duplicates) extras.push(`${formatCount(duplicates)} duplicate${duplicates === 1 ? '' : 's'} skipped`);
        if (skipped) extras.push(`${formatCount(skipped)} unmatched row${skipped === 1 ? '' : 's'} skipped`);
        return `Imported ${importedText} (${methodText})${extras.length ? `. ${extras.join('; ')}.` : '.'}`;
    };
    const countEntriesInPayments = (payments = {}) => Object.values(payments || {}).reduce((sum, record) => (
        sum + (Array.isArray(record?.history) ? record.history.length : 0)
    ), 0);
    const countAccountsInPayments = (payments = {}) => Object.values(payments || {}).filter((record) => (
        Array.isArray(record?.history) && record.history.length > 0
    )).length;
    const makeBackupFilename = () => `payment-records-browser-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const buildBrowserBackupPayload = (payments = {}, reason = 'manual-browser-backup') => ({
        ok: true,
        createdAt: new Date().toISOString(),
        reason,
        storage: 'browser-download',
        accountCount: countAccountsInPayments(payments),
        entryCount: countEntriesInPayments(payments),
        payments
    });
    const downloadJsonBackup = (payload) => {
        const filename = makeBackupFilename();
        const blob = new Blob([JSON.stringify({ ...payload, filename }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return {
            filename,
            accountCount: payload.accountCount,
            entryCount: payload.entryCount
        };
    };
    const canUseBrowserFallback = (error) => ![401, 403].includes(Number(error?.status));
    const getCurrentMonthValue = () => {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: appTimeZone,
            year: 'numeric',
            month: '2-digit'
        }).formatToParts(new Date());
        const year = parts.find((part) => part.type === 'year')?.value;
        const month = parts.find((part) => part.type === 'month')?.value;
        return year && month ? `${year}-${month}` : new Date().toISOString().slice(0, 7);
    };
    const parseFilenameFromDisposition = (raw = '') => {
        const header = String(raw || '');
        const utf8Match = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
        if (utf8Match?.[1]) {
            try {
                return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''));
            } catch {
                return utf8Match[1].trim().replace(/^"|"$/g, '');
            }
        }
        const plainMatch = header.match(/filename\s*=\s*("?)([^";]+)\1/i);
        return plainMatch?.[2]?.trim() || '';
    };
    const downloadBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    if (exportMonthInput && !exportMonthInput.value) {
        exportMonthInput.value = getCurrentMonthValue();
    }

    function populateAreaFilter(rows) {
        if (!areaFilter) return;
        const currentValue = String(areaFilter.value || '').trim();
        const uniqueAreas = Array.from(new Set(
            (Array.isArray(rows) ? rows : [])
                .map((row) => String(row.area || '').trim())
                .filter(Boolean)
        )).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true }));

        areaFilter.innerHTML = '<option value="">All areas</option>';
        uniqueAreas.forEach((area) => {
            areaFilter.add(new Option(area, area));
        });

        areaFilter.value = uniqueAreas.includes(currentValue) ? currentValue : '';
    }

    function populateRecordedByFilter(rows) {
        if (!recordedByFilter) return;
        const currentValue = String(recordedByFilter.value || '').trim();
        const uniqueRecorders = Array.from(new Set(
            (Array.isArray(rows) ? rows : [])
                .map((row) => String(row.recordedByLabel || '').trim())
                .filter(Boolean)
        )).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true }));

        recordedByFilter.innerHTML = '<option value="">All recipients</option>';
        uniqueRecorders.forEach((recorderLabel) => {
            recordedByFilter.add(new Option(recorderLabel, recorderLabel));
        });

        recordedByFilter.value = uniqueRecorders.includes(currentValue) ? currentValue : '';
    }

    function buildRows(customers, payments) {
        const customerMap = new Map(
            (Array.isArray(customers) ? customers : []).map((customer) => [
                String(customer?.accountNumber || '').trim(),
                customer
            ])
        );

        const rows = [];
        Object.entries(payments || {}).forEach(([accountNumber, paymentRecord]) => {
            const paymentFallbackCustomer = paymentRecord?.customerName || paymentRecord?.name
                ? {
                    name: paymentRecord.customerName || paymentRecord.name,
                    area: paymentRecord.area || paymentRecord.coverageArea || ''
                }
                : null;
            const customer = customerMap.get(String(accountNumber || '').trim()) || paymentFallbackCustomer;
            const subscriber = getCustomerName(customer, accountNumber);
            const area = getCustomerArea(customer) || 'Unassigned';

            (paymentRecord?.history || []).forEach((entry, index) => {
                const rawDate = entry?.recordedAt || entry?.date || '';
                const dateObj = safeDate(rawDate);
                const dateKey = dateObj ? toDateKey(dateObj) : String(rawDate || '').slice(0, 10);
                const direction = resolveDirection(entry);
                const kind = resolveKind(entry);
                if (!(kind === 'payment' && direction === 'credit')) return;
                const amount = Math.abs(Number(entry?.amount) || 0);
                const reference = String(entry?.reference || entry?.ref || '').trim();
                const orNumber = String(entry?.orNumber || entry?.or_number || '').trim();
                const notes = hideAllocationMetadata(entry?.description || entry?.notes || '');
                const recordedByLabel = formatRecorderLabel(entry);
                const paymentMethodLabel = resolvePaymentMethodLabel(entry);
                const paymentMethodKey = resolvePaymentMethodKey(paymentMethodLabel);
                const displayDate = formatEntryDate(rawDate, dateObj);
                const entryId = String(entry?.id || '').trim();

                rows.push({
                    id: `${accountNumber}-${entryId || entry?.reference || index}`,
                    entryId,
                    accountNumber: String(accountNumber || '').trim(),
                    subscriber,
                    area,
                    amount,
                    reference,
                    orNumber,
                    notes,
                    paymentMethodLabel,
                    paymentMethodKey,
                    recordedByLabel,
                    recordedByKey: normalizeText(recordedByLabel),
                    rawDate,
                    displayDate,
                    dateKey,
                    timestamp: dateObj ? dateObj.getTime() : 0
                });
            });
        });

        rows.sort((left, right) => {
            if (right.timestamp !== left.timestamp) return right.timestamp - left.timestamp;
            if (left.dateKey !== right.dateKey) return String(right.dateKey).localeCompare(String(left.dateKey));
            if (left.accountNumber !== right.accountNumber) return left.accountNumber.localeCompare(right.accountNumber);
            return String(left.id).localeCompare(String(right.id));
        });

        rows.forEach((row) => {
            row.searchBlob = normalizeText([
                row.accountNumber,
                row.subscriber,
                row.area,
                row.reference,
                row.orNumber,
                row.paymentMethodLabel,
                row.recordedByLabel,
                row.notes
            ].join(' '));
        });

        return rows;
    }

    function updateMetrics(rows) {
        const entries = Array.isArray(rows) ? rows.length : 0;
        const paymentsCollected = (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + row.amount, 0);
        const referencedEntries = (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
            return row.reference || row.orNumber ? sum + 1 : sum;
        }, 0);
        const accountsTouched = new Set((Array.isArray(rows) ? rows : []).map((row) => row.accountNumber).filter(Boolean)).size;

        if (metricEntriesEl) metricEntriesEl.textContent = formatCount(entries);
        if (metricPaymentsEl) metricPaymentsEl.textContent = formatCurrency(paymentsCollected);
        if (metricReferencesEl) metricReferencesEl.textContent = formatCount(referencedEntries);
        if (metricAccountsEl) metricAccountsEl.textContent = formatCount(accountsTouched);
    }

    function sortRows(rows) {
        const sortValue = String(sortSelect?.value || 'newOld').trim();
        const sortedRows = Array.isArray(rows) ? rows.slice() : [];

        sortedRows.sort((left, right) => {
            switch (sortValue) {
                case 'oldNew':
                    return compareOldestFirst(left, right);
                case 'amountHighLow':
                    if (right.amount !== left.amount) return right.amount - left.amount;
                    return compareNewestFirst(left, right);
                case 'amountLowHigh':
                    if (left.amount !== right.amount) return left.amount - right.amount;
                    return compareNewestFirst(left, right);
                case 'newOld':
                default:
                    return compareNewestFirst(left, right);
            }
        });

        return sortedRows;
    }

    function renderTable() {
        if (!tableBody) return;

        const total = state.filteredRows.length;
        const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
        state.page = Math.min(Math.max(1, state.page), totalPages);

        const startIndex = total === 0 ? 0 : ((state.page - 1) * state.pageSize);
        const pageRows = state.filteredRows.slice(startIndex, startIndex + state.pageSize);
        const visibleStart = total === 0 ? 0 : startIndex + 1;
        const visibleEnd = total === 0 ? 0 : startIndex + pageRows.length;

        if (!pageRows.length) {
            tableBody.innerHTML = `
                <tr class="payment-history-empty-row">
                    <td colspan="7" class="payment-history-empty-cell">
                        <div class="empty">
                            <div class="empty-icon">
                                <i class="ti ti-receipt-off"></i>
                            </div>
                            <p class="empty-title">No payment history matched the current filters.</p>
                        </div>
                    </td>
                </tr>
            `;
        } else {
            tableBody.innerHTML = pageRows.map((row) => {
                const signedAmount = formatCurrency(row.amount);
                const subscriberInitials = escapeHtml(getInitials(row.subscriber));
                const referenceLine = row.reference
                    ? `<span class="fw-semibold">${escapeHtml(row.reference)}</span>`
                    : '<span class="text-secondary">No reference</span>';
                const orLine = row.orNumber
                    ? `<span class="text-secondary">OR: ${escapeHtml(row.orNumber)}</span>`
                    : '<span class="text-secondary">OR: N/A</span>';
                const methodLine = row.paymentMethodLabel
                    ? `<span class="badge bg-secondary-lt text-secondary">${escapeHtml(row.paymentMethodLabel)}</span>`
                    : '';
                const noteLine = row.notes
                    ? `<span class="payment-history-note text-secondary">${escapeHtml(row.notes)}</span>`
                    : '';
                const printButton = row.accountNumber
                    ? `<button type="button" class="payment-history-print btn btn-icon btn-ghost-secondary btn-sm" data-account-number="${escapeHtml(row.accountNumber)}" data-entry-id="${escapeHtml(row.entryId)}" data-reference="${escapeHtml(row.reference || row.orNumber || '')}" aria-label="Reprint thermal receipt" title="Reprint thermal receipt"><i class="ti ti-receipt"></i></button>`
                    : '';
                const deleteButton = row.entryId
                    ? `<button type="button" class="payment-history-delete btn btn-icon btn-ghost-danger btn-sm" data-account-number="${escapeHtml(row.accountNumber)}" data-entry-id="${escapeHtml(row.entryId)}" aria-label="Delete payment" title="Delete payment"><i class="ti ti-trash"></i></button>`
                    : '<span class="text-secondary">-</span>';

                return `
                    <tr>
                        <td>
                            <div class="payment-history-stack">
                                <span class="fw-semibold">${escapeHtml(row.displayDate)}</span>
                                <span class="text-secondary">${escapeHtml(row.dateKey || 'No date')}</span>
                            </div>
                        </td>
                        <td>
                            <div class="subscriber">
                                <span class="avatar avatar-sm bg-primary-lt text-primary">${subscriberInitials}</span>
                                <div class="subscriber-details">
                                    <p class="subscriber-name mb-0 fw-semibold">${escapeHtml(row.subscriber)}</p>
                                    <p class="subscriber-meta mb-0 text-secondary">Account # ${escapeHtml(row.accountNumber || 'N/A')}</p>
                                </div>
                            </div>
                        </td>
                        <td>${escapeHtml(row.area)}</td>
                        <td class="is-num"><span class="payment-history-amount text-success fw-semibold">${escapeHtml(signedAmount)}</span></td>
                        <td>
                            <div class="payment-history-stack">
                                ${referenceLine}
                                ${orLine}
                                ${methodLine}
                            </div>
                        </td>
                        <td>
                            <div class="payment-history-stack">
                                <span class="fw-semibold">${escapeHtml(row.recordedByLabel)}</span>
                                ${noteLine}
                            </div>
                        </td>
                        <td class="payment-history-actions-cell">
                            <div class="payment-history-action-row">
                                ${printButton}
                                ${deleteButton}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        if (summaryEl) {
            summaryEl.textContent = total === 0
                ? 'No payment history found.'
                : `Showing ${formatCount(visibleStart)}-${formatCount(visibleEnd)} of ${formatCount(total)} entries`;
        }
        if (pageInfoEl) {
            pageInfoEl.textContent = `Page ${formatCount(total === 0 ? 1 : state.page)} of ${formatCount(totalPages)}`;
        }
        if (prevBtn) prevBtn.disabled = state.page <= 1 || total === 0;
        if (nextBtn) nextBtn.disabled = state.page >= totalPages || total === 0;
    }

    async function deletePayment(row) {
        const accountNumber = String(row?.accountNumber || '').trim();
        const entryId = String(row?.entryId || '').trim();
        if (!accountNumber || !entryId) {
            showToast('Unable to delete: missing payment entry id.', 'error');
            return false;
        }

        const confirmed = typeof window.appConfirm === 'function'
            ? await window.appConfirm('Delete this payment history entry? This cannot be undone.', { title: 'Delete Payment' })
            : window.confirm('Delete this payment history entry? This cannot be undone.');
        if (!confirmed) return false;

        const response = await fetch(`/api/payments/${encodeURIComponent(accountNumber)}/${encodeURIComponent(entryId)}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload?.error || payload?.message || 'Failed to delete payment entry.');
        }

        state.allRows = state.allRows.filter((item) => !(item.accountNumber === accountNumber && item.entryId === entryId));
        populateAreaFilter(state.allRows);
        populateRecordedByFilter(state.allRows);
        applyFilters({ resetPage: false });
        showToast('Payment history entry deleted.', 'success');
        return true;
    }

    async function backupPaymentRecords() {
        setButtonBusy(backupBtn, true);
        try {
            try {
                const payload = await fetchJSON('/api/payments/backup', { method: 'POST' });
                showToast(`Backup saved: ${describeBackup(payload?.backup)}`, 'success');
                return;
            } catch (serverError) {
                if (!canUseBrowserFallback(serverError)) throw serverError;
                const payments = await fetchJSON('/api/payments');
                const backup = downloadJsonBackup(buildBrowserBackupPayload(payments));
                showToast(`Backup downloaded: ${describeBackup(backup)}`, 'success');
            }
        } catch (error) {
            showToast(error.message || 'Failed to back up payment records.', 'error');
        } finally {
            setButtonBusy(backupBtn, false);
        }
    }

    async function importPaymentHistoryFromFile(file) {
        if (!file) return;
        const fileName = String(file.name || '').trim();
        if (!/\.(xlsx|xls)$/i.test(fileName)) {
            showToast('Select an Excel file (.xlsx or .xls).', 'error');
            if (importFileInput) importFileInput.value = '';
            return;
        }

        setButtonBusy(importBtn, true);
        setButtonBusy(backupBtn, true);
        setButtonBusy(clearBtn, true);
        try {
            const response = await fetch('/api/payments/import-excel', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Import-Filename': encodeURIComponent(fileName || 'payment-history-import.xlsx')
                },
                body: await file.arrayBuffer()
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.ok === false) {
                throw new Error(payload?.error || payload?.message || 'Failed to import payment records.');
            }

            await loadHistory();
            if (Array.isArray(payload?.warnings) && payload.warnings.length) {
                console.warn('Payment import skipped rows:', payload.warnings);
            }
            showToast(describePaymentImport(payload), Number(payload?.imported) ? 'success' : 'info');
        } catch (error) {
            showToast(error.message || 'Failed to import payment records.', 'error');
        } finally {
            setButtonBusy(importBtn, false);
            setButtonBusy(backupBtn, false);
            setButtonBusy(clearBtn, false);
            if (importFileInput) importFileInput.value = '';
        }
    }

    async function exportPaymentHistoryExcel() {
        const monthValue = String(exportMonthInput?.value || '').trim();
        if (!/^\d{4}-\d{2}$/.test(monthValue)) {
            showToast('Select a month to export.', 'error');
            exportMonthInput?.focus();
            return;
        }

        setButtonBusy(exportBtn, true);
        try {
            const response = await fetch(`/api/payments/export-excel?month=${encodeURIComponent(monthValue)}`, {
                credentials: 'include',
                cache: 'no-store'
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error || payload?.message || 'Failed to export payment history.');
            }
            const blob = await response.blob();
            const filename = parseFilenameFromDisposition(response.headers.get('content-disposition'))
                || `payment-history-${monthValue}.xlsx`;
            downloadBlob(blob, filename);
            showToast(`Payment history exported: ${filename}`, 'success');
        } catch (error) {
            showToast(error.message || 'Failed to export payment history.', 'error');
        } finally {
            setButtonBusy(exportBtn, false);
        }
    }

    async function deleteEntriesFromPayments(payments = {}) {
        const entries = [];
        Object.entries(payments || {}).forEach(([accountNumber, record]) => {
            (Array.isArray(record?.history) ? record.history : []).forEach((entry) => {
                const entryId = String(entry?.id || '').trim();
                if (!entryId) return;
                entries.push({ accountNumber: String(accountNumber || '').trim(), entryId });
            });
        });

        let deletedCount = 0;
        for (const entry of entries) {
            const response = await fetch(`/api/payments/${encodeURIComponent(entry.accountNumber)}/${encodeURIComponent(entry.entryId)}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error || payload?.message || `Failed after deleting ${formatCount(deletedCount)} ${deletedCount === 1 ? 'entry' : 'entries'}.`);
            }
            deletedCount += 1;
        }

        return deletedCount;
    }

    async function clearPaymentRecords() {
        const currentCount = state.allRows.length;
        const confirmed = typeof window.appConfirm === 'function'
            ? await window.appConfirm(
                `Clear all payment records? A backup will be created first. This removes the stored payment records for this branch. Currently listed payment entries: ${formatCount(currentCount)}.`,
                { title: 'Clear Payment Records' }
            )
            : window.confirm(`Clear all payment records? A backup will be created first. This removes the stored payment records for this branch. Currently listed payment entries: ${formatCount(currentCount)}.`);
        if (!confirmed) return;

        setButtonBusy(clearBtn, true);
        setButtonBusy(backupBtn, true);
        try {
            const payments = await fetchJSON('/api/payments');
            try {
                const payload = await fetchJSON('/api/payments/clear', { method: 'DELETE' });
                await loadHistory();
                const removedCount = Number(payload?.removedCount) || countEntriesInPayments(payments);
                showToast(`Cleared ${formatCount(removedCount)} payment ${removedCount === 1 ? 'entry' : 'entries'}. Backup saved: ${describeBackup(payload?.backup)}`, 'success');
                return;
            } catch (serverError) {
                if (!canUseBrowserFallback(serverError)) throw serverError;
                const backup = downloadJsonBackup(buildBrowserBackupPayload(payments, 'before-clear-browser-backup'));
                const removedCount = await deleteEntriesFromPayments(payments);
                await loadHistory();
                showToast(`Cleared ${formatCount(removedCount)} payment ${removedCount === 1 ? 'entry' : 'entries'}. Backup downloaded: ${describeBackup(backup)}`, 'success');
            }
        } catch (error) {
            showToast(error.message || 'Failed to clear payment records.', 'error');
        } finally {
            setButtonBusy(clearBtn, false);
            setButtonBusy(backupBtn, false);
        }
    }

    function applyFilters({ resetPage = true } = {}) {
        const searchValue = normalizeText(searchInput?.value);
        const areaValue = String(areaFilter?.value || '').trim();
        const methodValue = normalizeText(methodFilter?.value);
        const recordedByValue = normalizeText(recordedByFilter?.value);
        const startDateValue = String(startDateInput?.value || '').trim();
        const endDateValue = String(endDateInput?.value || '').trim();

        state.pageSize = Math.max(1, Number(pageSizeSelect?.value) || 25);

        const filteredRows = state.allRows.filter((row) => {
            if (searchValue && !row.searchBlob.includes(searchValue)) return false;
            if (areaValue && row.area !== areaValue) return false;
            if (methodValue && row.paymentMethodKey !== methodValue) return false;
            if (recordedByValue && row.recordedByKey !== recordedByValue) return false;
            if (startDateValue && (!row.dateKey || row.dateKey < startDateValue)) return false;
            if (endDateValue && (!row.dateKey || row.dateKey > endDateValue)) return false;
            return true;
        });
        state.filteredRows = sortRows(filteredRows);

        if (resetPage) state.page = 1;
        updateMetrics(state.filteredRows);
        renderTable();
    }

    async function loadHistory() {
        try {
            const [customerPayload, paymentPayload] = await Promise.all([
                fetchJSON('/api/customers'),
                fetchJSON('/api/payments')
            ]);

            state.allRows = buildRows(customerPayload?.customers || [], paymentPayload || {});
            populateAreaFilter(state.allRows);
            populateRecordedByFilter(state.allRows);
            applyFilters({ resetPage: true });
        } catch (error) {
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr class="payment-history-empty-row">
                        <td colspan="7" class="payment-history-empty-cell">
                            <div class="empty">
                                <div class="empty-icon text-danger">
                                    <i class="ti ti-alert-circle"></i>
                                </div>
                                <p class="empty-title">${escapeHtml(error.message || 'Failed to load payment history.')}</p>
                            </div>
                        </td>
                    </tr>
                `;
            }
            if (summaryEl) summaryEl.textContent = 'Could not load payment history.';
            updateMetrics([]);
            if (pageInfoEl) pageInfoEl.textContent = 'Page 1 of 1';
            if (prevBtn) prevBtn.disabled = true;
            if (nextBtn) nextBtn.disabled = true;
        }
    }

    searchInput?.addEventListener('input', () => applyFilters({ resetPage: true }));
    areaFilter?.addEventListener('change', () => applyFilters({ resetPage: true }));
    methodFilter?.addEventListener('change', () => applyFilters({ resetPage: true }));
    recordedByFilter?.addEventListener('change', () => applyFilters({ resetPage: true }));
    startDateInput?.addEventListener('change', () => applyFilters({ resetPage: true }));
    endDateInput?.addEventListener('change', () => applyFilters({ resetPage: true }));
    sortSelect?.addEventListener('change', () => applyFilters({ resetPage: true }));
    pageSizeSelect?.addEventListener('change', () => applyFilters({ resetPage: true }));
    importBtn?.addEventListener('click', () => importFileInput?.click());
    importFileInput?.addEventListener('change', () => {
        void importPaymentHistoryFromFile(importFileInput.files?.[0] || null);
    });
    exportBtn?.addEventListener('click', exportPaymentHistoryExcel);
    backupBtn?.addEventListener('click', backupPaymentRecords);
    clearBtn?.addEventListener('click', clearPaymentRecords);
    tableBody?.addEventListener('click', async (event) => {
        const printBtn = event.target.closest('.payment-history-print');
        if (printBtn) {
            const accountNumber = String(printBtn.dataset.accountNumber || '').trim();
            const entryId = String(printBtn.dataset.entryId || '').trim();
            const reference = String(printBtn.dataset.reference || '').trim();
            if (!accountNumber) {
                showToast('Unable to reprint: missing account number.', 'error');
                return;
            }
            const params = new URLSearchParams({ account: accountNumber });
            if (entryId) params.set('entry', entryId);
            else if (reference) params.set('reference', reference);
            const printWindow = window.open(`thermal-print.html?${params.toString()}`, '_blank', 'noopener');
            if (!printWindow) {
                showToast('Popup blocked. Allow popups to open thermal receipt.', 'error');
            }
            return;
        }

        const deleteBtn = event.target.closest('.payment-history-delete');
        if (!deleteBtn) return;
        const accountNumber = String(deleteBtn.dataset.accountNumber || '').trim();
        const entryId = String(deleteBtn.dataset.entryId || '').trim();
        const row = state.allRows.find((item) => item.accountNumber === accountNumber && item.entryId === entryId);
        if (!row) {
            showToast('Payment entry was not found in the current list.', 'error');
            return;
        }
        deleteBtn.disabled = true;
        deleteBtn.setAttribute('aria-busy', 'true');
        try {
            const deleted = await deletePayment(row);
            if (!deleted && deleteBtn.isConnected) {
                deleteBtn.disabled = false;
                deleteBtn.removeAttribute('aria-busy');
            }
        } catch (error) {
            showToast(error.message || 'Failed to delete payment entry.', 'error');
            deleteBtn.disabled = false;
            deleteBtn.removeAttribute('aria-busy');
        }
    });
    prevBtn?.addEventListener('click', () => {
        if (state.page <= 1) return;
        state.page -= 1;
        renderTable();
    });
    nextBtn?.addEventListener('click', () => {
        const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
        if (state.page >= totalPages) return;
        state.page += 1;
        renderTable();
    });

    loadHistory();
});
