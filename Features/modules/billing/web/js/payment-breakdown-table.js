(function attachPaymentBreakdownTable(global) {
    'use strict';

    const locale = 'en-PH';
    const appTimeZone = global.__APP_TIMEZONE__ || 'Asia/Manila';
    const EPSILON = 0.005;
    const dateFormatter = new Intl.DateTimeFormat(locale, {
        timeZone: appTimeZone,
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
    const monthFormatter = new Intl.DateTimeFormat(locale, {
        timeZone: appTimeZone,
        month: 'short',
        year: 'numeric'
    });
    const currencyFormatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const classToken = (value, fallback = '') => {
        const token = String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
        return token || fallback;
    };

    const safeDate = (value) => {
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
        const raw = String(value ?? '').trim();
        if (!raw) return null;
        const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dateOnly) {
            return new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12));
        }
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const formatDate = (value, fallback = '-') => {
        const parsed = safeDate(value);
        return parsed ? dateFormatter.format(parsed) : fallback;
    };

    const formatMonth = (value, fallback = 'Bill') => {
        const parsed = safeDate(value);
        return parsed ? monthFormatter.format(parsed) : fallback;
    };

    const formatCurrency = (value) => currencyFormatter.format(Number(value) || 0);
    const formatCurrencyNoCents = (value) => `₱${(Number(value) || 0).toLocaleString(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    })}`;

    const formatBalance = (value) => {
        const amount = Number(value) || 0;
        return amount < -EPSILON
            ? `${formatCurrency(Math.abs(amount))} advance`
            : formatCurrency(Math.max(0, amount));
    };

    const toTitleCase = (value) => String(value || '')
        .trim()
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());

    const resolvePlanType = (record = {}, row = {}) => {
        const raw = String(row.planType || record.planCategory || record.planType || record.category || '').trim().toLowerCase();
        return raw === 'prepaid' ? 'prepaid' : 'postpaid';
    };

    const resolveBillingCycle = (record = {}, row = {}) => {
        const explicit = String(row.billingCycle || record.billingCycle || record.billing_cycle || '').trim();
        if (explicit) return explicit;
        return resolvePlanType(record, row) === 'prepaid'
            ? 'Every 1st of the month'
            : 'Every last day of the month';
    };

    const createDisplayRows = (record = {}, rawRows = []) => (Array.isArray(rawRows) ? rawRows : []).map((rawRow) => {
        const row = rawRow && typeof rawRow === 'object' ? rawRow : {};
        const planType = resolvePlanType(record, row);
        const planLabel = String(row.planLabel || record.planName || record.plan || 'Monthly plan').trim() || 'Monthly plan';
        const planAmount = Number(row.planAmount ?? record.planAmount ?? record.monthlyAmount ?? record.amount) || 0;
        const sourceType = String(row.sourceType || 'monthly').trim().toLowerCase();
        const sourceLabel = sourceType === 'posted' ? 'posted bill' : 'canonical billing record';
        const billLabel = String(row.billLabel || '').trim()
            || (row.openingPreviousBalance
                ? 'Previous Balance'
                : (row.openingAdvance ? 'Opening Advance' : formatMonth(row.billDate, 'Bill')));
        const billMeta = String(row.billMeta || '').trim()
            || [planLabel, formatCurrency(planAmount), sourceLabel].filter(Boolean).join(' · ');
        const paymentDetails = (Array.isArray(row.paymentDetails) ? row.paymentDetails : []).map((detail) => ({
            ...(detail && typeof detail === 'object' ? detail : {}),
            dateLabel: String(detail?.dateLabel || '').trim() || formatDate(detail?.date)
        }));

        return {
            ...row,
            billLabel,
            billMeta,
            planType,
            planTypeLabel: String(row.planTypeLabel || '').trim() || toTitleCase(planType),
            planLabel,
            planAmount,
            billingCycle: resolveBillingCycle(record, row),
            paymentDetails,
            paymentMode: String(row.paymentMode || '-').trim() || '-',
            paymentDateLabel: String(row.paymentDateLabel || '').trim() || '-',
            paymentStatus: classToken(row.paymentStatus, 'unpaid'),
            paymentStatusLabel: String(row.paymentStatusLabel || row.paymentStatus || 'unpaid').trim(),
            sourceType
        };
    });

    const getAmountClass = (value) => ((Number(value) || 0) > EPSILON ? 'is-debit' : 'is-even');
    const getCreditClass = (value) => ((Number(value) || 0) > EPSILON ? 'is-credit' : 'is-even');
    const getBalanceClass = (value) => {
        const amount = Number(value) || 0;
        if (amount > EPSILON) return 'is-debit';
        if (amount < -EPSILON) return 'is-credit';
        return 'is-even';
    };

    const renderBillCell = (row) => `
        <span class="breakdown-bill">
            <span class="breakdown-bill__title">${escapeHtml(row.billLabel)}</span>
            <span class="breakdown-bill__meta">${escapeHtml(row.billMeta)}</span>
        </span>
    `;

    const renderReferralCell = (row, options) => {
        const details = Array.isArray(row.referralDetails) ? row.referralDetails : [];
        const labels = details
            .map((item) => {
                const name = String(item?.referredName || item?.referredAccountNumber || '').trim();
                const amount = Number(item?.amount) || 0;
                if (!name) return '';
                return amount > EPSILON ? `${name} - ${options.formatCurrency(amount)}` : name;
            })
            .filter(Boolean);
        const detailLabel = labels.length
            ? labels.slice(0, 2).join(', ') + (labels.length > 2 ? ` +${labels.length - 2}` : '')
            : '';
        const detailTitle = details
            .map((item) => {
                const name = String(item?.referredName || item?.referredAccountNumber || 'Referral').trim();
                const amount = Number(item?.amount) || 0;
                return amount > EPSILON ? `${name}: ${options.formatCurrency(amount)}` : name;
            })
            .join(', ');
        const editButton = options.editableReferrals && row.isReferralAdjustmentEditable
            ? `
                <button
                    type="button"
                    class="btn btn-icon btn-sm btn-outline-primary breakdown-referral-edit"
                    data-action="edit-referral"
                    data-month-key="${escapeHtml(row.billingMonthKey || '')}"
                    title="Edit referral for ${escapeHtml(row.billLabel || 'month')}"
                    aria-label="Edit referral for ${escapeHtml(row.billLabel || 'month')}"
                >
                    <i class="ti ti-user-dollar" aria-hidden="true"></i>
                </button>
            `
            : '';
        return `
            <span class="breakdown-referral-cell">
                <span class="breakdown-amount ${getCreditClass(row.referral)}">${options.formatCurrency(row.referral)}</span>
                ${detailLabel ? `<span class="breakdown-referral-note" title="${escapeHtml(detailTitle)}">${escapeHtml(detailLabel)}</span>` : ''}
                ${editButton}
            </span>
        `;
    };

    const renderPaymentAmountCell = (row, options) => {
        const details = Array.isArray(row.paymentDetails) ? row.paymentDetails : [];
        if (!details.length) {
            return `<span class="breakdown-amount ${getCreditClass(row.amountPaid)}">${options.formatCurrency(row.amountPaid)}</span>`;
        }
        return `
            <span class="breakdown-payment-stack">
                ${details.map((detail) => `
                    <span class="breakdown-payment-line">
                        <span class="breakdown-amount ${getCreditClass(detail.amount)}">${options.formatCurrency(detail.amount)}</span>
                    </span>
                `).join('')}
            </span>
        `;
    };

    const renderPaymentModeCell = (row) => {
        const details = Array.isArray(row.paymentDetails) ? row.paymentDetails : [];
        if (!details.length) return `<span class="breakdown-mode">${escapeHtml(row.paymentMode || '-')}</span>`;
        return `
            <span class="breakdown-payment-stack">
                ${details.map((detail) => `
                    <span class="breakdown-payment-line"><span class="breakdown-mode">${escapeHtml(detail.mode || '-')}</span></span>
                `).join('')}
            </span>
        `;
    };

    const renderPaymentDateCell = (row) => {
        const details = Array.isArray(row.paymentDetails) ? row.paymentDetails : [];
        if (!details.length) return `<span class="breakdown-date">${escapeHtml(row.paymentDateLabel || '-')}</span>`;
        return `
            <span class="breakdown-payment-stack">
                ${details.map((detail) => `
                    <span class="breakdown-payment-line"><span class="breakdown-date">${escapeHtml(detail.dateLabel || '-')}</span></span>
                `).join('')}
            </span>
        `;
    };

    const renderEmpty = (tbody, message = 'No payment breakdown rows available.') => {
        if (!tbody) return;
        tbody.innerHTML = `
            <tr class="payment-breakdown-empty-row">
                <td colspan="12" class="payment-breakdown-empty-cell">
                    <span class="payment-breakdown-empty-message">${escapeHtml(message)}</span>
                </td>
            </tr>
        `;
    };

    const render = ({
        tbody,
        rows = [],
        editableReferrals = false,
        formatCurrency: currency = formatCurrency,
        formatCurrencyNoCents: currencyNoCents = formatCurrencyNoCents,
        formatBalance: balance = formatBalance
    } = {}) => {
        if (!tbody) return { rowCount: 0 };
        const displayRows = Array.isArray(rows) ? rows : [];
        if (!displayRows.length) {
            renderEmpty(tbody);
            return { rowCount: 0 };
        }
        const options = {
            editableReferrals: Boolean(editableReferrals),
            formatCurrency: currency
        };
        tbody.innerHTML = displayRows.map((row) => {
            const formatRowBillAmount = row.isProrated ? currencyNoCents : currency;
            const previousBalanceCell = `<span class="breakdown-amount ${getAmountClass(row.previousBalance)}">${currency(row.previousBalance)}</span>`;
            const advanceCell = `<span class="breakdown-amount ${getCreditClass(row.advance)}">${currency(row.advance)}</span>`;
            const rowClasses = [
                row.isAdjustmentEditable ? 'is-first-adjustment-row' : '',
                row.isMonthlyReferralOverride ? 'is-referral-adjustment-row' : '',
                row.isDisconnected ? 'is-disconnected-row' : ''
            ].filter(Boolean).join(' ');
            const statusToken = classToken(row.paymentStatus, 'unpaid');
            const statusCell = row.isDisconnected
                ? `<span class="breakdown-status is-disconnected">disconnected</span><span class="breakdown-status-note">${escapeHtml(row.disconnectionBillingPolicyLabel || '')}</span>`
                : `<span class="breakdown-status is-${statusToken}">${escapeHtml(row.paymentStatusLabel || row.paymentStatus)}</span>`;
            return `
                <tr${rowClasses ? ` class="${rowClasses}"` : ''}>
                    <td>${renderBillCell(row)}</td>
                    <td><span class="breakdown-type is-${classToken(row.planType, 'postpaid')}">${escapeHtml(row.planTypeLabel || 'Postpaid')}</span></td>
                    <td><span class="breakdown-cycle">${escapeHtml(row.billingCycle || '-')}</span></td>
                    <td class="is-num">${previousBalanceCell}</td>
                    <td class="is-num">${advanceCell}</td>
                    <td class="is-num">${renderReferralCell(row, options)}</td>
                    <td class="is-num"><span class="breakdown-amount ${getAmountClass(row.due)}">${formatRowBillAmount(row.due)}</span></td>
                    <td class="is-num">${renderPaymentAmountCell(row, options)}</td>
                    <td>${renderPaymentModeCell(row)}</td>
                    <td>${renderPaymentDateCell(row)}</td>
                    <td>${statusCell}</td>
                    <td class="is-num"><span class="breakdown-amount ${getBalanceClass(row.balanceAfterPayment)}">${escapeHtml(balance(row.balanceAfterPayment))}</span></td>
                </tr>
            `;
        }).join('');
        return { rowCount: displayRows.length };
    };

    global.PaymentBreakdownTable = Object.freeze({
        createDisplayRows,
        escapeHtml,
        formatBalance,
        formatCurrency,
        formatDate,
        formatMonth,
        render,
        renderEmpty
    });
})(window);
