document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('expensesTableBody');
    const tableTotalEl = document.getElementById('expensesTableTotal');
    const historyList = document.getElementById('expensesHistoryList');
    const searchInput = document.getElementById('expensesSearch');
    const addBtn = document.getElementById('addExpenseBtn');

    const modal = document.getElementById('expenseModal');
    const modalTitle = document.getElementById('expenseModalTitle');
    const closeModalBtn = document.getElementById('expenseModalClose');
    const cancelModalBtn = document.getElementById('expenseModalCancel');
    const form = document.getElementById('expenseForm');

    const historyModal = document.getElementById('expenseHistoryModal');
    const historyModalTitle = document.getElementById('expenseHistoryModalTitle');
    const historyModalMeta = document.getElementById('expenseHistoryModalMeta');
    const historyModalBody = document.getElementById('expenseHistoryModalBody');
    const historyModalCloseBtn = document.getElementById('expenseHistoryModalClose');
    const historyModalDoneBtn = document.getElementById('expenseHistoryModalDone');

    const entryIdInput = document.getElementById('expenseEntryId');
    const dateInput = document.getElementById('expenseDate');
    const categoryInput = document.getElementById('expenseCategory');
    const payeeInput = document.getElementById('expensePayee');
    const amountInput = document.getElementById('expenseAmount');
    const descriptionInput = document.getElementById('expenseDescription');

    const state = {
        items: [],
        filtered: []
    };
    const historyGroupsByKey = new Map();

    const pesoFormatter = new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    const escapeHtml = (value) =>
        String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    const formatCurrency = (value) => pesoFormatter.format(Number(value) || 0);

    const formatDate = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return 'N/A';
        const parsed = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
        if (Number.isNaN(parsed.getTime())) return raw;
        return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const parseDateValue = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const parsed = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const monthKeyFromDate = (dateObj) =>
        `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

    const monthLabelFromDate = (dateObj) =>
        dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const sumExpenseAmounts = (items = []) =>
        items.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0);

    const setTableTotal = (totalAmount) => {
        if (!tableTotalEl) return;
        tableTotalEl.textContent = formatCurrency(totalAmount);
    };

    const notify = (message, type = 'info') => {
        if (typeof window.appToast === 'function') {
            window.appToast(message, { type });
            return;
        }
        window.alert(message);
    };

    const requestJson = async (url, options = {}) => {
        const response = await fetch(url, {
            credentials: 'include',
            ...options
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const errorMessage = payload?.error || payload?.message || `Request failed (${response.status})`;
            throw new Error(errorMessage);
        }
        return payload;
    };

    const closeHistoryModal = () => {
        if (!historyModal) return;
        historyModal.classList.remove('show');
        historyModal.setAttribute('aria-hidden', 'true');
    };

    const openHistoryModal = (group) => {
        if (!historyModal || !group) return;

        const monthItems = Array.isArray(group.items) ? group.items.slice() : [];
        monthItems.sort((left, right) => {
            const leftTs = parseDateValue(left?.date)?.getTime() || 0;
            const rightTs = parseDateValue(right?.date)?.getTime() || 0;
            return rightTs - leftTs;
        });

        const countLabel = `${monthItems.length} ${monthItems.length === 1 ? 'entry' : 'entries'}`;
        const rowsHtml = monthItems.map((item) => `
            <tr>
                <td>${escapeHtml(formatDate(item.date))}</td>
                <td>${escapeHtml(item.category || '-')}</td>
                <td>${escapeHtml(item.payee || '-')}</td>
                <td>${escapeHtml(item.description || '-')}</td>
                <td class="amount">${escapeHtml(formatCurrency(item.amount))}</td>
            </tr>
        `).join('');

        if (historyModalTitle) {
            historyModalTitle.textContent = `${group.label} Expenses`;
        }
        if (historyModalMeta) {
            historyModalMeta.textContent = `${countLabel} · Total ${formatCurrency(group.total)}`;
        }
        if (historyModalBody) {
            historyModalBody.innerHTML = `
                <div class="table-wrapper">
                    <table class="finance-table finance-table--history" aria-label="${escapeHtml(group.label)} expenses">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Category</th>
                                <th>Payee</th>
                                <th>Description</th>
                                <th>Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                        <tfoot>
                            <tr>
                                <th colspan="4" class="finance-total-label">Total for ${escapeHtml(group.label)}</th>
                                <th class="amount">${escapeHtml(formatCurrency(group.total))}</th>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;
        }
        historyModal.classList.add('show');
        historyModal.setAttribute('aria-hidden', 'false');
    };

    const renderHistory = () => {
        if (!historyList) return;

        historyGroupsByKey.clear();
        const monthly = new Map();
        state.items.forEach((item) => {
            const parsedDate = parseDateValue(item?.date);
            const key = parsedDate ? monthKeyFromDate(parsedDate) : 'undated';
            const label = parsedDate ? monthLabelFromDate(parsedDate) : 'Undated';
            const sortWeight = parsedDate
                ? Number(`${parsedDate.getFullYear()}${String(parsedDate.getMonth() + 1).padStart(2, '0')}`)
                : 0;
            const existing = monthly.get(key) || {
                key,
                label,
                sortWeight,
                items: [],
                total: 0
            };
            existing.items.push(item);
            existing.total += Number(item?.amount) || 0;
            monthly.set(key, existing);
        });

        const groups = Array.from(monthly.values()).sort((left, right) => right.sortWeight - left.sortWeight);

        if (!groups.length) {
            historyList.innerHTML = '<p class="finance-empty">No expense history yet.</p>';
            return;
        }

        historyList.innerHTML = groups.map((group) => {
            const count = Array.isArray(group.items) ? group.items.length : 0;
            const countLabel = `${count} ${count === 1 ? 'entry' : 'entries'}`;
            historyGroupsByKey.set(group.key, group);
            return `
                <button type="button" class="expense-history-month" data-month-key="${escapeHtml(group.key)}" aria-label="View ${escapeHtml(group.label)} expenses">
                    <span class="expense-history-month-label">${escapeHtml(group.label)}</span>
                    <span class="expense-history-month-meta">${escapeHtml(countLabel)}</span>
                    <span class="expense-history-month-total">${escapeHtml(formatCurrency(group.total))}</span>
                    <span class="expense-history-month-icon"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></span>
                </button>
            `;
        }).join('');
    };

    const renderTable = () => {
        if (!state.filtered.length) {
            setTableTotal(0);
            tableBody.innerHTML = '<tr><td colspan="6" class="finance-empty">No expense entries found for this month.</td></tr>';
            return;
        }

        setTableTotal(sumExpenseAmounts(state.filtered));
        tableBody.innerHTML = state.filtered.map((item) => {
            return `
                <tr>
                    <td>${escapeHtml(formatDate(item.date))}</td>
                    <td>${escapeHtml(item.category || '')}</td>
                    <td>${escapeHtml(item.payee || '-')}</td>
                    <td>${escapeHtml(item.description || '-')}</td>
                    <td class="amount">${escapeHtml(formatCurrency(item.amount))}</td>
                    <td class="text-center">
                        <div class="finance-actions">
                            <button type="button" class="ghost-icon" data-action="edit" data-id="${escapeHtml(item.id)}" title="Edit" aria-label="Edit expense">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button type="button" class="ghost-icon danger" data-action="delete" data-id="${escapeHtml(item.id)}" title="Delete" aria-label="Delete expense">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    };

    const applyFilters = () => {
        const query = String(searchInput?.value || '').trim().toLowerCase();
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        const filtered = state.items.filter((item) => {
            const parsedDate = parseDateValue(item?.date);
            if (!parsedDate) return false;
            if (parsedDate.getMonth() !== currentMonth || parsedDate.getFullYear() !== currentYear) {
                return false;
            }

            if (!query) return true;
            const amountText = String(Number(item.amount || 0).toFixed(2));
            const haystack = [
                item.date,
                item.category,
                item.payee,
                item.description,
                amountText
            ].join(' ').toLowerCase();
            return haystack.includes(query);
        });

        state.filtered = filtered.sort((left, right) => {
            const leftTs = new Date(String(left?.date || '').trim() + 'T00:00:00').getTime();
            const rightTs = new Date(String(right?.date || '').trim() + 'T00:00:00').getTime();
            return rightTs - leftTs;
        });
        renderTable();
    };

    const closeModal = () => {
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        form.reset();
        entryIdInput.value = '';
    };

    const openModal = (entry = null) => {
        const todayIso = new Date().toISOString().slice(0, 10);
        if (!entry) {
            modalTitle.textContent = 'Add Expense';
            form.reset();
            entryIdInput.value = '';
            dateInput.value = todayIso;
        } else {
            modalTitle.textContent = 'Edit Expense';
            entryIdInput.value = entry.id || '';
            dateInput.value = String(entry.date || '').slice(0, 10);
            categoryInput.value = entry.category || '';
            payeeInput.value = entry.payee || '';
            amountInput.value = Number(entry.amount || 0).toFixed(2);
            descriptionInput.value = entry.description || '';
        }
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        categoryInput.focus();
    };

    const loadExpenses = async () => {
        const payload = await requestJson('/api/expenses');
        state.items = Array.isArray(payload?.items) ? payload.items : [];
        renderHistory();
        applyFilters();
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        const entryId = String(entryIdInput.value || '').trim();

        const payload = {
            date: dateInput.value,
            category: categoryInput.value,
            payee: payeeInput.value,
            amount: Number(amountInput.value),
            description: descriptionInput.value
        };

        if (!payload.date || !payload.category || !Number.isFinite(payload.amount)) {
            notify('Please complete the required fields.', 'warning');
            return;
        }

        if (entryId) {
            await requestJson(`/api/expenses/${encodeURIComponent(entryId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            notify('Expense updated.', 'success');
        } else {
            await requestJson('/api/expenses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            notify('Expense added.', 'success');
        }
        closeModal();
        await loadExpenses();
    };

    const handleTableAction = async (event) => {
        const actionBtn = event.target.closest('button[data-action]');
        if (!actionBtn) return;
        const action = actionBtn.dataset.action;
        const entryId = String(actionBtn.dataset.id || '').trim();
        if (!entryId) return;

        const entry = state.items.find((item) => String(item?.id || '') === entryId);
        if (!entry) return;

        if (action === 'edit') {
            openModal(entry);
            return;
        }

        if (action === 'delete') {
            const confirmed = window.appConfirm
                ? await window.appConfirm('Delete this expense entry?', { title: 'Delete Expense' })
                : window.confirm('Delete this expense entry?');
            if (!confirmed) return;

            await requestJson(`/api/expenses/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
            notify('Expense deleted.', 'success');
            await loadExpenses();
        }
    };

    addBtn?.addEventListener('click', () => openModal());
    closeModalBtn?.addEventListener('click', closeModal);
    cancelModalBtn?.addEventListener('click', closeModal);
    historyModalCloseBtn?.addEventListener('click', closeHistoryModal);
    historyModalDoneBtn?.addEventListener('click', closeHistoryModal);
    modal?.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });
    historyModal?.addEventListener('click', (event) => {
        if (event.target === historyModal) closeHistoryModal();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (historyModal?.classList.contains('show')) {
            closeHistoryModal();
            return;
        }
        if (modal.classList.contains('show')) {
            closeModal();
        }
    });

    form?.addEventListener('submit', async (event) => {
        try {
            await handleSubmit(event);
        } catch (error) {
            notify(error.message || 'Unable to save expense.', 'error');
        }
    });

    tableBody?.addEventListener('click', async (event) => {
        try {
            await handleTableAction(event);
        } catch (error) {
            notify(error.message || 'Unable to process action.', 'error');
        }
    });
    historyList?.addEventListener('click', (event) => {
        const monthBtn = event.target.closest('button[data-month-key]');
        if (!monthBtn) return;
        const key = String(monthBtn.dataset.monthKey || '').trim();
        if (!key) return;
        const group = historyGroupsByKey.get(key);
        if (!group) return;
        openHistoryModal(group);
    });

    searchInput?.addEventListener('input', applyFilters);

    loadExpenses().catch((error) => {
        notify(error.message || 'Unable to load expenses.', 'error');
        setTableTotal(0);
        tableBody.innerHTML = '<tr><td colspan="6" class="finance-empty">Unable to load expenses.</td></tr>';
        if (historyList) {
            historyList.innerHTML = '<p class="finance-empty">Unable to load expense history.</p>';
        }
    });
});
