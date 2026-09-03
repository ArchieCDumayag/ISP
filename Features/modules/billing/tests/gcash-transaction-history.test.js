const assert = require('assert');
const fs = require('fs');
const path = require('path');
const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const manilaParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
}).formatToParts(new Date());
const manilaDateValues = Object.fromEntries(manilaParts.map((part) => [part.type, part.value]));
const currentPostingDate = `${manilaDateValues.year}-${manilaDateValues.month}-${manilaDateValues.day}`;
const currentBillingMonth = currentPostingDate.slice(0, 7);
const officialTransactionAt = '2026-08-08T17:45:00+08:00';
const {
    parseGcashTextPages
} = require('../backend/gcash-pdf-parser');
const {
    calculatePaymentBreakdownEndingBalance
} = require('../backend/payment-breakdown-balance');

let historyStoreMemory = { version: 2, branches: {} };
let paymentStoreMemory = {};
const dataStoreModulePath = require.resolve(path.join(projectRoot, 'core/data/data-store'));
require.cache[dataStoreModulePath] = {
    id: dataStoreModulePath,
    filename: dataStoreModulePath,
    loaded: true,
    exports: {
        readJson: async (key, fallback) => {
            if (key === 'gcash_transaction_history') return historyStoreMemory;
            if (key === 'payments') return paymentStoreMemory;
            return fallback;
        },
        writeJson: async (key, value) => {
            if (key === 'gcash_transaction_history') historyStoreMemory = value;
            if (key === 'payments') paymentStoreMemory = value;
        }
    }
};
const {
    evaluateGcashTransactionMatch,
    phoneMatches,
    importGcashTransactionBatch,
    reservePendingGcashReference,
    releasePendingGcashReference,
    claimGcashTransaction,
    claimGcashTransactionAllocations,
    finalizeGcashTransactionAssignment,
    finalizeGcashTransactionAllocations,
    releaseGcashTransactionClaim,
    updateGcashTransactionRemark,
    lockGcashTransactionPosting,
    unlockGcashTransactionPosting,
    listGcashTransactionHistory,
    getGcashTransactionHistoryStatus,
    getGcashRecipientLabel,
    GCASH_TRANSACTION_REMARKS
} = require('../backend/gcash-transaction-history-store');

const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
const fixtureItems = [
    item('GCash Transaction History', 184, 796),
    item('2026-08-03 to 2026-08-09', 247, 770),
    item('Date and Time', 50, 749),
    item('Description', 183, 749),
    item('Reference No.', 285, 749),
    item('Debit', 371, 749),
    item('Credit', 420, 749),
    item('Balance', 468, 749),
    item('2026-08-08 05:45 PM', 50, 684),
    item('Transfer from 09111111111 to 09999999999', 126, 684),
    item('1043753606767', 273, 684),
    item('1000.00', 417, 684),
    item('17311.82', 465, 684),
    item('2026-08-07 03:15 PM', 50, 640),
    item('Pay Bills', 126, 640),
    item('1043753606701', 273, 640),
    item('250.00', 371, 640),
    item('17061.82', 465, 640)
];

const parsed = parseGcashTextPages([{ items: fixtureItems }]);
assert.strictEqual(parsed.title, 'GCash Transaction History');
assert.strictEqual(parsed.statementFrom, '2026-08-03');
assert.strictEqual(parsed.statementTo, '2026-08-09');
assert.strictEqual(parsed.transactions.length, 2);
assert.deepStrictEqual(parsed.transactions[0], {
    reference: '1043753606767',
    transactionAt: '2026-08-08 17:45:00',
    transactionDate: '2026-08-08',
    description: 'Transfer from 09111111111 to 09999999999',
    sender: '09111111111',
    recipient: '09999999999',
    debit: null,
    credit: 1000,
    balance: 17311.82,
    status: 'received',
    pageNumber: 1
});
assert.deepStrictEqual(parsed.transactions[1], {
    reference: '1043753606701',
    transactionAt: '2026-08-07 15:15:00',
    transactionDate: '2026-08-07',
    description: 'Pay Bills',
    sender: '',
    recipient: '',
    debit: 250,
    credit: null,
    balance: 17061.82,
    status: 'debit',
    pageNumber: 1
});

const transaction = parsed.transactions[0];
const exactMatch = evaluateGcashTransactionMatch({
    transactions: [transaction],
    reference: '1043753606767',
    amount: 1000,
    paymentDate: '2026-08-08T18:02',
    merchantNumber: '+63 999 999 9999',
    customerPhone: '09111111111'
});
assert.strictEqual(exactMatch.matched, true);
assert.strictEqual(exactMatch.status, 'matched');
assert.strictEqual(phoneMatches('09999999999', '+639999999999'), true);
assert.strictEqual(getGcashRecipientLabel('0936 156 5251'), 'Gcash - Archie');
assert.strictEqual(getGcashRecipientLabel('+63 965 140 4623'), 'Gcash - Frances');
assert.strictEqual(getGcashRecipientLabel('09999999999'), '');
assert.strictEqual(GCASH_TRANSACTION_REMARKS.expense_unclassified, 'Expense — Unclassified');

assert.strictEqual(evaluateGcashTransactionMatch({
    transactions: [transaction],
    reference: '1043753606767',
    amount: 100,
    paymentDate: '2026-08-08',
    merchantNumber: '09999999999'
}).status, 'amount_mismatch');
assert.strictEqual(evaluateGcashTransactionMatch({
    transactions: [transaction],
    reference: '1043753606767',
    amount: 1000,
    paymentDate: '2026-08-09',
    merchantNumber: '09999999999'
}).status, 'date_mismatch');
assert.strictEqual(evaluateGcashTransactionMatch({
    transactions: [transaction],
    reference: '1043753606767',
    amount: 1000,
    paymentDate: '2026-08-08',
    merchantNumber: '09888888888'
}).status, 'recipient_mismatch');
assert.strictEqual(evaluateGcashTransactionMatch({
    transactions: [transaction],
    reference: '9999999999999',
    amount: 1000,
    paymentDate: '2026-08-08',
    merchantNumber: '09999999999'
}).status, 'reference_not_found');

const assignedTransaction = {
    ...transaction,
    assignment: {
        status: 'posted',
        submissionId: 'pcq-original',
        accountNumber: 'ACC-1001',
        customerName: 'Correct Customer',
        amount: 1000,
        paymentDate: '2026-08-08',
        paymentEntryId: 'proof-pcq-original'
    }
};
const wrongCustomerMatch = evaluateGcashTransactionMatch({
    transactions: [assignedTransaction],
    reference: '1043753606767',
    amount: 1000,
    paymentDate: '2026-08-08',
    merchantNumber: '09999999999',
    customerPhone: '09222222222',
    accountNumber: 'ACC-2002',
    submissionId: 'pcq-reused'
});
assert.strictEqual(wrongCustomerMatch.matched, false);
assert.strictEqual(wrongCustomerMatch.status, 'already_assigned');
assert.strictEqual(wrongCustomerMatch.transaction.assignment.accountNumber, 'ACC-1001');

const sameAllocationMatch = evaluateGcashTransactionMatch({
    transactions: [assignedTransaction],
    reference: '1043753606767',
    amount: 1000,
    paymentDate: '2026-08-08',
    merchantNumber: '09999999999',
    customerPhone: '09111111111',
    accountNumber: 'ACC-1001',
    submissionId: 'pcq-original'
});
assert.strictEqual(sameAllocationMatch.matched, true);
assert.strictEqual(sameAllocationMatch.status, 'matched');

const payerMismatch = evaluateGcashTransactionMatch({
    transactions: [transaction],
    reference: '1043753606767',
    amount: 1000,
    paymentDate: '2026-08-08',
    merchantNumber: '09999999999',
    customerPhone: '09222222222',
    accountNumber: 'ACC-2002',
    submissionId: 'pcq-new'
});
assert.strictEqual(payerMismatch.matched, true);
assert.strictEqual(payerMismatch.status, 'matched_payer_mismatch');
assert.strictEqual(payerMismatch.checks.payer, false);

const routeSource = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/billing/backend/payment-confirmations.js'),
    'utf8'
);
const htmlSource = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/billing/web/gcash-transaction.html'),
    'utf8'
);
const browserSource = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/billing/web/payment-confirmation-queue.js'),
    'utf8'
);
const cssSource = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/billing/web/css/payment-confirmation-queue.css'),
    'utf8'
);
const paymentsSource = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/billing/backend/payments.js'),
    'utf8'
);
assert(routeSource.includes("'/gcash-history/import'"));
assert(routeSource.includes("'/gcash-history/:reference/post-payment'"));
assert(routeSource.includes("'/gcash-history/:reference/remark'"));
assert(routeSource.includes("'/gcash-history/:reference/lock-posting'"));
assert(routeSource.includes("'/gcash-history/:reference/unlock-posting'"));
const dashboardStatusRouteStart = routeSource.indexOf("router.get('/gcash-history/status'");
const fullHistoryRouteStart = routeSource.indexOf("router.get('/gcash-history',", dashboardStatusRouteStart + 1);
assert(dashboardStatusRouteStart >= 0);
assert(fullHistoryRouteStart > dashboardStatusRouteStart);
const dashboardStatusRouteSource = routeSource.slice(dashboardStatusRouteStart, fullHistoryRouteStart);
assert(dashboardStatusRouteSource.includes('getGcashTransactionHistoryStatus'));
assert(dashboardStatusRouteSource.includes('latestBatch'));
assert(dashboardStatusRouteSource.includes('pendingReservationCount'));
assert(!dashboardStatusRouteSource.includes('reconcileExistingPaymentHistoryWithGcashTransactions'));
assert(routeSource.includes("code = 'GCASH_TRANSACTION_POSTING_LOCKED'"));
assert(routeSource.includes("code: 'GCASH_IMPORTED_AMOUNT_MISMATCH'"));
assert(routeSource.includes("code: 'GCASH_ALLOCATION_TOTAL_MISMATCH'"));
assert(routeSource.includes('claimGcashTransactionAllocations'));
assert(routeSource.includes('finalizeGcashTransactionAllocations'));
assert(routeSource.includes("code: 'GCASH_CURRENT_BILLING_CYCLE_UNAVAILABLE'"));
assert(routeSource.includes("code: 'GCASH_ADVANCE_CONFIRMATION_REQUIRED'"));
assert(!routeSource.includes("code: 'GCASH_ALLOCATION_EXCEEDS_ENDING_BALANCE'"));
assert(routeSource.includes('const balanceApplied = Number(Math.min(allocation.amount, positiveEndingBalance).toFixed(2))'));
assert(routeSource.includes('const advanceAmount = Number(Math.max(0, allocation.amount - balanceApplied).toFixed(2))'));
assert(routeSource.includes('Imported GCash advance payment allocation'));
assert(routeSource.includes('recorded as advance credit'));
assert(routeSource.includes('date: officialPaymentDate'));
assert(routeSource.includes('paymentReceivedAt: officialTransactionAt'));
assert(routeSource.includes("code = 'GCASH_TRANSACTION_TIMESTAMP_REQUIRED'"));
assert(routeSource.includes('buildPaymentRecordForAccount'));
assert(routeSource.includes("code: 'GCASH_HISTORY_MATCH_REQUIRED'"));
assert(routeSource.includes('gcashApproval && !gcashMatch?.matched'));
assert(routeSource.includes('claimGcashTransaction'));
assert(routeSource.includes('finalizeGcashTransactionAssignment'));
assert(routeSource.includes("code: 'PAYMENT_ASSIGNMENT_CONFIRMATION_REQUIRED'"));
assert(routeSource.includes("code: 'GCASH_SCREENSHOT_CONFLICT'"));
assert(routeSource.includes('assertLockedGcashApproval'));
assert(routeSource.includes('existing reference(s) skipped'));
assert(routeSource.includes('reconcileExistingPaymentHistoryWithGcashTransactions'));
assert(routeSource.includes('paymentHistoryMatch'));
assert(routeSource.includes('automaticReconciliation'));
assert(routeSource.includes('month: req.query?.month'));
assert(routeSource.includes("all: Boolean(String(req.query?.month || '').trim())"));
assert(!routeSource.includes('/gcash-gmail/'));
assert(!routeSource.includes('gcash-notification-bridge-store'));
assert(htmlSource.includes('id="queueImportGcashHistoryBtn"'));
assert(htmlSource.includes('never approves a payment automatically'));
assert(htmlSource.includes('id="queueGcashHistoryBody"'));
assert(htmlSource.includes('Imported GCash Transactions'));
assert(htmlSource.includes('<title>GCash Transactions'));
assert(htmlSource.includes('<h1>GCash Transactions</h1>'));
assert(htmlSource.includes('Import statements, bind credits, classify debits, or retain credits as not for posting.'));
assert(!htmlSource.includes('Admin verification is required'));
assert(!htmlSource.includes('Imported rows never post automatically.'));
assert(htmlSource.includes('class="card gcash-history-panel"'));
assert(htmlSource.includes('table table-vcenter table-hover card-table'));
assert(htmlSource.includes('modal modal-blur tabler-form-modal queue-tabler-modal'));
assert(htmlSource.includes('type="search" id="queuePostGcashAccount"'));
assert(htmlSource.includes('data-gcash-account-search role="combobox"'));
assert(htmlSource.includes('aria-autocomplete="list"'));
assert(htmlSource.includes('data-gcash-account-suggestions role="listbox"'));
assert(htmlSource.includes('Type a client name or account number, then choose a suggestion.'));
assert(!htmlSource.includes('<select class="form-select" id="queuePostGcashAccount"'));
assert(htmlSource.includes('id="queuePostGcashModal"'));
assert(htmlSource.includes('Confirm &amp; Post Allocations'));
assert(htmlSource.includes('id="queuePostGcashAllocations"'));
assert(htmlSource.includes('id="queuePostGcashAddAllocationBtn"'));
assert(htmlSource.includes('id="queuePostGcashAllocationTotal"'));
assert(!htmlSource.includes('Current Billing Month'));
assert(!htmlSource.includes('data-gcash-allocation-month'));
assert(htmlSource.includes('Select a customer to review the amount due or advance payment.'));
assert(htmlSource.includes('Any amount above a current balance becomes confirmed advance credit.'));
assert(htmlSource.includes('id="queuePostGcashAdvanceConfirmationGroup"'));
assert(htmlSource.includes('id="queuePostGcashAdvanceConfirmed"'));
assert(htmlSource.includes('id="queuePostGcashAdvanceConfirmationText"'));
assert(htmlSource.includes('only the excess carries forward'));
assert(!htmlSource.includes('Open Billing Month'));
assert(htmlSource.includes('<th>Description</th>'));
assert(htmlSource.includes('<th>Amount</th>'));
assert(!htmlSource.includes('<th>Debit</th>'));
assert(!htmlSource.includes('<th>Credit</th>'));
assert(!htmlSource.includes('<th>Remark</th>'));
assert(htmlSource.includes('<th>Actions</th>'));
assert(htmlSource.includes('class="card card-sm queue-summary-bar"'));
assert(htmlSource.includes('id="queueGcashStatTotal"'));
assert(htmlSource.includes('id="queueGcashStatAvailable"'));
assert(htmlSource.includes('id="queueGcashStatPosted"'));
assert(htmlSource.includes('id="queueGcashStatRemarked"'));
assert(htmlSource.includes('id="queueGcashStatDebit"'));
assert(htmlSource.includes('class="btn btn-outline-secondary btn-sm" id="queueGcashHistoryRefreshBtn"'));
assert(htmlSource.includes('class="btn btn-primary btn-sm" id="queueImportGcashHistoryBtn"'));
assert(htmlSource.includes('id="queueGcashHistorySearch"'));
assert(!htmlSource.includes('id="queueGcashHistoryFilter"'));
assert(htmlSource.includes('id="queueGcashCreditUseTabs"'));
assert(htmlSource.includes('data-gcash-credit-use="available"'));
assert(htmlSource.includes('data-gcash-credit-use="used"'));
assert(htmlSource.includes('id="queueGcashAvailableCreditsCount"'));
assert(htmlSource.includes('id="queueGcashUsedCreditsCount"'));
assert(htmlSource.includes('Used credits are read-only.'));
assert(!htmlSource.includes('<option value="remarked">Not for Posting</option>'));
assert(!htmlSource.includes('<option value="debit">Debit records</option>'));
assert(htmlSource.includes('id="queueGcashHistoryMonth"'));
assert(htmlSource.includes('data-gcash-month-step="older"'));
assert(htmlSource.includes('data-gcash-month-step="newer"'));
assert(htmlSource.includes('data-gcash-history-type="credit"'));
assert(htmlSource.includes('data-gcash-history-type="debit"'));
assert(htmlSource.includes('data-gcash-history-type="remarked"'));
assert(htmlSource.includes('id="queueGcashNotForPostingCount"'));
assert(htmlSource.includes('Debits · Finance Review'));
assert(htmlSource.includes('no Finance expense is created yet'));
assert(htmlSource.includes('Unlock returns the transaction to Credits as Available without creating a payment.'));
assert(htmlSource.includes('id="queueLockGcashModal"'));
assert(htmlSource.includes('id="queueLockGcashRemark"'));
assert(htmlSource.includes('Remark &amp; Lock GCash Credit'));
assert(htmlSource.includes('id="queueBindPendingGcashCandidates"'));
assert(htmlSource.includes('id="queueBindPendingGcashMatchCount"'));
assert(htmlSource.includes('id="queueBindPendingGcashVerificationSummary"'));
assert(htmlSource.includes('id="queueBindPendingPaymentHeading">Pending Payment</h3>'));
assert(htmlSource.includes('id="queueBindPendingMatchesHeading">Official Matches</h3>'));
assert(htmlSource.includes('id="queueBindPendingVerificationHeading">Verification Summary</h3>'));
assert(htmlSource.includes('id="queueBindPendingConfirmationHeading">Confirmation</h3>'));
assert(htmlSource.includes('One official transaction updates one existing pending entry.'));
assert(htmlSource.includes('it does not create another payment'));
assert(htmlSource.includes('Compare the reference, time, sender, recipient, and description.'));
assert(htmlSource.includes('css/payment-confirmation-queue.css?v=4.11'));
assert(htmlSource.includes('payment-confirmation-queue.js?v=5.22'));
assert(htmlSource.includes('id="queueGcashVisibleCount"'));
assert(htmlSource.includes('<col class="gcash-col-description">'));
assert(htmlSource.includes('<col class="gcash-col-match">'));
assert(htmlSource.includes('<col class="gcash-col-actions">'));
assert(!htmlSource.includes('id="queueAccountFilter"'));
assert(!htmlSource.includes('id="queuePageSize"'));
assert(!htmlSource.includes('id="queueTableBody"'));
assert(!htmlSource.includes('id="queueTableFooter"'));
assert(htmlSource.includes('id="queueApproveAssignmentConfirmed"'));
assert(htmlSource.includes('permanently assigns the matched GCash transaction'));
assert(!htmlSource.includes('queueGmailPanel'));
assert(!htmlSource.includes('queueBridgePanel'));
assert(browserSource.includes("'X-PDF-Password': password"));
assert(browserSource.includes('Official match'));
assert(browserSource.includes("timeZone: 'Asia/Manila'"));
assert(browserSource.includes("limit: '1000'"));
assert(browserSource.includes('month: state.gcashHistoryMonth'));
assert(browserSource.includes('getGcashHistoryTransactionMonth'));
assert(browserSource.includes("state.gcashHistoryType === 'debit'"));
assert(browserSource.includes("if (type === 'remarked') return category === 'remarked'"));
assert(browserSource.includes("return category !== 'debit' && category !== 'remarked'"));
assert(browserSource.includes("['credit', 'debit', 'remarked'].includes(requestedType)"));
assert(browserSource.includes("state.gcashHistoryType !== 'credit'"));
assert(browserSource.includes("gcashHistoryCreditUse: 'available'"));
assert(browserSource.includes("creditUse === 'used'"));
assert(browserSource.includes("category === 'reserved' || category === 'posted'"));
assert(browserSource.includes('gcashAvailableCreditsCount.textContent = String(grouped.available.length)'));
assert(browserSource.includes('gcashUsedCreditsCount.textContent = String(grouped.reserved.length + grouped.posted.length)'));
assert(browserSource.includes('renderGcashHistoryStats(monthTransactions'));
assert(browserSource.includes("gcashHistoryNotForPostingCount.textContent = String(grouped.remarked.length)"));
assert(browserSource.includes("stepGcashHistoryMonth('older')"));
assert(browserSource.includes("stepGcashHistoryMonth('newer')"));
assert(browserSource.includes('/post-payment`'));
assert(browserSource.includes('Bind &amp; Post'));
assert(browserSource.includes('class="btn btn-icon btn-primary btn-sm" data-action="post-gcash"'));
assert(browserSource.includes('data-action="lock-gcash"'));
assert(browserSource.includes('data-action="unlock-gcash"'));
assert(browserSource.includes('/lock-posting`'));
assert(browserSource.includes('/unlock-posting`'));
assert(browserSource.includes("if (transaction.postingLock) return 'remarked'"));
assert(browserSource.includes('Not for Posting'));
assert(browserSource.includes('transaction.recipientLabel'));
assert(browserSource.includes('transaction.description'));
assert(browserSource.includes('No pending customer proof submissions. Imported GCash transactions are shown below.'));
assert(browserSource.includes('await Promise.all([fetchQueue(), fetchGcashHistory()])'));
assert(browserSource.includes('assignmentConfirmed: isGcash ? true : undefined'));
assert(!browserSource.includes('Assigned and Posted'));
assert(browserSource.includes('class="gcash-match-list"'));
assert(browserSource.includes('class="gcash-match-allocation"'));
assert(browserSource.includes('class="gcash-match-name"'));
assert(browserSource.includes('class="gcash-match-name gcash-match-link"'));
assert(browserSource.includes('payment-breakdown.html?account='));
assert(browserSource.includes('const isTempAccount = /^TMP\\d/i.test(accountNumber);'));
assert(browserSource.includes('accountNumber && !isTempAccount'));
assert(browserSource.includes('bg-azure-lt text-azure">Temp'));
assert(browserSource.includes('class="gcash-match-amount"'));
assert(browserSource.includes('transaction.paymentHistoryMatch'));
assert(browserSource.includes("paymentHistoryMatch?.status === 'pending_match'"));
assert(browserSource.includes('data-action="bind-matched-pending-gcash"'));
assert(browserSource.includes('Bind Pending'));
assert(browserSource.includes('openBindPendingGcashModal(pendingPayment, transaction.reference)'));
assert(browserSource.includes('getPendingGcashCandidateLabel'));
assert(browserSource.includes('renderBindPendingGcashVerificationSummary'));
assert(browserSource.includes("status: amountMatches ? 'Exact' : 'Mismatch'"));
assert(browserSource.includes("status: referenceMatches ? 'Exact' : 'Verify'"));
assert(browserSource.includes("label: 'Official Recipient'"));
assert(browserSource.includes('data-action="select-pending-gcash-candidate"'));
assert(browserSource.includes('transaction.sender'));
assert(browserSource.includes('getPendingGcashRecipientDisplay(transaction)'));
assert(browserSource.includes('Description: ${escapeHtml(description)}'));
assert(browserSource.includes('was preselected because it exactly matches this payment'));
assert(browserSource.includes('does not create another payment'));
assert(browserSource.includes('const selectedTransaction = exactReference || (transactions.length === 1 ? transactions[0] : null)'));
assert(paymentsSource.includes("'bind_pending'"));
assert(paymentsSource.includes("pendingAllocation ? 'pending_match' : 'review_required'"));
assert(!browserSource.includes("accountNumber ? `Acct: ${accountNumber}` : ''"));
assert(!browserSource.includes('billingMonth ? formatBillingMonth(billingMonth)'));
assert(browserSource.includes('save-gcash-remark'));
assert(browserSource.includes('class="btn btn-icon btn-outline-primary btn-sm" data-action="save-gcash-remark"'));
assert(browserSource.includes('const debitRemarkAction'));
assert(browserSource.includes('gcash-remark-editor--compact'));
assert(browserSource.includes('const actionCell = isReceived ? creditAction : debitRemarkAction'));
assert(!browserSource.includes('<td>${remarkCell}</td>'));
assert(browserSource.includes('getGcashHistoryCategory'));
assert(browserSource.includes('renderGcashHistoryStats'));
assert(browserSource.includes('getFilteredGcashHistoryTransactions'));
assert(browserSource.includes('`Last import: ${formatDateTime(latestBatch.importedAt)}`'));
assert(!browserSource.includes('if (latestBatch?.fileName)'));
assert(browserSource.includes('No ${escapeHtml(typeLabel)} match the current search'));
assert(browserSource.includes("gcashHistorySearch?.addEventListener('input'"));
assert(browserSource.includes('gcashCreditUseButtons.forEach((button) =>'));
assert(browserSource.includes('state.gcashHistoryCreditUse = creditUse'));
const creditUseListenerStart = browserSource.lastIndexOf('gcashCreditUseButtons.forEach((button) =>');
const creditUseListenerEnd = browserSource.indexOf("gcashHistoryMonth?.addEventListener('change'", creditUseListenerStart);
assert(creditUseListenerStart >= 0 && creditUseListenerEnd > creditUseListenerStart);
assert(!browserSource.slice(creditUseListenerStart, creditUseListenerEnd).includes('gcashHistoryMonth ='));
assert(cssSource.includes('.queue-history-view-bar'));
assert(cssSource.includes('.queue-credit-use-tabs'));
assert(cssSource.includes('.gcash-match-link'));
assert(cssSource.includes('.queue-bind-pending-section'));
assert(cssSource.includes('.queue-bind-pending-verification'));
assert(cssSource.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'));
assert(cssSource.includes('.queue-bind-pending-footer'));
assert(cssSource.includes('#queueGcashHistoryMonth'));
assert(cssSource.includes('table-layout: fixed'));
assert(cssSource.includes('min-width: 76rem'));
assert(cssSource.includes('.gcash-history-table .gcash-col-match'));
assert(cssSource.includes('grid-template-columns: minmax(7rem, 1fr) auto'));
assert(browserSource.includes('Expense — Unclassified'));
assert(browserSource.includes('addPostGcashAllocation'));
assert(browserSource.includes('allocations,'));
assert(browserSource.includes('getCanonicalEndingBalance'));
assert(browserSource.includes('queue-gcash-account-option__amount'));
assert(browserSource.includes('Amount due:'));
assert(browserSource.includes('Advance Payment'));
assert(browserSource.includes('isPostGcashAdvancePaymentRecord'));
assert(browserSource.includes('getPostGcashAdvanceBreakdown'));
assert(browserSource.includes('renderPostGcashAdvanceConfirmation'));
assert(browserSource.includes('advanceConfirmed: advanceTotal > 0.009'));
assert(browserSource.includes('will settle the current balance'));
assert(!browserSource.includes('cannot exceed the ending balance'));
assert(browserSource.includes('getPostGcashAccountDisplay'));
assert(browserSource.includes('formatCurrency(getCanonicalEndingBalance(record))'));
assert(!browserSource.includes('Number(getCanonicalEndingBalance(record)) > 0.009'));
assert(!browserSource.includes('queue-gcash-account-option__meta'));
assert(!browserSource.includes('data-gcash-allocation-month'));
assert(!browserSource.includes('Posts only to'));
assert(browserSource.includes('normalizePostGcashAccountSearch'));
assert(browserSource.includes('renderPostGcashAccountSuggestions'));
assert(browserSource.includes('getPostGcashSelectedAccounts'));
assert(browserSource.includes('selectedElsewhere.has(accountNumber)'));
assert(browserSource.includes('This customer account is already used in another allocation.'));
assert(browserSource.includes("['ArrowDown', 'ArrowUp', 'Enter']"));
assert(browserSource.includes('[data-gcash-account-option]'));
assert(!browserSource.includes("billingMonth: String(row.querySelector('[data-gcash-allocation-month]')"));
assert(!browserSource.includes('Choose a classification for this record.'));
assert(!browserSource.includes('/gcash-gmail/'));
assert(!browserSource.includes('/api/payment-bridge'));
assert(paymentsSource.includes('const recordApprovedProofPayments'));
assert(paymentsSource.includes('module.exports.recordApprovedProofPayments'));
assert(paymentsSource.includes('Payment allocations must exactly equal the imported GCash credit.'));
assert(paymentsSource.includes('[GCASH_RECEIVED_AT:'));
assert(paymentsSource.includes('paymentReceivedAt: paymentReceivedAt || undefined'));
assert(paymentsSource.includes('buildPaymentImportGcashReconciliationPlan'));
assert(paymentsSource.includes('claimGcashTransactionAllocations'));
assert(paymentsSource.includes('finalizeGcashTransactionAllocations'));
assert(paymentsSource.includes('gcashReconciliation'));
assert(paymentsSource.includes('This official GCash reference is marked Not for Posting'));
assert(paymentsSource.includes('&& !transaction?.postingLock'));
const paymentHistoryBrowserSource = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/billing/web/js/payment-history.js'),
    'utf8'
);
const paymentHistoryHtmlSource = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/billing/web/payment-history.html'),
    'utf8'
);
const paymentHistoryCssSource = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/billing/web/css/payment-history.css'),
    'utf8'
);
assert(paymentHistoryBrowserSource.includes('official GCash reference'));
assert(paymentHistoryBrowserSource.includes('Admin review'));
assert(paymentsSource.includes("router.get('/:accountNumber/:entryId/edit-bind-options'"));
assert(paymentsSource.includes("router.put('/:accountNumber/:entryId/edit-bind'"));
assert(paymentsSource.includes("router.get('/gcash-bindings'"));
assert(paymentsSource.includes('PAYMENT_HISTORY_GCASH_BINDING_LOCKED'));
assert(paymentsSource.includes('Only imported Cash or GCash Payment History entries can use Edit & Bind.'));
assert(paymentsSource.includes('claimGcashTransactionAllocations'));
assert(paymentsSource.includes('finalizeGcashTransactionAllocations'));
assert(paymentHistoryHtmlSource.includes('id="paymentHistoryEditBindModal"'));
assert(paymentHistoryHtmlSource.includes('id="paymentHistoryEditBindCustomer"'));
assert(paymentHistoryHtmlSource.includes('id="paymentHistoryEditBindGcash"'));
assert(paymentHistoryHtmlSource.includes('no duplicate payment is created'));
assert(paymentHistoryBrowserSource.includes('payment-history-edit-bind'));
assert(paymentHistoryBrowserSource.includes('getPaymentReceivedAt(entry) || entry?.recordedAt'));
assert(paymentHistoryBrowserSource.includes('GCASH_RECEIVED_AT:'));
assert(paymentHistoryBrowserSource.includes("fetchJSON('/api/payments/gcash-bindings')"));
assert(paymentHistoryBrowserSource.includes('boundGcashEntryIds.has(entryId)'));
assert(paymentHistoryBrowserSource.includes('disabled aria-disabled="true"><i class="ti ti-lock"></i>'));
assert(paymentHistoryBrowserSource.includes('Locked—this GCash transaction is already posted'));
assert(paymentHistoryBrowserSource.includes('/edit-bind-options'));
assert(paymentHistoryBrowserSource.includes('targetAccountNumber'));
assert(paymentHistoryBrowserSource.includes('Pending binding'));
assert(paymentHistoryHtmlSource.includes('After posting, the Edit action is permanently locked.'));
assert.strictEqual((paymentHistoryHtmlSource.match(/data-payment-history-dismiss="modal"/g) || []).length, 2);
assert(paymentHistoryBrowserSource.includes('[data-payment-history-dismiss="modal"]'));
assert(paymentHistoryCssSource.includes('#paymentHistoryEditBindModal.modal'));
assert(paymentHistoryCssSource.includes('z-index: 1110 !important'));
assert(paymentHistoryHtmlSource.includes('Suggestions show only the client name and amount due'));

(async () => {
    await importGcashTransactionBatch({
        branchId: 1,
        fileName: 'fixture.pdf',
        pdfSha256: 'a'.repeat(64),
        parsed,
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    const initialBranchHistory = await listGcashTransactionHistory({ branchId: 1, all: true });
    assert.deepStrictEqual(initialBranchHistory.availableMonths, ['2026-08']);
    assert.strictEqual(initialBranchHistory.filteredTotalTransactions, 2);
    assert.strictEqual(initialBranchHistory.selectedMonth, null);
    const initialBranchStatus = await getGcashTransactionHistoryStatus({ branchId: 1 });
    assert.strictEqual(initialBranchStatus.latestBatch.fileName, 'fixture.pdf');
    assert.strictEqual(initialBranchStatus.totalTransactions, 2);
    assert.strictEqual(initialBranchStatus.pendingReservationCount, 0);
    assert.strictEqual(Object.hasOwn(initialBranchStatus, 'transactions'), false);
    const augustBranchHistory = await listGcashTransactionHistory({ branchId: 1, month: '2026-08', all: true });
    assert.strictEqual(augustBranchHistory.transactions.length, 2);
    assert.strictEqual(augustBranchHistory.totalTransactions, 2);
    assert.strictEqual(augustBranchHistory.filteredTotalTransactions, 2);
    assert.strictEqual(augustBranchHistory.selectedMonth, '2026-08');
    const julyBranchHistory = await listGcashTransactionHistory({ branchId: 1, month: '2026-07', all: true });
    assert.strictEqual(julyBranchHistory.transactions.length, 0);
    assert.strictEqual(julyBranchHistory.totalTransactions, 2);
    assert.strictEqual(julyBranchHistory.filteredTotalTransactions, 0);
    assert.deepStrictEqual(julyBranchHistory.availableMonths, ['2026-08']);

    const tempPending = await reservePendingGcashReference({
        branchId: 13,
        reference: '0001234500678',
        accountNumber: 'TMP000013',
        customerName: 'Temp - Pending Customer',
        amount: 850,
        paymentDate: '2026-08-21',
        description: 'Counter GCash receipt',
        reservedBy: { id: 'admin-13', username: 'admin13', name: 'Admin 13' }
    });
    assert.strictEqual(tempPending.idempotent, false);
    const tempPendingRetry = await reservePendingGcashReference({
        branchId: 13,
        reference: '1234500678',
        accountNumber: 'TMP000013',
        customerName: 'Temp - Pending Customer',
        amount: 850,
        paymentDate: '2026-08-21',
        description: 'Counter GCash receipt',
        reservedBy: { id: 'admin-13', username: 'admin13', name: 'Admin 13' }
    });
    assert.strictEqual(tempPendingRetry.idempotent, true);
    assert.strictEqual(tempPendingRetry.pendingReservation.id, tempPending.pendingReservation.id);
    assert.strictEqual((await listGcashTransactionHistory({ branchId: 13, all: true })).pendingReservations.length, 1);
    await importGcashTransactionBatch({
        branchId: 13,
        fileName: 'temp-pending.pdf',
        pdfSha256: 'd'.repeat(64),
        parsed: {
            statementFrom: '2026-08-21',
            statementTo: '2026-08-21',
            transactions: [{
                reference: '0001234500678',
                transactionAt: '2026-08-21T10:15:00+08:00',
                transactionDate: '2026-08-21',
                description: 'Transfer from 09170000000',
                sender: '09170000000',
                recipient: '09361565251',
                debit: null,
                credit: 850,
                balance: 850,
                status: 'received'
            }]
        },
        importedBy: { id: 'admin-13', username: 'admin13', name: 'Admin 13' }
    });
    await assert.rejects(
        () => claimGcashTransactionAllocations({
            branchId: 13,
            reference: '0001234500678',
            submissionId: 'main-cannot-use-temp-pending',
            allocations: [{ accountNumber: 'ACC-OTHER', amount: 850, billingMonth: '2026-08' }],
            amount: 850,
            paymentDate: '2026-08-21'
        }),
        (error) => error?.code === 'GCASH_REFERENCE_PENDING_RESERVED'
    );
    const tempPendingClaim = await claimGcashTransactionAllocations({
        branchId: 13,
        reference: '0001234500678',
        submissionId: 'temp-gcash-pending-test',
        pendingReservationId: tempPending.pendingReservation.id,
        allocations: [{ accountNumber: 'TMP000013', amount: 850, billingMonth: '2026-08' }],
        amount: 850,
        paymentDate: '2026-08-21',
        claimedBy: { id: 'admin-13', username: 'admin13', name: 'Admin 13' }
    });
    assert.strictEqual(tempPendingClaim.idempotent, false);
    assert.strictEqual((await listGcashTransactionHistory({ branchId: 13, all: true })).pendingReservations.length, 0);
    const releasablePending = await reservePendingGcashReference({
        branchId: 13,
        reference: 'TEMP-CANCEL-13',
        accountNumber: 'TMP000014',
        customerName: 'Temp - Cancel Customer',
        amount: 500,
        paymentDate: '2026-08-22'
    });
    assert.strictEqual((await releasePendingGcashReference({
        branchId: 13,
        pendingId: releasablePending.pendingReservation.id
    })).released, true);
    assert.strictEqual((await listGcashTransactionHistory({ branchId: 13, all: true })).pendingReservations.length, 0);
    await assert.rejects(
        () => listGcashTransactionHistory({ branchId: 1, month: 'August 2026' }),
        (error) => error?.status === 400
    );
    await assert.rejects(
        () => listGcashTransactionHistory({ branchId: 1, month: '2026-08-extra' }),
        (error) => error?.status === 400
    );
    const importedDebit = initialBranchHistory.transactions.find((row) => row.reference === '1043753606701');
    assert(importedDebit, 'debit rows must remain in imported GCash history');
    assert.strictEqual(importedDebit.debit, 250);
    assert.strictEqual(importedDebit.credit, null);
    assert.strictEqual(importedDebit.remark.category, 'expense_unclassified');
    assert.strictEqual(importedDebit.remark.label, 'Expense — Unclassified');
    assert.strictEqual(importedDebit.remark.updatedBy.name, 'Admin');
    assert(importedDebit.remark.updatedAt);

    const updatedRemark = await updateGcashTransactionRemark({
        branchId: 1,
        reference: '1043-7536 06701',
        category: 'operating-expense',
        updatedBy: { id: 'admin-2', username: 'finance-admin', name: 'Finance Admin' }
    });
    assert.strictEqual(updatedRemark.remark.category, 'operating_expense');
    assert.strictEqual(updatedRemark.remark.label, 'Operating Expense');
    assert.strictEqual(updatedRemark.remark.updatedBy.name, 'Finance Admin');
    assert(updatedRemark.remark.updatedAt);
    const remarkedBranchHistory = await listGcashTransactionHistory({ branchId: 1, all: true });
    const remarkedDebit = remarkedBranchHistory.transactions.find((row) => row.reference === '1043753606701');
    assert.strictEqual(remarkedDebit.remark.category, 'operating_expense');
    assert.strictEqual(remarkedDebit.debit, 250);
    assert.strictEqual(remarkedDebit.credit, null);
    assert.strictEqual(remarkedDebit.description, 'Pay Bills');
    await assert.rejects(
        () => updateGcashTransactionRemark({
            branchId: 1,
            reference: '1043753606701',
            category: 'not-a-valid-remark',
            updatedBy: { id: 'admin-2' }
        }),
        (error) => error?.status === 400
    );

    await importGcashTransactionBatch({
        branchId: 11,
        fileName: 'posting-lock-fixture.pdf',
        pdfSha256: 'e'.repeat(64),
        parsed,
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    const postingLockBefore = (await listGcashTransactionHistory({ branchId: 11, all: true }))
        .transactions.find((row) => row.reference === '1043753606767');
    const immutablePostingLockFields = {
        reference: postingLockBefore.reference,
        transactionAt: postingLockBefore.transactionAt,
        description: postingLockBefore.description,
        sender: postingLockBefore.sender,
        recipient: postingLockBefore.recipient,
        credit: postingLockBefore.credit,
        debit: postingLockBefore.debit
    };
    const postingLock = await lockGcashTransactionPosting({
        branchId: 11,
        reference: '1043-7536 06767',
        remark: 'Personal transfer; no customer account required.',
        lockedBy: { id: 'admin-lock', username: 'lock-admin', name: 'Lock Admin' }
    });
    assert.strictEqual(postingLock.idempotent, false);
    assert.strictEqual(postingLock.postingLock.remark, 'Personal transfer; no customer account required.');
    assert.strictEqual(postingLock.postingLock.lockedBy.name, 'Lock Admin');
    const postingLockReplay = await lockGcashTransactionPosting({
        branchId: 11,
        reference: '1043753606767',
        remark: 'Personal transfer; no customer account required.',
        lockedBy: { id: 'admin-other', username: 'other-admin', name: 'Other Admin' }
    });
    assert.strictEqual(postingLockReplay.idempotent, true);
    await assert.rejects(
        () => lockGcashTransactionPosting({
            branchId: 11,
            reference: '1043753606767',
            remark: 'Trying to replace the locked audit.',
            lockedBy: { id: 'admin-other' }
        }),
        (error) => error?.code === 'GCASH_TRANSACTION_POSTING_LOCKED'
    );
    await assert.rejects(
        () => lockGcashTransactionPosting({
            branchId: 11,
            reference: '1043753606701',
            remark: 'Debit rows use classifications.',
            lockedBy: { id: 'admin-lock' }
        }),
        (error) => error?.code === 'GCASH_INCOMING_CREDIT_REQUIRED'
    );
    const lockedBranchHistory = await listGcashTransactionHistory({ branchId: 11, all: true });
    const lockedCredit = lockedBranchHistory.transactions.find((row) => row.reference === '1043753606767');
    assert.deepStrictEqual({
        reference: lockedCredit.reference,
        transactionAt: lockedCredit.transactionAt,
        description: lockedCredit.description,
        sender: lockedCredit.sender,
        recipient: lockedCredit.recipient,
        credit: lockedCredit.credit,
        debit: lockedCredit.debit
    }, immutablePostingLockFields);
    assert.strictEqual(lockedCredit.postingLockAudit.length, 1);
    assert.strictEqual(lockedCredit.postingLockAudit[0].action, 'locked');
    assert.strictEqual(evaluateGcashTransactionMatch({
        transactions: lockedBranchHistory.transactions,
        reference: '1043753606767',
        amount: 1000,
        paymentDate: '2026-08-08',
        merchantNumber: '09999999999'
    }).status, 'posting_locked');
    await assert.rejects(
        () => claimGcashTransactionAllocations({
            branchId: 11,
            reference: '1043753606767',
            submissionId: 'locked-payment-history-bind',
            allocations: [{
                accountNumber: 'ACC-LOCKED',
                customerName: 'Locked Customer',
                amount: 1000,
                billingMonth: '2026-08'
            }],
            amount: 1000,
            paymentDate: '2026-08-08',
            claimedBy: { id: 'admin-lock' }
        }),
        (error) => error?.code === 'GCASH_TRANSACTION_POSTING_LOCKED'
    );
    const lockedDuplicateImport = await importGcashTransactionBatch({
        branchId: 11,
        fileName: 'posting-lock-duplicate.pdf',
        pdfSha256: 'f'.repeat(64),
        parsed,
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    assert.strictEqual(lockedDuplicateImport.batch.importedCount, 0);
    assert.strictEqual(lockedDuplicateImport.duplicateCount, 2);
    const duplicateLockedHistory = await listGcashTransactionHistory({ branchId: 11, all: true });
    assert.strictEqual(duplicateLockedHistory.totalTransactions, 2);
    assert.strictEqual(
        duplicateLockedHistory.transactions.find((row) => row.reference === '1043753606767').postingLock.remark,
        'Personal transfer; no customer account required.'
    );

    await importGcashTransactionBatch({
        branchId: 12,
        fileName: 'posting-lock-branch-isolation.pdf',
        pdfSha256: 'e'.repeat(64),
        parsed,
        importedBy: { id: 'admin-12', username: 'branch-admin', name: 'Branch Admin' }
    });
    const otherBranchHistory = await listGcashTransactionHistory({ branchId: 12, all: true });
    assert.strictEqual(
        otherBranchHistory.transactions.find((row) => row.reference === '1043753606767').postingLock,
        null
    );

    const postingUnlock = await unlockGcashTransactionPosting({
        branchId: 11,
        reference: '1043753606767',
        unlockedBy: { id: 'admin-unlock', username: 'unlock-admin', name: 'Unlock Admin' }
    });
    assert.strictEqual(postingUnlock.idempotent, false);
    assert.strictEqual(postingUnlock.postingLock, null);
    const unlockedBranchHistory = await listGcashTransactionHistory({ branchId: 11, all: true });
    const unlockedCredit = unlockedBranchHistory.transactions.find((row) => row.reference === '1043753606767');
    assert.strictEqual(unlockedCredit.postingLock, null);
    assert.deepStrictEqual(unlockedCredit.postingLockAudit.map((entry) => entry.action), ['locked', 'unlocked']);
    const postUnlockClaim = await claimGcashTransactionAllocations({
        branchId: 11,
        reference: '1043753606767',
        submissionId: 'post-unlock-claim',
        allocations: [{
            accountNumber: 'ACC-UNLOCKED',
            customerName: 'Unlocked Customer',
            amount: 1000,
            billingMonth: '2026-08'
        }],
        amount: 1000,
        paymentDate: '2026-08-08',
        claimedBy: { id: 'admin-unlock' }
    });
    assert.strictEqual(postUnlockClaim.idempotent, false);
    assert.strictEqual(await releaseGcashTransactionClaim({
        branchId: 11,
        reference: '1043753606767',
        submissionId: 'post-unlock-claim',
        accountNumber: 'ACC-UNLOCKED'
    }), true);

    const duplicateImport = await importGcashTransactionBatch({
        branchId: 2,
        fileName: 'duplicate-reference-fixture.pdf',
        pdfSha256: 'b'.repeat(64),
        parsed: {
            ...parsed,
            transactions: [
                transaction,
                { ...transaction, reference: '1043 7536-06767' }
            ]
        },
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    assert.strictEqual(duplicateImport.batch.sourceRowCount, 2);
    assert.strictEqual(duplicateImport.batch.importedCount, 1);
    assert.strictEqual(duplicateImport.duplicateCount, 1);
    const duplicateHistory = await listGcashTransactionHistory({ branchId: 2, all: true });
    assert.strictEqual(duplicateHistory.totalTransactions, 1);

    const mixedImport = await importGcashTransactionBatch({
        branchId: 2,
        fileName: 'mixed-new-and-existing-references.pdf',
        pdfSha256: 'd'.repeat(64),
        parsed: {
            ...parsed,
            transactions: [
                { ...transaction, reference: '1043-7536 06767', credit: 999 },
                { ...transaction, reference: 'NEW-REFERENCE-2002', credit: 500 },
                { ...transaction, reference: 'NEW REFERENCE 2002', credit: 500 }
            ]
        },
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    assert.strictEqual(mixedImport.batch.sourceRowCount, 3);
    assert.strictEqual(mixedImport.batch.importedCount, 1);
    assert.strictEqual(mixedImport.duplicateCount, 2);
    assert.strictEqual(mixedImport.conflictingDuplicateCount, 1);
    assert.strictEqual(mixedImport.duplicateFile, false);
    assert.strictEqual(mixedImport.batchRecorded, true);
    const mixedHistory = await listGcashTransactionHistory({ branchId: 2, all: true });
    assert.strictEqual(mixedHistory.totalTransactions, 2);
    assert.strictEqual(mixedHistory.transactions.find((row) => row.reference === '1043753606767').credit, 1000);
    assert.strictEqual(mixedHistory.transactions.find((row) => row.reference === 'NEWREFERENCE2002').credit, 500);

    const repeatedFileImport = await importGcashTransactionBatch({
        branchId: 2,
        fileName: 'mixed-new-and-existing-references.pdf',
        pdfSha256: 'd'.repeat(64),
        parsed: {
            ...parsed,
            transactions: [
                { ...transaction, reference: '1043-7536 06767', credit: 999 },
                { ...transaction, reference: 'NEW-REFERENCE-2002', credit: 500 },
                { ...transaction, reference: 'NEW REFERENCE 2002', credit: 500 }
            ]
        },
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    assert.strictEqual(repeatedFileImport.batch.importedCount, 0);
    assert.strictEqual(repeatedFileImport.duplicateCount, 3);
    assert.strictEqual(repeatedFileImport.conflictingDuplicateCount, 1);
    assert.strictEqual(repeatedFileImport.duplicateFile, true);
    assert.strictEqual(repeatedFileImport.batchRecorded, false);
    const repeatedFileHistory = await listGcashTransactionHistory({ branchId: 2, all: true });
    assert.strictEqual(repeatedFileHistory.totalTransactions, 2);
    assert.strictEqual(repeatedFileHistory.batches.length, 2);

    const claim = await claimGcashTransaction({
        branchId: 1,
        reference: transaction.reference,
        submissionId: 'pcq-claim-1',
        accountNumber: 'ACC-1001',
        customerName: 'Correct Customer',
        amount: 1000,
        paymentDate: '2026-08-08',
        billingMonth: '2026-08',
        claimedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    assert.strictEqual(claim.assignment.status, 'claimed');
    assert.strictEqual(claim.assignment.accountNumber, 'ACC-1001');
    assert.strictEqual(claim.assignment.billingMonth, '2026-08');
    await assert.rejects(
        () => claimGcashTransaction({
            branchId: 1,
            reference: transaction.reference,
            submissionId: 'pcq-claim-1',
            accountNumber: 'ACC-1001',
            billingMonth: '2026-09'
        }),
        (error) => error?.code === 'GCASH_TRANSACTION_ALREADY_ASSIGNED'
            && error?.assignment?.billingMonth === '2026-08'
    );
    await assert.rejects(
        () => claimGcashTransaction({
            branchId: 1,
            reference: transaction.reference,
            submissionId: 'pcq-claim-2',
            accountNumber: 'ACC-2002'
        }),
        (error) => error?.code === 'GCASH_TRANSACTION_ALREADY_ASSIGNED'
            && error?.assignment?.accountNumber === 'ACC-1001'
    );
    const finalized = await finalizeGcashTransactionAssignment({
        branchId: 1,
        reference: transaction.reference,
        submissionId: 'pcq-claim-1',
        accountNumber: 'ACC-1001',
        paymentEntryId: 'proof-pcq-claim-1'
    });
    assert.strictEqual(finalized.assignment.status, 'posted');
    assert.strictEqual(finalized.assignment.paymentEntryId, 'proof-pcq-claim-1');
    assert.strictEqual(await releaseGcashTransactionClaim({
        branchId: 1,
        reference: transaction.reference,
        submissionId: 'pcq-claim-1',
        accountNumber: 'ACC-1001'
    }), false);
    const stored = await listGcashTransactionHistory({ branchId: 1, all: true });
    assert.strictEqual(stored.transactions[0].assignment.accountNumber, 'ACC-1001');
    assert.strictEqual(stored.transactions[0].assignment.status, 'posted');
    assert.strictEqual(stored.transactions[0].assignment.billingMonth, '2026-08');

    await importGcashTransactionBatch({
        branchId: 4,
        fileName: 'split-allocation-fixture.pdf',
        pdfSha256: 'e'.repeat(64),
        parsed: {
            ...parsed,
            transactions: [{ ...transaction, reference: 'SPLIT-ALLOC-4004' }]
        },
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    const splitClaim = await claimGcashTransactionAllocations({
        branchId: 4,
        reference: 'SPLIT-ALLOC-4004',
        submissionId: 'split-claim-4004',
        amount: 1000,
        paymentDate: '2026-08-08',
        allocations: [
            { accountNumber: 'ACC-4001', customerName: 'Account One', billingMonth: '2026-08', amount: 300 },
            { accountNumber: 'ACC-4002', customerName: 'Account Two', billingMonth: '2026-08', amount: 300 },
            { accountNumber: 'ACC-4003', customerName: 'Account Three', billingMonth: '2026-08', amount: 400 }
        ],
        claimedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    assert.strictEqual(splitClaim.assignment.status, 'claimed');
    assert.strictEqual(splitClaim.assignment.accountNumber, '');
    assert.strictEqual(splitClaim.assignment.allocations.length, 3);
    assert.strictEqual(splitClaim.assignment.amount, 1000);
    await assert.rejects(
        () => claimGcashTransactionAllocations({
            branchId: 4,
            reference: 'SPLIT-ALLOC-4004',
            submissionId: 'split-claim-4004',
            allocations: [
                { accountNumber: 'ACC-4001', billingMonth: '2026-08', amount: 500 },
                { accountNumber: 'ACC-4002', billingMonth: '2026-08', amount: 500 }
            ]
        }),
        (error) => error?.code === 'GCASH_TRANSACTION_ALREADY_ASSIGNED'
            && error?.assignment?.allocations?.length === 3
    );
    const splitFinalized = await finalizeGcashTransactionAllocations({
        branchId: 4,
        reference: 'SPLIT-ALLOC-4004',
        submissionId: 'split-claim-4004',
        paymentEntries: [
            { accountNumber: 'ACC-4001', billingMonth: '2026-08', paymentEntryId: 'proof-split-4004-1' },
            { accountNumber: 'ACC-4002', billingMonth: '2026-08', paymentEntryId: 'proof-split-4004-2' },
            { accountNumber: 'ACC-4003', billingMonth: '2026-08', paymentEntryId: 'proof-split-4004-3' }
        ]
    });
    assert.strictEqual(splitFinalized.assignment.status, 'posted');
    assert.deepStrictEqual(splitFinalized.assignment.paymentEntryIds, [
        'proof-split-4004-1',
        'proof-split-4004-2',
        'proof-split-4004-3'
    ]);
    assert.strictEqual(await releaseGcashTransactionClaim({
        branchId: 4,
        reference: 'SPLIT-ALLOC-4004',
        submissionId: 'split-claim-4004'
    }), false);

    await importGcashTransactionBatch({
        branchId: 3,
        fileName: 'direct-post-fixture.pdf',
        pdfSha256: 'c'.repeat(64),
        parsed: {
            ...parsed,
            transactions: [
                {
                    ...transaction,
                    reference: 'DIRECT-POST-1001',
                    recipient: '09361565251'
                },
                {
                    ...transaction,
                    reference: 'DIRECT-ADVANCE-1002',
                    credit: 500,
                    recipient: '09361565251'
                },
                {
                    ...transaction,
                    reference: 'DIRECT-LOCK-1003',
                    credit: 750,
                    recipient: '09361565251'
                },
                {
                    ...transaction,
                    reference: 'DIRECT-OVERPAY-1004',
                    credit: 810,
                    recipient: '09361565251'
                }
            ]
        },
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    await lockGcashTransactionPosting({
        branchId: 3,
        reference: 'DIRECT-LOCK-1003',
        remark: 'Personal transfer with no customer account.',
        lockedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });

    const batchCustomers = ['ACC-5001', 'ACC-5002', 'ACC-5003', 'ACC-PENDING'].map((accountNumber, index) => ({
        accountNumber,
        branchId: 5,
        name: `Batch Customer ${index + 1}`,
        status: 'active',
        plan: 'Postpaid Test Plan',
        billingType: 'postpaid',
        creditLimit: 999999
    }));
    const customersModulePath = require.resolve('../../customer-management/backend/customers');
    require.cache[customersModulePath] = {
        id: customersModulePath,
        filename: customersModulePath,
        loaded: true,
        exports: {
            readVisibleCustomers: async () => batchCustomers,
            readCustomers: async () => batchCustomers,
            writeCustomers: async () => {},
            readPlans: async () => []
        }
    };
    const relationalModulePath = require.resolve(path.join(projectRoot, 'core/data/db-relational'));
    require.cache[relationalModulePath] = {
        id: relationalModulePath,
        filename: relationalModulePath,
        loaded: true,
        exports: { isRelationalReady: async () => false }
    };
    const serviceRefreshModulePath = require.resolve('../backend/payment-service-refresh');
    require.cache[serviceRefreshModulePath] = {
        id: serviceRefreshModulePath,
        filename: serviceRefreshModulePath,
        loaded: true,
        exports: { triggerBranchServiceRefresh: () => {} }
    };
    const paymentsModulePath = require.resolve('../backend/payments');
    const actualPaymentsRouter = require('../backend/payments');
    const gcashReferenceLookup = require('../backend/gcash-payment-reference-lookup');
    assert.strictEqual(actualPaymentsRouter.normalizeManualPaymentReferenceKey(' OR-12 345 '), 'OR12345');
    assert.strictEqual(actualPaymentsRouter.paymentReferencesMatch('43891500420', '0043891500420'), true);
    assert.strictEqual(actualPaymentsRouter.paymentReferencesMatch('OR-12345', 'or 12345'), true);
    assert.strictEqual(actualPaymentsRouter.paymentReferencesMatch('OR-12345', 'OR-54321'), false);
    assert.deepStrictEqual(actualPaymentsRouter.findManualPaymentReferenceConflict({
        reference: '0043891500420',
        payments: {
            'ACC-REFERENCE-1': {
                history: [{
                    id: 'pay-reference-1',
                    reference: '43891500420',
                    status: 'pending_gcash_verification'
                }]
            }
        }
    }), {
        source: 'payment_history',
        accountNumber: 'ACC-REFERENCE-1',
        entryId: 'pay-reference-1',
        message: 'This reference is already used in Payment History or a pending payment.'
    });
    assert.deepStrictEqual(actualPaymentsRouter.findManualPaymentReferenceConflict({
        reference: 'GCASH-USED-1001',
        gcashTransactions: [{ reference: 'gcash used 1001' }]
    }), {
        source: 'gcash_transaction',
        reference: 'gcash used 1001',
        message: 'This reference already exists in Imported GCash Transactions. Use it from GCash Transactions instead.'
    });
    assert.deepStrictEqual(actualPaymentsRouter.findManualPaymentReferenceConflict({
        reference: '0001234500678',
        gcashPendingReservations: [{
            id: 'temp-pending-reservation-13',
            reference: '1234500678',
            accountNumber: 'TMP000013'
        }]
    }), {
        source: 'temp_pending_gcash',
        accountNumber: 'TMP000013',
        pendingReservationId: 'temp-pending-reservation-13',
        message: 'This reference is reserved by a pending Temp GCash payment.'
    });
    assert.strictEqual(actualPaymentsRouter.findManualPaymentReferenceConflict({
        reference: 'AVAILABLE-REFERENCE-1001',
        payments: paymentStoreMemory,
        gcashTransactions: []
    }), null);
    const collectedMainMatches = await gcashReferenceLookup.findMainGcashPaymentsByReference({
        references: ['00 4389-1500420', 'UNUSED-REFERENCE'],
        includeCustomerNames: true,
        customers: [{
            accountNumber: 'ACC-MAIN-GCASH',
            firstName: 'Janice',
            middleName: 'A.',
            lastName: 'Juanang'
        }],
        payments: {
            'ACC-MAIN-GCASH': {
                history: [{
                    id: 'main-gcash-payment-1',
                    reference: '43891500420',
                    amount: 800,
                    date: '2026-08-08',
                    kind: 'payment',
                    direction: 'credit',
                    paymentMethod: 'GCash',
                    status: 'Approved'
                }]
            },
            'ACC-MAIN-CASH': {
                history: [{
                    id: 'main-cash-payment-1',
                    reference: '0043891500420',
                    amount: 800,
                    date: '2026-08-08',
                    kind: 'payment',
                    direction: 'credit',
                    paymentMethod: 'Cash',
                    status: 'Approved'
                }]
            }
        }
    });
    assert.strictEqual(collectedMainMatches.length, 1);
    assert.strictEqual(collectedMainMatches[0].accountNumber, 'ACC-MAIN-GCASH');
    assert.strictEqual(collectedMainMatches[0].paymentEntryId, 'main-gcash-payment-1');
    assert.strictEqual(collectedMainMatches[0].customerName, 'Janice A. Juanang');
    const anyMethodMainMatches = await gcashReferenceLookup.findMainGcashPaymentsByReference({
        reference: '0043891500420',
        includeAnyPaymentMethod: true,
        payments: {
            'ACC-MAIN-CASH': {
                history: [{
                    id: 'main-cash-reference-guard',
                    reference: '43891500420',
                    amount: 800,
                    date: '2026-08-08',
                    kind: 'payment',
                    direction: 'credit',
                    paymentMethod: 'Cash',
                    status: 'Approved'
                }]
            }
        }
    });
    assert.strictEqual(anyMethodMainMatches.length, 1);
    assert.strictEqual(anyMethodMainMatches[0].paymentMethod, 'cash');
    const mislabeledMainMatches = await gcashReferenceLookup.findMainGcashPaymentsByReference({
        reference: '0043891500420',
        officialTransactions: [{
            reference: '0043891500420',
            credit: 800,
            transactionDate: '2026-08-08'
        }],
        payments: {
            'ACC-MAIN-CASH': {
                history: [{
                    id: 'main-cash-payment-1',
                    reference: '43891500420',
                    amount: 800,
                    date: '2026-08-08',
                    kind: 'payment',
                    direction: 'credit',
                    paymentMethod: 'Cash',
                    status: 'Approved'
                }]
            },
            'ACC-MAIN-WRONG-AMOUNT': {
                history: [{
                    id: 'main-cash-wrong-amount',
                    reference: '0043891500420',
                    amount: 799,
                    date: '2026-08-08',
                    kind: 'payment',
                    direction: 'credit',
                    paymentMethod: '',
                    status: 'Approved'
                }]
            }
        }
    });
    assert.strictEqual(mislabeledMainMatches.length, 1);
    assert.strictEqual(mislabeledMainMatches[0].paymentEntryId, 'main-cash-payment-1');
    const pendingMainMatches = await gcashReferenceLookup.findMainGcashPaymentsByReference({
        reference: 'PENDING-MAIN-REF-1002',
        includePending: true,
        payments: {
            'ACC-PENDING-MAIN': {
                history: [{
                    id: 'pending-main-gcash-payment-1',
                    reference: 'PENDING MAIN REF 1002',
                    amount: 900,
                    date: '2026-08-08',
                    kind: 'payment',
                    direction: 'credit',
                    paymentMethod: 'GCash',
                    status: 'pending_gcash_verification'
                }]
            }
        }
    });
    assert.strictEqual(pendingMainMatches.length, 1);
    assert.strictEqual(pendingMainMatches[0].pending, true);
    assert.strictEqual(pendingMainMatches[0].accountNumber, 'ACC-PENDING-MAIN');
    const pendingShortcutReference = 'PENDING-SHORTCUT-5005';
    const pendingShortcutEntry = {
        id: 'pending-shortcut-entry-5005',
        reference: pendingShortcutReference,
        amount: 651,
        date: '2026-08-08',
        kind: 'payment',
        type: 'payment',
        direction: 'credit',
        paymentMethod: 'GCash',
        status: 'pending_gcash_verification'
    };
    paymentStoreMemory['ACC-PENDING'] = { history: [] };
    paymentStoreMemory['ACC-PENDING'].history.unshift(pendingShortcutEntry);
    await importGcashTransactionBatch({
        branchId: 5,
        fileName: 'pending-gcash-shortcut.pdf',
        pdfSha256: 'c'.repeat(64),
        parsed: {
            ...parsed,
            transactions: [{
                ...transaction,
                reference: pendingShortcutReference,
                credit: 651,
                recipient: '09361565251'
            }]
        },
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    const pendingShortcutMatches = await actualPaymentsRouter.getExistingPaymentHistoryGcashMatches({ branchId: 5 });
    const pendingShortcutMatch = pendingShortcutMatches.matchesByReference.PENDINGSHORTCUT5005;
    assert.strictEqual(pendingShortcutMatch.status, 'pending_match');
    assert.strictEqual(pendingShortcutMatch.reason.includes('awaiting Admin confirmation'), true);
    assert.deepStrictEqual(pendingShortcutMatch.pendingPayment, {
        entryId: pendingShortcutEntry.id,
        accountNumber: 'ACC-PENDING',
        customerName: 'Batch Customer 4',
        amount: 651,
        paymentDate: '2026-08-08',
        enteredReference: 'PENDINGSHORTCUT5005',
        paymentMethod: 'GCash',
        status: 'pending_gcash_verification',
        statusLabel: 'Pending'
    });
    paymentStoreMemory['ACC-PENDING'].history = paymentStoreMemory['ACC-PENDING'].history
        .filter((entry) => entry.id !== pendingShortcutEntry.id);
    const batchWrite = await actualPaymentsRouter.recordApprovedProofPayments({
        submissionId: 'batch-writer-5005',
        source: 'gcash-history',
        branchId: 5,
        amount: 1000,
        reference: 'BATCH-WRITER-5005',
        date: '2026-08-08',
        paymentReceivedAt: officialTransactionAt,
        reviewer: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' },
        allocations: [
            { accountNumber: 'ACC-5001', billingMonth: '2026-08', amount: 300 },
            { accountNumber: 'ACC-5002', billingMonth: '2026-08', amount: 300 },
            { accountNumber: 'ACC-5003', billingMonth: '2026-08', amount: 400 }
        ]
    });
    assert.strictEqual(batchWrite.inserted, true);
    assert.strictEqual(batchWrite.entries.length, 3);
    assert.strictEqual(new Set(batchWrite.entries.map((entry) => entry.id)).size, 3);
    assert.strictEqual(Object.values(paymentStoreMemory).reduce((count, record) => (
        count + (Array.isArray(record?.history) ? record.history.length : 0)
    ), 0), 3);
    assert.deepStrictEqual(Object.values(paymentStoreMemory).flatMap((record) => record.history).map((entry) => entry.reference), [
        'BATCH-WRITER-5005',
        'BATCH-WRITER-5005',
        'BATCH-WRITER-5005'
    ]);
    const storedBatchEntries = Object.values(paymentStoreMemory).flatMap((record) => record.history);
    assert(storedBatchEntries.every((entry) => entry.date === '2026-08-08'));
    assert(storedBatchEntries.every((entry) => entry.paymentReceivedAt === officialTransactionAt));
    assert(storedBatchEntries.every((entry) => !entry.description.includes('[GCASH_RECEIVED_AT:')));
    assert(storedBatchEntries.every((entry) => entry.fingerprint.includes(`[GCASH_RECEIVED_AT:${officialTransactionAt}]`)));
    assert(storedBatchEntries.every((entry) => entry.recordedAt !== officialTransactionAt));
    const batchRetry = await actualPaymentsRouter.recordApprovedProofPayments({
        submissionId: 'batch-writer-5005',
        source: 'gcash-history',
        branchId: 5,
        amount: 1000,
        reference: 'BATCH-WRITER-5005',
        date: '2026-08-08',
        paymentReceivedAt: officialTransactionAt,
        reviewer: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' },
        allocations: [
            { accountNumber: 'ACC-5001', billingMonth: '2026-08', amount: 300 },
            { accountNumber: 'ACC-5002', billingMonth: '2026-08', amount: 300 },
            { accountNumber: 'ACC-5003', billingMonth: '2026-08', amount: 400 }
        ]
    });
    assert.strictEqual(batchRetry.idempotent, true);
    assert.strictEqual(Object.values(paymentStoreMemory).reduce((count, record) => (
        count + (Array.isArray(record?.history) ? record.history.length : 0)
    ), 0), 3);

    const makeImportedPaymentRecord = ({ reference, accountNumber, amount, date = '2026-08-08' }) => ({
        method: 'GCash',
        accountNumber,
        customerName: `Batch Customer ${accountNumber.slice(-1)}`,
        amount,
        entry: {
            id: `import-${reference}-${accountNumber}`,
            reference,
            amount,
            date,
            kind: 'payment',
            type: 'payment',
            direction: 'credit'
        }
    });
    const plannerInsert = actualPaymentsRouter.buildPaymentImportGcashReconciliationPlan({
        branchId: 5,
        records: [
            makeImportedPaymentRecord({ reference: 'AUTO-PLAN-5005', accountNumber: 'ACC-5001', amount: 600 }),
            makeImportedPaymentRecord({ reference: 'AUTOPLAN5005', accountNumber: 'ACC-5002', amount: 400 })
        ],
        transactions: [{
            reference: 'AUTO PLAN 5005',
            status: 'received',
            credit: 1000,
            transactionDate: '2026-08-08',
            assignment: null
        }],
        payments: {}
    });
    assert.strictEqual(plannerInsert.insertGroups.length, 1);
    assert.strictEqual(plannerInsert.insertGroups[0].allocations.length, 2);
    const plannerConflict = actualPaymentsRouter.buildPaymentImportGcashReconciliationPlan({
        branchId: 5,
        records: [makeImportedPaymentRecord({
            reference: 'AUTO-PLAN-5005',
            accountNumber: 'ACC-5001',
            amount: 999
        })],
        transactions: [{
            reference: 'AUTO PLAN 5005',
            status: 'received',
            credit: 1000,
            transactionDate: '2026-08-08',
            assignment: null
        }],
        payments: {}
    });
    assert.strictEqual(plannerConflict.conflictGroups.length, 1);
    assert(plannerConflict.conflictGroups[0].reason.includes('does not equal'));
    const plannerPostingLocked = actualPaymentsRouter.buildPaymentImportGcashReconciliationPlan({
        branchId: 5,
        records: [makeImportedPaymentRecord({
            reference: 'LOCKED-AUTO-PLAN-5005',
            accountNumber: 'ACC-5001',
            amount: 1000
        })],
        transactions: [{
            reference: 'LOCKED AUTO PLAN 5005',
            status: 'received',
            credit: 1000,
            transactionDate: '2026-08-08',
            assignment: null,
            postingLock: {
                remark: 'Personal transfer',
                lockedAt: '2026-08-09T00:00:00.000Z',
                lockedBy: { id: 'admin-1' }
            }
        }],
        payments: {}
    });
    assert.strictEqual(plannerPostingLocked.insertGroups.length, 0);
    assert.strictEqual(plannerPostingLocked.conflictGroups.length, 1);
    assert(plannerPostingLocked.conflictGroups[0].reason.includes('Not for Posting'));
    const existingPostingLockedPlan = actualPaymentsRouter.buildExistingPaymentHistoryGcashReconciliationPlan({
        branchId: 5,
        transactions: [{
            reference: 'LOCKED-EXISTING-5005',
            status: 'received',
            credit: 1000,
            transactionDate: '2026-08-08',
            assignment: null,
            postingLock: {
                remark: 'Non-customer transfer',
                lockedAt: '2026-08-09T00:00:00.000Z',
                lockedBy: { id: 'admin-1' }
            }
        }],
        payments: {
            'ACC-5001': {
                history: [{
                    id: 'locked-existing-entry-5005',
                    reference: 'LOCKED EXISTING 5005',
                    amount: 1000,
                    date: '2026-08-08',
                    paymentMethod: 'GCash',
                    kind: 'payment',
                    type: 'payment',
                    direction: 'credit'
                }]
            }
        },
        customers: [{ accountNumber: 'ACC-5001', name: 'Batch Customer 1' }]
    });
    assert.strictEqual(existingPostingLockedPlan.groups[0].action, 'not_for_posting');
    assert.strictEqual(existingPostingLockedPlan.bindExistingGroups.length, 0);
    assert.strictEqual(existingPostingLockedPlan.suggestionGroups.length, 0);

    const leadingZeroPlanner = actualPaymentsRouter.buildPaymentImportGcashReconciliationPlan({
        branchId: 5,
        records: [makeImportedPaymentRecord({
            reference: '43891500420',
            accountNumber: 'ACC-5001',
            amount: 525
        })],
        transactions: [{
            reference: '0043891500420',
            status: 'received',
            credit: 525,
            transactionDate: '2026-08-08',
            assignment: null
        }],
        payments: {}
    });
    assert.strictEqual(leadingZeroPlanner.insertGroups.length, 1);
    assert.strictEqual(leadingZeroPlanner.insertGroups[0].reference, '0043891500420');
    const ambiguousLeadingZeroPlanner = actualPaymentsRouter.buildPaymentImportGcashReconciliationPlan({
        branchId: 5,
        records: [makeImportedPaymentRecord({
            reference: '438',
            accountNumber: 'ACC-5001',
            amount: 525
        })],
        transactions: [
            {
                reference: '00438',
                status: 'received',
                credit: 525,
                transactionDate: '2026-08-08',
                assignment: null
            },
            {
                reference: '000438',
                status: 'received',
                credit: 525,
                transactionDate: '2026-08-08',
                assignment: null
            }
        ],
        payments: {}
    });
    assert.strictEqual(ambiguousLeadingZeroPlanner.conflictGroups.length, 1);
    assert(ambiguousLeadingZeroPlanner.conflictGroups[0].reason.includes('multiple official GCash references'));

    await importGcashTransactionBatch({
        branchId: 5,
        fileName: 'payment-history-auto-bind.pdf',
        pdfSha256: 'f'.repeat(64),
        parsed: {
            ...parsed,
            transactions: [{
                ...transaction,
                reference: 'AUTO-BIND-5005',
                credit: 1000,
                recipient: '09361565251'
            }]
        },
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    const xlsx = require('xlsx');
    const makePaymentImportWorkbook = ({ reference, accountNumber, amount }) => {
        const workbook = xlsx.utils.book_new();
        const worksheet = xlsx.utils.aoa_to_sheet([
            ['Date', 'Gcash Account', 'Reference Number', 'Account Number', 'Particulars', '3J Payment'],
            ['2026-08-08', '09361565251', reference, accountNumber, `Batch Customer ${accountNumber.slice(-1)}`, amount]
        ]);
        xlsx.utils.book_append_sheet(workbook, worksheet, 'GCASH AUG 2026');
        return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    };
    const originalMkdir = fs.promises.mkdir;
    const originalWriteFile = fs.promises.writeFile;
    await importGcashTransactionBatch({
        branchId: 5,
        fileName: 'pending-gcash-verification.pdf',
        pdfSha256: 'b'.repeat(64),
        parsed: {
            ...parsed,
            transactions: [{
                ...transaction,
                reference: 'PENDING-VERIFY-5005',
                credit: 650,
                recipient: '09361565251'
            }]
        },
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    const manualPaymentLayer = actualPaymentsRouter.stack.find((layer) => (
        layer.route?.path === '/:accountNumber' && layer.route?.methods?.post
    ));
    assert(manualPaymentLayer, 'manual payment route must be registered');
    const manualPaymentHandler = manualPaymentLayer.route.stack[manualPaymentLayer.route.stack.length - 1].handle;
    const manualPaymentResponse = { statusCode: 200, payload: null };
    await manualPaymentHandler({
        params: { accountNumber: 'ACC-PENDING' },
        body: {
            amount: 650,
            date: '2026-08-08',
            kind: 'payment',
            paymentMethod: 'GCash',
            reference: 'WRONG-ENTERED-REF'
        },
        user: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin', branchId: 5 }
    }, {
        status(code) {
            manualPaymentResponse.statusCode = code;
            return this;
        },
        json(payload) {
            manualPaymentResponse.payload = payload;
            return this;
        }
    }, (error) => {
        throw error;
    });
    assert.strictEqual(manualPaymentResponse.statusCode, 201);
    assert.strictEqual(manualPaymentResponse.payload.status, 'pending_gcash_verification');
    assert.strictEqual(manualPaymentResponse.payload.paymentMethod, 'GCash');
    const pendingEntryId = manualPaymentResponse.payload.id;
    const pendingBeforeBind = await actualPaymentsRouter.listPendingGcashPayments({ branchId: 5 });
    assert.strictEqual(pendingBeforeBind.length, 1);
    assert.strictEqual(pendingBeforeBind[0].accountNumber, 'ACC-PENDING');
    const pendingBindOptions = await actualPaymentsRouter.getPendingGcashBindOptions({
        branchId: 5,
        accountNumber: 'ACC-PENDING',
        entryId: pendingEntryId
    });
    assert.deepStrictEqual(pendingBindOptions.transactions.map((row) => row.reference), ['PENDINGVERIFY5005']);
    const entryCountBeforePendingBind = Object.values(paymentStoreMemory).reduce((count, record) => (
        count + (Array.isArray(record?.history) ? record.history.length : 0)
    ), 0);
    fs.promises.mkdir = async () => {};
    fs.promises.writeFile = async () => {};
    let pendingBindResult;
    try {
        pendingBindResult = await actualPaymentsRouter.bindPendingGcashPayment({
            branchId: 5,
            accountNumber: 'ACC-PENDING',
            entryId: pendingEntryId,
            gcashReference: 'PENDING-VERIFY-5005',
            assignmentConfirmed: true,
            verifiedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' }
        });
    } finally {
        fs.promises.mkdir = originalMkdir;
        fs.promises.writeFile = originalWriteFile;
    }
    assert.strictEqual(pendingBindResult.idempotent, false);
    assert.strictEqual(pendingBindResult.entry.id, pendingEntryId);
    assert.strictEqual(pendingBindResult.entry.status, 'Approved');
    assert.strictEqual(pendingBindResult.entry.reference, 'PENDINGVERIFY5005');
    assert.strictEqual(pendingBindResult.entry.paymentReceivedAt, officialTransactionAt);
    assert.strictEqual(Object.values(paymentStoreMemory).reduce((count, record) => (
        count + (Array.isArray(record?.history) ? record.history.length : 0)
    ), 0), entryCountBeforePendingBind, 'binding must update the same ledger entry instead of inserting a duplicate');
    const pendingAfterBind = await actualPaymentsRouter.listPendingGcashPayments({ branchId: 5 });
    assert.strictEqual(pendingAfterBind.length, 0);
    const pendingPostedHistory = await listGcashTransactionHistory({ branchId: 5, all: true });
    const pendingPostedTransaction = pendingPostedHistory.transactions.find((row) => row.reference === 'PENDINGVERIFY5005');
    assert.strictEqual(pendingPostedTransaction.assignment.status, 'posted');
    assert.strictEqual(pendingPostedTransaction.assignment.paymentEntryId, pendingEntryId);
    const pendingBindRetry = await actualPaymentsRouter.bindPendingGcashPayment({
        branchId: 5,
        accountNumber: 'ACC-PENDING',
        entryId: pendingEntryId,
        gcashReference: 'PENDING-VERIFY-5005',
        assignmentConfirmed: true,
        verifiedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' }
    });
    assert.strictEqual(pendingBindRetry.idempotent, true);
    fs.promises.mkdir = async () => {};
    fs.promises.writeFile = async () => {};
    try {
        const autoBindWorkbook = makePaymentImportWorkbook({
            reference: 'AUTO-BIND-5005',
            accountNumber: 'ACC-5001',
            amount: 1000
        });
        const autoBindImport = await actualPaymentsRouter.importPaymentRecordsFromExcel({
            buffer: autoBindWorkbook,
            branchId: 5,
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' },
            fileName: 'cash-flow-auto-bind.xlsx'
        });
        assert.strictEqual(autoBindImport.imported, 1);
        assert.strictEqual(autoBindImport.gcashReconciliation.autoBoundReferences, 1);
        assert.strictEqual(autoBindImport.gcashReconciliation.newPaymentBindings, 1);
        assert.strictEqual(autoBindImport.gcashReconciliation.conflictReferences, 0);
        const autoBoundHistory = await listGcashTransactionHistory({ branchId: 5, all: true });
        const autoBoundTransaction = autoBoundHistory.transactions.find((row) => row.reference === 'AUTOBIND5005');
        assert.strictEqual(autoBoundTransaction.assignment.status, 'posted');
        assert.strictEqual(autoBoundTransaction.assignment.accountNumber, 'ACC-5001');
        assert.strictEqual(autoBoundTransaction.assignment.amount, 1000);
        assert(autoBoundTransaction.assignment.paymentEntryId);
        const autoBoundLedgerCount = Object.values(paymentStoreMemory).reduce((count, record) => (
            count + (Array.isArray(record?.history)
                ? record.history.filter((entry) => entry.reference === 'AUTO-BIND-5005').length
                : 0)
        ), 0);
        assert.strictEqual(autoBoundLedgerCount, 1);

        const autoBindRetry = await actualPaymentsRouter.importPaymentRecordsFromExcel({
            buffer: autoBindWorkbook,
            branchId: 5,
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' },
            fileName: 'cash-flow-auto-bind.xlsx'
        });
        assert.strictEqual(autoBindRetry.imported, 0);
        assert.strictEqual(autoBindRetry.duplicates, 1);
        assert.strictEqual(autoBindRetry.gcashReconciliation.alreadyPostedReferences, 1);
        const retryLedgerCount = Object.values(paymentStoreMemory).reduce((count, record) => (
            count + (Array.isArray(record?.history)
                ? record.history.filter((entry) => entry.reference === 'AUTO-BIND-5005').length
                : 0)
        ), 0);
        assert.strictEqual(retryLedgerCount, 1);

        const existingReference = 'EXISTING-BIND-5005';
        paymentStoreMemory['ACC-5002'].history.unshift({
            id: 'existing-payment-bind-5005',
            reference: existingReference,
            amount: 500,
            date: '2026-08-08',
            kind: 'payment',
            type: 'payment',
            direction: 'credit',
            paymentMethod: 'GCash'
        });
        await importGcashTransactionBatch({
            branchId: 5,
            fileName: 'payment-history-existing-bind.pdf',
            pdfSha256: '1'.repeat(64),
            parsed: {
                ...parsed,
                transactions: [{
                    ...transaction,
                    reference: existingReference,
                    credit: 500,
                    recipient: '09361565251'
                }]
            },
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
        });
        const existingBindImport = await actualPaymentsRouter.importPaymentRecordsFromExcel({
            buffer: makePaymentImportWorkbook({
                reference: existingReference,
                accountNumber: 'ACC-5002',
                amount: 500
            }),
            branchId: 5,
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' },
            fileName: 'cash-flow-existing-bind.xlsx'
        });
        assert.strictEqual(existingBindImport.imported, 0);
        assert.strictEqual(existingBindImport.duplicates, 1);
        assert.strictEqual(existingBindImport.gcashReconciliation.autoBoundReferences, 1);
        assert.strictEqual(existingBindImport.gcashReconciliation.existingPaymentBindings, 1);
        const existingBoundHistory = await listGcashTransactionHistory({ branchId: 5, all: true });
        const existingBoundTransaction = existingBoundHistory.transactions.find((row) => row.reference === 'EXISTINGBIND5005');
        assert.strictEqual(existingBoundTransaction.assignment.status, 'posted');
        assert.strictEqual(existingBoundTransaction.assignment.paymentEntryId, 'existing-payment-bind-5005');

        const editBindReference = 'EDIT-BIND-5005';
        const editBindEntryId = 'cf2026-cash-edit-bind-r2-5005';
        paymentStoreMemory['ACC-5001'].history.unshift({
            id: editBindEntryId,
            reference: 'CF2026-CA-EDIT-0002',
            amount: 625,
            date: '2026-08-08',
            recordedAt: '2026-08-08T12:00:00+08:00',
            kind: 'payment',
            type: 'payment',
            direction: 'credit',
            paymentMethod: 'Cash',
            description: 'Imported Cash payment from CASH AUG 2026; Excel row 2',
            fingerprint: 'ACC-5001|CF2026-CA-EDIT-0002|payment|625.00'
        });
        await importGcashTransactionBatch({
            branchId: 5,
            fileName: 'payment-history-edit-bind.pdf',
            pdfSha256: '8'.repeat(64),
            parsed: {
                ...parsed,
                transactions: [{
                    ...transaction,
                    reference: editBindReference,
                    credit: 625,
                    recipient: '09361565251'
                }]
            },
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
        });
        const beforeEditBindCount = Object.values(paymentStoreMemory).reduce((count, record) => (
            count + (Array.isArray(record?.history) ? record.history.length : 0)
        ), 0);
        const editBindOptions = await actualPaymentsRouter.getPaymentHistoryEditBindOptions({
            branchId: 5,
            accountNumber: 'ACC-5001',
            entryId: editBindEntryId
        });
        assert.strictEqual(editBindOptions.amount, 625);
        assert.strictEqual(editBindOptions.paymentDate, '2026-08-08');
        assert.deepStrictEqual(editBindOptions.transactions.map((row) => row.reference), ['EDITBIND5005']);
        const editBindResult = await actualPaymentsRouter.editAndBindPaymentHistoryEntry({
            branchId: 5,
            sourceAccountNumber: 'ACC-5001',
            entryId: editBindEntryId,
            targetAccountNumber: 'ACC-5002',
            gcashReference: editBindReference,
            assignmentConfirmed: true,
            editedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' }
        });
        assert.strictEqual(editBindResult.idempotent, false);
        assert.strictEqual(editBindResult.sourceAccountNumber, 'ACC-5001');
        assert.strictEqual(editBindResult.targetAccountNumber, 'ACC-5002');
        assert.strictEqual(editBindResult.reference, 'EDITBIND5005');
        assert.strictEqual(paymentStoreMemory['ACC-5001'].history.some((entry) => entry.id === editBindEntryId), false);
        const movedEditBindEntries = paymentStoreMemory['ACC-5002'].history.filter((entry) => entry.id === editBindEntryId);
        assert.strictEqual(movedEditBindEntries.length, 1);
        assert.strictEqual(movedEditBindEntries[0].amount, 625);
        assert.strictEqual(movedEditBindEntries[0].date, '2026-08-08');
        assert.strictEqual(movedEditBindEntries[0].reference, 'EDITBIND5005');
        assert.strictEqual(movedEditBindEntries[0].paymentMethod, 'GCash');
        assert(movedEditBindEntries[0].description.includes('[EDIT_BIND:'));
        assert.strictEqual(Object.values(paymentStoreMemory).reduce((count, record) => (
            count + (Array.isArray(record?.history) ? record.history.length : 0)
        ), 0), beforeEditBindCount);
        const editBindHistory = await listGcashTransactionHistory({ branchId: 5, all: true });
        const editedTransaction = editBindHistory.transactions.find((row) => row.reference === 'EDITBIND5005');
        assert.strictEqual(editedTransaction.assignment.status, 'posted');
        assert.strictEqual(editedTransaction.assignment.accountNumber, 'ACC-5002');
        assert.strictEqual(editedTransaction.assignment.paymentEntryId, editBindEntryId);
        const postedBindings = await actualPaymentsRouter.listPostedGcashPaymentBindings({ branchId: 5 });
        assert(postedBindings.some((binding) => (
            binding.paymentEntryId === editBindEntryId && binding.reference === 'EDITBIND5005'
        )));
        await assert.rejects(
            () => actualPaymentsRouter.getPaymentHistoryEditBindOptions({
                branchId: 5,
                accountNumber: 'ACC-5002',
                entryId: editBindEntryId
            }),
            (error) => {
                assert.strictEqual(error.status, 409);
                assert.strictEqual(error.code, 'PAYMENT_HISTORY_GCASH_BINDING_LOCKED');
                return true;
            }
        );

        const replacementReference = 'EDIT-BIND-REPLACEMENT-5005';
        await importGcashTransactionBatch({
            branchId: 5,
            fileName: 'payment-history-edit-bind-replacement.pdf',
            pdfSha256: 'ab'.repeat(32),
            parsed: {
                ...parsed,
                transactions: [{
                    ...transaction,
                    reference: replacementReference,
                    credit: 625,
                    recipient: '09361565251'
                }]
            },
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
        });
        const beforeReplacementCount = Object.values(paymentStoreMemory).reduce((count, record) => (
            count + (Array.isArray(record?.history) ? record.history.length : 0)
        ), 0);
        await assert.rejects(
            () => actualPaymentsRouter.editAndBindPaymentHistoryEntry({
                branchId: 5,
                sourceAccountNumber: 'ACC-5002',
                entryId: editBindEntryId,
                targetAccountNumber: 'ACC-5001',
                gcashReference: replacementReference,
                assignmentConfirmed: true,
                editedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' }
            }),
            (error) => {
                assert.strictEqual(error.status, 409);
                assert.strictEqual(error.code, 'PAYMENT_HISTORY_GCASH_BINDING_LOCKED');
                return true;
            }
        );
        assert.strictEqual(paymentStoreMemory['ACC-5001'].history.some((entry) => entry.id === editBindEntryId), false);
        const lockedEntries = paymentStoreMemory['ACC-5002'].history.filter((entry) => entry.id === editBindEntryId);
        assert.strictEqual(lockedEntries.length, 1);
        assert.strictEqual(lockedEntries[0].reference, 'EDITBIND5005');
        assert.strictEqual(lockedEntries[0].amount, 625);
        assert.strictEqual(lockedEntries[0].date, '2026-08-08');
        assert.strictEqual(Object.values(paymentStoreMemory).reduce((count, record) => (
            count + (Array.isArray(record?.history) ? record.history.length : 0)
        ), 0), beforeReplacementCount);
        const replacementHistory = await listGcashTransactionHistory({ branchId: 5, all: true });
        const lockedTransaction = replacementHistory.transactions.find((row) => row.reference === 'EDITBIND5005');
        const replacementTransaction = replacementHistory.transactions.find((row) => row.reference === 'EDITBINDREPLACEMENT5005');
        assert.strictEqual(lockedTransaction.assignment.status, 'posted');
        assert.strictEqual(lockedTransaction.assignment.accountNumber, 'ACC-5002');
        assert.strictEqual(lockedTransaction.assignment.paymentEntryId, editBindEntryId);
        assert.strictEqual(replacementTransaction.assignment, null);

        const reverseOrderReference = 'REVERSE-ORDER-5005';
        const reverseOrderPaymentImport = await actualPaymentsRouter.importPaymentRecordsFromExcel({
            buffer: makePaymentImportWorkbook({
                reference: reverseOrderReference,
                accountNumber: 'ACC-5001',
                amount: 650
            }),
            branchId: 5,
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' },
            fileName: 'cash-flow-before-gcash-history.xlsx'
        });
        assert.strictEqual(reverseOrderPaymentImport.imported, 1);
        assert.strictEqual(reverseOrderPaymentImport.gcashReconciliation.autoBoundReferences, 0);
        await importGcashTransactionBatch({
            branchId: 5,
            fileName: 'gcash-history-after-payment-history.pdf',
            pdfSha256: '4'.repeat(64),
            parsed: {
                ...parsed,
                transactions: [{
                    ...transaction,
                    reference: reverseOrderReference,
                    credit: 650,
                    recipient: '09361565251'
                }]
            },
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
        });
        const reverseOrderMatches = await actualPaymentsRouter.getExistingPaymentHistoryGcashMatches({ branchId: 5 });
        assert.strictEqual(reverseOrderMatches.exactReferences, 1);
        assert.strictEqual(reverseOrderMatches.matchesByReference.REVERSEORDER5005.status, 'exact_match');
        assert.strictEqual(reverseOrderMatches.matchesByReference.REVERSEORDER5005.allocations[0].customerName, 'Batch Customer 1');
        const reverseOrderReconciliation = await actualPaymentsRouter.reconcileExistingPaymentHistoryWithGcashTransactions({
            branchId: 5,
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' }
        });
        assert.strictEqual(reverseOrderReconciliation.autoBoundReferences, 1);
        assert.strictEqual(reverseOrderReconciliation.autoBoundRows, 1);
        const reverseOrderHistory = await listGcashTransactionHistory({ branchId: 5, all: true });
        const reverseOrderTransaction = reverseOrderHistory.transactions.find((row) => row.reference === 'REVERSEORDER5005');
        assert.strictEqual(reverseOrderTransaction.assignment.status, 'posted');
        assert.strictEqual(reverseOrderTransaction.assignment.accountNumber, 'ACC-5001');
        assert.strictEqual(reverseOrderTransaction.assignment.amount, 650);
        assert(reverseOrderTransaction.assignment.paymentEntryId);
        const reverseOrderLedgerEntries = Object.values(paymentStoreMemory).flatMap((record) => (
            Array.isArray(record?.history) ? record.history : []
        )).filter((entry) => entry.reference === reverseOrderReference);
        assert.strictEqual(reverseOrderLedgerEntries.length, 1);
        assert.strictEqual(reverseOrderTransaction.assignment.paymentEntryId, reverseOrderLedgerEntries[0].id);

        const reviewReference = 'REVIEW-SUGGESTION-5005';
        const reviewPaymentImport = await actualPaymentsRouter.importPaymentRecordsFromExcel({
            buffer: makePaymentImportWorkbook({
                reference: reviewReference,
                accountNumber: 'ACC-5003',
                amount: 450
            }),
            branchId: 5,
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' },
            fileName: 'cash-flow-review-suggestion.xlsx'
        });
        assert.strictEqual(reviewPaymentImport.imported, 1);
        await importGcashTransactionBatch({
            branchId: 5,
            fileName: 'gcash-history-review-suggestion.pdf',
            pdfSha256: '5'.repeat(64),
            parsed: {
                ...parsed,
                transactions: [{
                    ...transaction,
                    reference: reviewReference,
                    credit: 500,
                    recipient: '09361565251'
                }]
            },
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
        });
        const reviewMatches = await actualPaymentsRouter.getExistingPaymentHistoryGcashMatches({ branchId: 5 });
        const reviewSuggestion = reviewMatches.matchesByReference.REVIEWSUGGESTION5005;
        assert.strictEqual(reviewSuggestion.status, 'review_required');
        assert.strictEqual(reviewSuggestion.allocations[0].customerName, 'Batch Customer 3');
        assert.strictEqual(reviewSuggestion.allocations[0].amount, 450);
        assert(reviewSuggestion.reason.includes('total does not match'));
        const reviewReconciliation = await actualPaymentsRouter.reconcileExistingPaymentHistoryWithGcashTransactions({
            branchId: 5,
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' }
        });
        assert.strictEqual(reviewReconciliation.autoBoundReferences, 0);
        assert.strictEqual(reviewReconciliation.suggestedReferences, 1);
        const reviewLedgerEntries = Object.values(paymentStoreMemory).flatMap((record) => (
            Array.isArray(record?.history) ? record.history : []
        )).filter((entry) => entry.reference === reviewReference);
        assert.strictEqual(reviewLedgerEntries.length, 1);
        const reviewHistory = await listGcashTransactionHistory({ branchId: 5, all: true });
        assert.strictEqual(
            reviewHistory.transactions.find((row) => row.reference === 'REVIEWSUGGESTION5005').assignment,
            null
        );

        const legacyShortReference = '43891500420';
        const officialPaddedReference = '0043891500420';
        const legacyLeadingZeroImport = await actualPaymentsRouter.importPaymentRecordsFromExcel({
            buffer: makePaymentImportWorkbook({
                reference: legacyShortReference,
                accountNumber: 'ACC-5002',
                amount: 525
            }),
            branchId: 5,
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' },
            fileName: 'cash-flow-leading-zero-lost.xlsx'
        });
        assert.strictEqual(legacyLeadingZeroImport.imported, 1);
        assert.strictEqual(legacyLeadingZeroImport.gcashReconciliation.autoBoundReferences, 0);
        await importGcashTransactionBatch({
            branchId: 5,
            fileName: 'gcash-history-leading-zero-official.pdf',
            pdfSha256: '6'.repeat(64),
            parsed: {
                ...parsed,
                transactions: [{
                    ...transaction,
                    reference: officialPaddedReference,
                    credit: 525,
                    recipient: '09361565251'
                }]
            },
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
        });
        const leadingZeroRepair = await actualPaymentsRouter.reconcileExistingPaymentHistoryWithGcashTransactions({
            branchId: 5,
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' }
        });
        assert.strictEqual(leadingZeroRepair.autoBoundReferences, 1);
        assert.strictEqual(leadingZeroRepair.autoBoundRows, 1);
        const leadingZeroRepairHistory = await listGcashTransactionHistory({ branchId: 5, all: true });
        const repairedLeadingZeroTransaction = leadingZeroRepairHistory.transactions.find((row) => (
            row.reference === officialPaddedReference
        ));
        const repairedLeadingZeroLedgerEntries = Object.values(paymentStoreMemory).flatMap((record) => (
            Array.isArray(record?.history) ? record.history : []
        )).filter((entry) => entry.reference === legacyShortReference);
        assert.strictEqual(repairedLeadingZeroTransaction.assignment.status, 'posted');
        assert.strictEqual(repairedLeadingZeroTransaction.assignment.accountNumber, 'ACC-5002');
        assert.strictEqual(repairedLeadingZeroLedgerEntries.length, 1);
        assert.strictEqual(
            repairedLeadingZeroTransaction.assignment.paymentEntryId,
            repairedLeadingZeroLedgerEntries[0].id
        );

        const futureShortReference = '77770005005';
        const futureOfficialReference = '0077770005005';
        await importGcashTransactionBatch({
            branchId: 5,
            fileName: 'gcash-history-before-leading-zero-payment.pdf',
            pdfSha256: '7'.repeat(64),
            parsed: {
                ...parsed,
                transactions: [{
                    ...transaction,
                    reference: futureOfficialReference,
                    credit: 575,
                    recipient: '09361565251'
                }]
            },
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
        });
        const futureLeadingZeroImport = await actualPaymentsRouter.importPaymentRecordsFromExcel({
            buffer: makePaymentImportWorkbook({
                reference: futureShortReference,
                accountNumber: 'ACC-5003',
                amount: 575
            }),
            branchId: 5,
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' },
            fileName: 'cash-flow-leading-zero-canonicalized.xlsx'
        });
        assert.strictEqual(futureLeadingZeroImport.imported, 1);
        assert.strictEqual(futureLeadingZeroImport.gcashReconciliation.autoBoundReferences, 1);
        const futureLeadingZeroLedgerEntries = Object.values(paymentStoreMemory).flatMap((record) => (
            Array.isArray(record?.history) ? record.history : []
        )).filter((entry) => entry.reference === futureOfficialReference);
        assert.strictEqual(futureLeadingZeroLedgerEntries.length, 1);
        assert.strictEqual(
            Object.values(paymentStoreMemory).flatMap((record) => (
                Array.isArray(record?.history) ? record.history : []
            )).filter((entry) => entry.reference === futureShortReference).length,
            0
        );
        const futureLeadingZeroHistory = await listGcashTransactionHistory({ branchId: 5, all: true });
        const futureLeadingZeroTransaction = futureLeadingZeroHistory.transactions.find((row) => (
            row.reference === futureOfficialReference
        ));
        assert.strictEqual(futureLeadingZeroTransaction.assignment.status, 'posted');
        assert.strictEqual(
            futureLeadingZeroTransaction.assignment.paymentEntryId,
            futureLeadingZeroLedgerEntries[0].id
        );

        await importGcashTransactionBatch({
            branchId: 5,
            fileName: 'payment-history-conflict.pdf',
            pdfSha256: '3'.repeat(64),
            parsed: {
                ...parsed,
                transactions: [{
                    ...transaction,
                    reference: 'CONFLICT-BIND-5005',
                    credit: 800,
                    recipient: '09361565251'
                }]
            },
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
        });
        const conflictImport = await actualPaymentsRouter.importPaymentRecordsFromExcel({
            buffer: makePaymentImportWorkbook({
                reference: 'CONFLICT-BIND-5005',
                accountNumber: 'ACC-5003',
                amount: 700
            }),
            branchId: 5,
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' },
            fileName: 'cash-flow-conflict.xlsx'
        });
        assert.strictEqual(conflictImport.imported, 0);
        assert.strictEqual(conflictImport.gcashReconciliation.conflictReferences, 1);
        assert.strictEqual(conflictImport.gcashReconciliation.conflictRows, 1);
        assert(conflictImport.warnings.some((warning) => warning.reference === 'CONFLICTBIND5005'));
        const conflictLedgerEntries = Object.values(paymentStoreMemory).flatMap((record) => (
            Array.isArray(record?.history) ? record.history : []
        )).filter((entry) => entry.reference === 'CONFLICT-BIND-5005');
        assert.strictEqual(conflictLedgerEntries.length, 0);
        const conflictHistory = await listGcashTransactionHistory({ branchId: 5, all: true });
        assert.strictEqual(
            conflictHistory.transactions.find((row) => row.reference === 'CONFLICTBIND5005').assignment,
            null
        );
    } finally {
        fs.promises.mkdir = originalMkdir;
        fs.promises.writeFile = originalWriteFile;
    }

    const relationalInsertedEntries = [];
    const relationalReferenceChecks = [];
    let relationalEditRow = {
        id: 'cf2026-cash-relational-edit-7007',
        branchId: 7,
        accountNumber: 'ACC-5001',
        amount: 725,
        date: '2026-08-08',
        kind: 'payment',
        direction: 'credit',
        reference: 'CF2026-CA-EDIT-7007',
        orNumber: 'OR-EDIT-7007',
        description: 'Imported Cash payment from CASH AUG 2026; Excel row 7',
        type: 'payment',
        recordedAt: '2026-08-08 12:00:00',
        recordedByUserId: 'excel-import',
        recordedByUsername: 'excel-import',
        recordedByName: 'Excel Import',
        recordedByRole: 'System',
        payer: 'Batch Customer 1',
        status: 'paid',
        paymentMethod: 'Cash',
        fingerprint: 'ACC-5001|CF2026-CA-EDIT-7007|payment|725.00',
        xenditId: null
    };
    let relationalOrSequence = 0;
    const dbModulePath = require.resolve(path.join(projectRoot, 'core/data/db'));
    const originalDbExports = require.cache[dbModulePath]?.exports || require(dbModulePath);
    const paymentNumberingModulePath = require.resolve('../backend/payment-numbering');
    require.cache[relationalModulePath].exports = { isRelationalReady: async () => true };
    require.cache[dbModulePath].exports = {
        ...originalDbExports,
        query: async (sql, params = []) => {
            if (/FROM payment_entries/i.test(sql) && Number(params[0]) === 7) {
                return [[{ ...relationalEditRow }], []];
            }
            return [[], []];
        }
    };
    require.cache[paymentNumberingModulePath] = {
        id: paymentNumberingModulePath,
        filename: paymentNumberingModulePath,
        loaded: true,
        exports: {
            assignEntryNumbers: async (_connection, entry) => {
                relationalOrSequence += 1;
                entry.orNumber = `OR-MOCK-${relationalOrSequence}`;
                return entry;
            },
            assertEntryNumbersAvailable: async (_connection, _branchId, entry) => {
                relationalReferenceChecks.push(entry.reference || null);
            },
            enqueuePaymentMutation: async (work) => work(),
            ensurePaymentNumberingStore: async () => {},
            lockPaymentAccount: async () => {},
            serializePaymentMutationRequest: (_req, _res, next) => next(),
            withTransaction: async (work) => {
                const staged = [];
                const connection = {
                    query: async (sql, params = []) => {
                        if (/FROM payment_entries/i.test(sql) && /account_number = \? AND id = \?/i.test(sql) && Number(params[0]) === 7) {
                            return [[{ ...relationalEditRow }], []];
                        }
                        if (/SELECT id, reference, or_number AS orNumber/i.test(sql) && Number(params[0]) === 7) {
                            return [[], []];
                        }
                        if (/UPDATE payment_entries/i.test(sql) && Number(params[5]) === 7) {
                            relationalEditRow = {
                                ...relationalEditRow,
                                accountNumber: params[0],
                                reference: params[1],
                                description: params[2],
                                paymentMethod: params[3],
                                fingerprint: params[4]
                            };
                            return [{ affectedRows: 1 }, []];
                        }
                        if (/INSERT INTO payment_entries/i.test(sql)) {
                            staged.push({
                                id: params[0],
                                accountNumber: params[2],
                                date: params[4],
                                reference: params[7],
                                orNumber: params[8],
                                description: params[9],
                                recordedAt: params[11],
                                fingerprint: params[19]
                            });
                        }
                        return [[], []];
                    }
                };
                const result = await work(connection);
                relationalInsertedEntries.push(...staged);
                return result;
            }
        }
    };
    delete require.cache[paymentsModulePath];
    const relationalPaymentsRouter = require('../backend/payments');
    const relationalBatchWrite = await relationalPaymentsRouter.recordApprovedProofPayments({
        submissionId: 'batch-writer-5006',
        source: 'gcash-history',
        branchId: 5,
        amount: 1000,
        reference: 'BATCH-WRITER-5006',
        date: '2026-08-08',
        paymentReceivedAt: officialTransactionAt,
        reviewer: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' },
        allocations: [
            { accountNumber: 'ACC-5001', billingMonth: '2026-08', amount: 300 },
            { accountNumber: 'ACC-5002', billingMonth: '2026-08', amount: 300 },
            { accountNumber: 'ACC-5003', billingMonth: '2026-08', amount: 400 }
        ]
    });
    assert.strictEqual(relationalBatchWrite.inserted, true);
    assert.strictEqual(relationalInsertedEntries.length, 3);
    assert.deepStrictEqual(relationalInsertedEntries.map((entry) => entry.reference), [
        'BATCH-WRITER-5006',
        'BATCH-WRITER-5006',
        'BATCH-WRITER-5006'
    ]);
    assert.deepStrictEqual(relationalReferenceChecks, ['BATCH-WRITER-5006', null, null]);
    assert(relationalInsertedEntries.slice(0, 3).every((entry) => entry.date === '2026-08-08'));
    assert(relationalInsertedEntries.slice(0, 3).every((entry) => !entry.description.includes('[GCASH_RECEIVED_AT:')));
    assert(relationalInsertedEntries.slice(0, 3).every((entry) => entry.fingerprint.includes(`[GCASH_RECEIVED_AT:${officialTransactionAt}]`)));
    assert(relationalInsertedEntries.slice(0, 3).every((entry) => !String(entry.recordedAt).includes('2026-08-08 17:45:00')));
    await importGcashTransactionBatch({
        branchId: 6,
        fileName: 'relational-payment-history-auto-bind.pdf',
        pdfSha256: '2'.repeat(64),
        parsed: {
            ...parsed,
            transactions: [{
                ...transaction,
                reference: 'RELATIONAL-IMPORT-6006',
                credit: 1000,
                recipient: '09361565251'
            }]
        },
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    fs.promises.mkdir = async () => {};
    fs.promises.writeFile = async () => {};
    let relationalImport;
    try {
        relationalImport = await relationalPaymentsRouter.importPaymentRecordsFromExcel({
            buffer: makePaymentImportWorkbook({
                reference: 'RELATIONAL-IMPORT-6006',
                accountNumber: 'ACC-5001',
                amount: 1000
            }),
            branchId: 6,
            importedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' },
            fileName: 'relational-cash-flow-auto-bind.xlsx'
        });
    } finally {
        fs.promises.mkdir = originalMkdir;
        fs.promises.writeFile = originalWriteFile;
    }
    assert.strictEqual(relationalImport.imported, 1);
    assert.strictEqual(relationalImport.gcashReconciliation.autoBoundReferences, 1);
    assert.strictEqual(relationalImport.gcashReconciliation.newPaymentBindings, 1);
    assert.strictEqual(relationalInsertedEntries.length, 4);
    assert.strictEqual(relationalInsertedEntries[3].reference, 'RELATIONAL-IMPORT-6006');
    assert.deepStrictEqual(relationalReferenceChecks, [
        'BATCH-WRITER-5006',
        null,
        null,
        'RELATIONAL-IMPORT-6006'
    ]);
    const relationalImportHistory = await listGcashTransactionHistory({ branchId: 6, all: true });
    assert.strictEqual(relationalImportHistory.transactions[0].assignment.status, 'posted');
    assert.strictEqual(relationalImportHistory.transactions[0].assignment.accountNumber, 'ACC-5001');
    assert.strictEqual(relationalImportHistory.transactions[0].assignment.paymentEntryId, relationalInsertedEntries[3].id);
    await importGcashTransactionBatch({
        branchId: 7,
        fileName: 'relational-payment-history-edit-bind.pdf',
        pdfSha256: '9'.repeat(64),
        parsed: {
            ...parsed,
            transactions: [{
                ...transaction,
                reference: 'RELATIONAL-EDIT-7007',
                credit: 725,
                recipient: '09361565251'
            }]
        },
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    fs.promises.mkdir = async () => {};
    fs.promises.writeFile = async () => {};
    let relationalEditBind;
    try {
        relationalEditBind = await relationalPaymentsRouter.editAndBindPaymentHistoryEntry({
            branchId: 7,
            sourceAccountNumber: 'ACC-5001',
            entryId: relationalEditRow.id,
            targetAccountNumber: 'ACC-5003',
            gcashReference: 'RELATIONAL-EDIT-7007',
            assignmentConfirmed: true,
            editedBy: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin' }
        });
    } finally {
        fs.promises.mkdir = originalMkdir;
        fs.promises.writeFile = originalWriteFile;
    }
    assert.strictEqual(relationalEditBind.idempotent, false);
    assert.strictEqual(relationalEditBind.targetAccountNumber, 'ACC-5003');
    assert.strictEqual(relationalEditRow.accountNumber, 'ACC-5003');
    assert.strictEqual(relationalEditRow.reference, 'RELATIONALEDIT7007');
    assert.strictEqual(relationalEditRow.paymentMethod, 'GCash');
    assert.strictEqual(relationalEditRow.amount, 725);
    assert.strictEqual(relationalEditRow.date, '2026-08-08');
    assert.strictEqual(relationalEditRow.orNumber, 'OR-EDIT-7007');
    assert(relationalEditRow.description.includes('[EDIT_BIND:'));
    assert.strictEqual(relationalInsertedEntries.length, 4);
    const relationalEditHistory = await listGcashTransactionHistory({ branchId: 7, all: true });
    assert.strictEqual(relationalEditHistory.transactions[0].assignment.status, 'posted');
    assert.strictEqual(relationalEditHistory.transactions[0].assignment.accountNumber, 'ACC-5003');
    assert.strictEqual(relationalEditHistory.transactions[0].assignment.paymentEntryId, relationalEditRow.id);
    require.cache[dbModulePath].exports = originalDbExports;

    let paymentWriteCount = 0;
    const paymentWritePayloads = [];
    const paymentRecordsModulePath = require.resolve('../backend/payment-records');
    require.cache[paymentsModulePath] = {
        id: paymentsModulePath,
        filename: paymentsModulePath,
        loaded: true,
        exports: {
            recordApprovedProofPayments: async (payload) => {
                paymentWriteCount += 1;
                paymentWritePayloads.push(payload);
                assert.strictEqual(payload.source, 'gcash-history');
                assert.strictEqual(payload.date, '2026-08-08');
                assert.strictEqual(payload.paymentReceivedAt, officialTransactionAt);
                assert.strictEqual(payload.postingDate, currentPostingDate);
                if (payload.reference === 'DIRECTPOST1001') {
                    assert.strictEqual(payload.amount, 1000);
                    assert.strictEqual(payload.allocations.length, 3);
                    assert.deepStrictEqual(payload.allocations.map((allocation) => allocation.amount), [300, 300, 400]);
                    assert.deepStrictEqual(payload.allocations.map((allocation) => allocation.billingMonth), [
                        currentBillingMonth,
                        currentBillingMonth,
                        currentBillingMonth
                    ]);
                    assert(payload.allocations.every((allocation) => allocation.isAdvancePayment === false));
                    assert(payload.allocations.every((allocation) => allocation.description.includes('current billing cycle')));
                } else if (payload.reference === 'DIRECTADVANCE1002') {
                    assert.strictEqual(payload.reference, 'DIRECTADVANCE1002');
                    assert.strictEqual(payload.amount, 500);
                    assert.strictEqual(payload.allocations.length, 1);
                    assert.strictEqual(payload.allocations[0].accountNumber, 'ACC-PAID');
                    assert.strictEqual(payload.allocations[0].amount, 500);
                    assert.strictEqual(payload.allocations[0].billingMonth, currentBillingMonth);
                    assert.strictEqual(payload.allocations[0].isAdvancePayment, true);
                    assert(payload.allocations[0].description.includes('advance payment'));
                } else {
                    assert.strictEqual(payload.reference, 'DIRECTOVERPAY1004');
                    assert.strictEqual(payload.amount, 810);
                    assert.strictEqual(payload.allocations.length, 1);
                    assert.strictEqual(payload.allocations[0].accountNumber, 'ACC-OVERPAY');
                    assert.strictEqual(payload.allocations[0].amount, 810);
                    assert.strictEqual(payload.allocations[0].endingBalanceBefore, 800);
                    assert.strictEqual(payload.allocations[0].balanceApplied, 800);
                    assert.strictEqual(payload.allocations[0].advanceAmount, 10);
                    assert.strictEqual(payload.allocations[0].isAdvancePayment, false);
                    assert.strictEqual(payload.allocations[0].includesAdvanceCredit, true);
                    assert(payload.allocations[0].description.includes('PHP 800.00 applied'));
                    assert(payload.allocations[0].description.includes('PHP 10.00 recorded as advance credit'));
                }
                return {
                    inserted: true,
                    entries: payload.allocations.map((allocation, index) => ({
                        id: `proof-${payload.reference.toLowerCase()}-${index + 1}`,
                        accountNumber: allocation.accountNumber,
                        amount: allocation.amount
                    }))
                };
            }
        }
    };
    require.cache[paymentRecordsModulePath] = {
        id: paymentRecordsModulePath,
        filename: paymentRecordsModulePath,
        loaded: true,
        exports: {
            buildPaymentRecordForAccount: async (accountNumber, branchId) => ({
                accountNumber,
                name: `Direct Post Customer ${accountNumber}`,
                branchId,
                billingSummary: {
                    available: true,
                    endingBalance: ({
                        'ACC-3001': 300,
                        'ACC-3002': 300,
                        'ACC-3003': 400,
                        'ACC-PAID': 0,
                        'ACC-OVERPAY': 800
                    }[accountNumber] ?? 1000),
                    currentCycle: {
                        billingMonthKey: currentBillingMonth,
                        paymentStatus: accountNumber === 'ACC-PAID' ? 'paid' : 'unpaid',
                        balanceAfterPayment: accountNumber === 'ACC-PAID' ? 0 : 1000
                    },
                    rows: []
                }
            })
        }
    };
    const paymentConfirmationsRouter = require('../backend/payment-confirmations');
    const directPostLayer = paymentConfirmationsRouter.stack.find((layer) => (
        layer.route?.path === '/gcash-history/:reference/post-payment'
    ));
    assert(directPostLayer, 'direct imported-history payment route must be registered');
    const directPostHandler = directPostLayer.route.stack[directPostLayer.route.stack.length - 1].handle;
    const invokeDirectPost = async (body, reference = 'DIRECT-POST-1001') => {
        const result = { statusCode: 200, payload: null };
        const response = {
            status(code) {
                result.statusCode = code;
                return this;
            },
            json(payload) {
                result.payload = payload;
                return this;
            }
        };
        await directPostHandler({
            branchId: 3,
            params: { reference },
            body,
            user: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin', branchId: 3 }
        }, response, (error) => {
            throw error;
        });
        return result;
    };

    await assert.rejects(
        () => invokeDirectPost({
            accountNumber: 'ACC-3003',
            amount: 750,
            assignmentConfirmed: true
        }, 'DIRECT-LOCK-1003'),
        (error) => error?.code === 'GCASH_TRANSACTION_POSTING_LOCKED'
    );
    assert.strictEqual(paymentWriteCount, 0);

    const amountMismatch = await invokeDirectPost({
        accountNumber: 'ACC-3003',
        amount: 999,
        assignmentConfirmed: true
    });
    assert.strictEqual(amountMismatch.statusCode, 409);
    assert.strictEqual(amountMismatch.payload.code, 'GCASH_IMPORTED_AMOUNT_MISMATCH');
    assert.strictEqual(paymentWriteCount, 0);

    const allocationMismatch = await invokeDirectPost({
        amount: 1000,
        allocations: [
            { accountNumber: 'ACC-3001', amount: 300 },
            { accountNumber: 'ACC-3002', amount: 300 },
            { accountNumber: 'ACC-3003', amount: 300 }
        ],
        assignmentConfirmed: true
    });
    assert.strictEqual(allocationMismatch.statusCode, 409);
    assert.strictEqual(allocationMismatch.payload.code, 'GCASH_ALLOCATION_TOTAL_MISMATCH');
    assert.strictEqual(paymentWriteCount, 0);

    const advanceConfirmationMissing = await invokeDirectPost({
        amount: 810,
        allocations: [
            { accountNumber: 'ACC-OVERPAY', amount: 810 }
        ],
        assignmentConfirmed: true
    }, 'DIRECT-OVERPAY-1004');
    assert.strictEqual(advanceConfirmationMissing.statusCode, 400);
    assert.strictEqual(advanceConfirmationMissing.payload.code, 'GCASH_ADVANCE_CONFIRMATION_REQUIRED');
    assert.strictEqual(advanceConfirmationMissing.payload.advanceTotal, 10);
    assert.strictEqual(advanceConfirmationMissing.payload.allocations[0].endingBalanceBefore, 800);
    assert.strictEqual(advanceConfirmationMissing.payload.allocations[0].balanceApplied, 800);
    assert.strictEqual(advanceConfirmationMissing.payload.allocations[0].advanceAmount, 10);
    assert.strictEqual(paymentWriteCount, 0);

    const directPost = await invokeDirectPost({
        amount: 1000,
        allocations: [
            { accountNumber: 'ACC-3001', amount: 300 },
            { accountNumber: 'ACC-3002', amount: 300 },
            { accountNumber: 'ACC-3003', amount: 400 }
        ],
        assignmentConfirmed: true
    });
    assert.strictEqual(directPost.statusCode, 201);
    assert.strictEqual(directPost.payload.assignment.status, 'posted');
    assert.strictEqual(directPost.payload.assignment.accountNumber, '');
    assert.strictEqual(directPost.payload.assignment.allocations.length, 3);
    assert.deepStrictEqual(directPost.payload.assignment.allocations.map((allocation) => allocation.amount), [300, 300, 400]);
    assert.deepStrictEqual(directPost.payload.assignment.allocations.map((allocation) => allocation.billingMonth), [
        currentBillingMonth,
        currentBillingMonth,
        currentBillingMonth
    ]);
    assert.strictEqual(directPost.payload.assignment.paymentDate, '2026-08-08');
    assert.strictEqual(directPost.payload.paymentEntryIds.length, 3);
    assert.strictEqual(paymentWriteCount, 1);

    const retry = await invokeDirectPost({
        amount: 1000,
        allocations: [
            { accountNumber: 'ACC-3001', amount: 300 },
            { accountNumber: 'ACC-3002', amount: 300 },
            { accountNumber: 'ACC-3003', amount: 400 }
        ],
        assignmentConfirmed: true
    });
    assert.strictEqual(retry.statusCode, 200);
    assert.strictEqual(retry.payload.idempotent, true);
    assert.strictEqual(paymentWriteCount, 1);

    const advancePost = await invokeDirectPost({
        amount: 500,
        allocations: [
            { accountNumber: 'ACC-PAID', amount: 500 }
        ],
        advanceConfirmed: true,
        assignmentConfirmed: true
    }, 'DIRECT-ADVANCE-1002');
    assert.strictEqual(advancePost.statusCode, 201);
    assert.strictEqual(advancePost.payload.assignment.status, 'posted');
    assert.strictEqual(advancePost.payload.assignment.allocations.length, 1);
    assert.strictEqual(advancePost.payload.assignment.allocations[0].accountNumber, 'ACC-PAID');
    assert.strictEqual(advancePost.payload.assignment.allocations[0].amount, 500);
    assert.strictEqual(paymentWriteCount, 2);
    assert.strictEqual(paymentWritePayloads[1].allocations[0].isAdvancePayment, true);

    const overpaymentPost = await invokeDirectPost({
        amount: 810,
        allocations: [
            { accountNumber: 'ACC-OVERPAY', amount: 810 }
        ],
        advanceConfirmed: true,
        assignmentConfirmed: true
    }, 'DIRECT-OVERPAY-1004');
    assert.strictEqual(overpaymentPost.statusCode, 201);
    assert.strictEqual(overpaymentPost.payload.assignment.status, 'posted');
    assert.strictEqual(overpaymentPost.payload.assignment.advanceConfirmed, true);
    assert.strictEqual(overpaymentPost.payload.assignment.allocations.length, 1);
    assert.strictEqual(overpaymentPost.payload.assignment.allocations[0].accountNumber, 'ACC-OVERPAY');
    assert.strictEqual(overpaymentPost.payload.assignment.allocations[0].amount, 810);
    assert.strictEqual(overpaymentPost.payload.assignment.allocations[0].endingBalanceBefore, 800);
    assert.strictEqual(overpaymentPost.payload.assignment.allocations[0].balanceApplied, 800);
    assert.strictEqual(overpaymentPost.payload.assignment.allocations[0].advanceAmount, 10);
    assert.strictEqual(paymentWriteCount, 3);
    assert.strictEqual(paymentWritePayloads[2].allocations[0].balanceApplied, 800);
    assert.strictEqual(paymentWritePayloads[2].allocations[0].advanceAmount, 10);

    const overpaymentBreakdown = calculatePaymentBreakdownEndingBalance({
        accountNumber: 'ACC-OVERPAY',
        planCategory: 'prepaid',
        planAmount: 800,
        history: [
            {
                id: `bill-ACC-OVERPAY-${currentBillingMonth}`,
                amount: 800,
                date: `${currentBillingMonth}-01`,
                kind: 'bill',
                direction: 'debit',
                description: 'Monthly bill'
            },
            {
                id: 'proof-directoverpay1004',
                amount: 810,
                date: currentPostingDate,
                kind: 'payment',
                direction: 'credit',
                paymentMethod: 'gcash',
                description: `Imported GCash payment: PHP 800.00 applied to current billing cycle ${currentBillingMonth}; PHP 10.00 recorded as advance credit`
            }
        ]
    });
    assert.strictEqual(overpaymentBreakdown.endingBalance, -10);
    assert.strictEqual(overpaymentBreakdown.rows.at(-1).amountPaid, 810);

    const officialDisplayBreakdown = calculatePaymentBreakdownEndingBalance({
        accountNumber: 'ACC-OFFICIAL-DATE',
        planCategory: 'prepaid',
        planAmount: 1000,
        history: [
            {
                id: 'bill-2026-08',
                amount: 1000,
                date: '2026-08-01',
                kind: 'bill',
                direction: 'debit',
                description: 'Monthly bill'
            },
            {
                id: 'bill-2026-09',
                amount: 1000,
                date: '2026-09-01',
                kind: 'bill',
                direction: 'debit',
                description: 'Monthly bill'
            },
            {
                id: 'proof-official-display-date',
                amount: 1000,
                date: '2026-08-31',
                recordedAt: '2026-09-05T10:00:00+08:00',
                kind: 'payment',
                direction: 'credit',
                paymentMethod: 'gcash',
                description: 'Imported GCash payment posted to current billing cycle 2026-09',
                fingerprint: 'ACC-OFFICIAL-DATE|OFFICIAL-DATE|gcash-history|1000.00|proof-official-display-date [GCASH_RECEIVED_AT:2026-08-31T23:45:00+08:00]'
            }
        ]
    });
    const augustDisplayRow = officialDisplayBreakdown.rows.find((row) => row.billingMonthKey === '2026-08');
    const septemberDisplayRow = officialDisplayBreakdown.rows.find((row) => row.billingMonthKey === '2026-09');
    assert.strictEqual(augustDisplayRow.amountPaid, 0);
    assert.strictEqual(septemberDisplayRow.amountPaid, 1000);
    assert.strictEqual(septemberDisplayRow.paymentDetails.length, 1);
    assert.strictEqual(septemberDisplayRow.paymentDetails[0].date, '2026-08-31T15:45:00.000Z');

    console.log('PASS GCash history de-duplication, recipient labels, immutable account/cycle assignment, and guarded posting UI contracts');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
