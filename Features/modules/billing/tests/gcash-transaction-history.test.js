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
const {
    parseGcashTextPages
} = require('../backend/gcash-pdf-parser');

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
    claimGcashTransaction,
    claimGcashTransactionAllocations,
    finalizeGcashTransactionAssignment,
    finalizeGcashTransactionAllocations,
    releaseGcashTransactionClaim,
    updateGcashTransactionRemark,
    listGcashTransactionHistory,
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
    path.join(projectRoot, 'Features/modules/billing/web/payment-confirmation-queue.html'),
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
assert(routeSource.includes("code: 'GCASH_IMPORTED_AMOUNT_MISMATCH'"));
assert(routeSource.includes("code: 'GCASH_ALLOCATION_TOTAL_MISMATCH'"));
assert(routeSource.includes('claimGcashTransactionAllocations'));
assert(routeSource.includes('finalizeGcashTransactionAllocations'));
assert(routeSource.includes("code: 'GCASH_CURRENT_BILLING_CYCLE_UNAVAILABLE'"));
assert(routeSource.includes("code: 'GCASH_ALLOCATION_EXCEEDS_ENDING_BALANCE'"));
assert(routeSource.includes('const isAdvancePayment = endingBalance <= 0.009'));
assert(routeSource.includes('Imported GCash advance payment allocation'));
assert(routeSource.includes('date: postingDate'));
assert(routeSource.includes('buildPaymentRecordForAccount'));
assert(routeSource.includes("code: 'GCASH_HISTORY_MATCH_REQUIRED'"));
assert(routeSource.includes('gcashApproval && !gcashMatch?.matched'));
assert(routeSource.includes('claimGcashTransaction'));
assert(routeSource.includes('finalizeGcashTransactionAssignment'));
assert(routeSource.includes("code: 'PAYMENT_ASSIGNMENT_CONFIRMATION_REQUIRED'"));
assert(routeSource.includes("code: 'GCASH_SCREENSHOT_CONFLICT'"));
assert(routeSource.includes('assertLockedGcashApproval'));
assert(routeSource.includes('existing reference(s) skipped'));
assert(!routeSource.includes('/gcash-gmail/'));
assert(!routeSource.includes('gcash-notification-bridge-store'));
assert(htmlSource.includes('id="queueImportGcashHistoryBtn"'));
assert(htmlSource.includes('never approves a payment automatically'));
assert(htmlSource.includes('id="queueGcashHistoryBody"'));
assert(htmlSource.includes('Imported GCash Transactions'));
assert(htmlSource.includes('<h1>GCash Reconciliation</h1>'));
assert(htmlSource.includes('Import statements, bind credits, and classify debits.'));
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
assert(htmlSource.includes('Paid clients can receive advance payments.'));
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
assert(htmlSource.includes('id="queueGcashStatDebit"'));
assert(htmlSource.includes('class="btn btn-outline-secondary btn-sm" id="queueGcashHistoryRefreshBtn"'));
assert(htmlSource.includes('class="btn btn-primary btn-sm" id="queueImportGcashHistoryBtn"'));
assert(htmlSource.includes('id="queueGcashHistorySearch"'));
assert(htmlSource.includes('id="queueGcashHistoryFilter"'));
assert(htmlSource.includes('<option value="available">Available credits</option>'));
assert(htmlSource.includes('<option value="posted">Posted credits</option>'));
assert(htmlSource.includes('<option value="debit">Debit records</option>'));
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
assert(browserSource.includes("fetch('/api/payment-confirmations/gcash-history?limit=500'"));
assert(browserSource.includes('/post-payment`'));
assert(browserSource.includes('Bind &amp; Post'));
assert(browserSource.includes('class="btn btn-icon btn-primary btn-sm" data-action="post-gcash"'));
assert(browserSource.includes('transaction.recipientLabel'));
assert(browserSource.includes('transaction.description'));
assert(browserSource.includes('No pending customer proof submissions. Imported GCash transactions are shown below.'));
assert(browserSource.includes('await Promise.all([fetchQueue(), fetchGcashHistory()])'));
assert(browserSource.includes('assignmentConfirmed: isGcash ? true : undefined'));
assert(!browserSource.includes('Assigned and Posted'));
assert(browserSource.includes('class="gcash-match-list"'));
assert(browserSource.includes('class="gcash-match-allocation"'));
assert(browserSource.includes('class="gcash-match-name"'));
assert(browserSource.includes('class="gcash-match-amount"'));
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
assert(browserSource.includes('No imported transactions match the current search and status filter.'));
assert(browserSource.includes("gcashHistorySearch?.addEventListener('input'"));
assert(browserSource.includes("gcashHistoryFilter?.addEventListener('change'"));
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

(async () => {
    await importGcashTransactionBatch({
        branchId: 1,
        fileName: 'fixture.pdf',
        pdfSha256: 'a'.repeat(64),
        parsed,
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    const initialBranchHistory = await listGcashTransactionHistory({ branchId: 1, all: true });
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
                }
            ]
        },
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });

    const batchCustomers = ['ACC-5001', 'ACC-5002', 'ACC-5003'].map((accountNumber, index) => ({
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
    const batchWrite = await actualPaymentsRouter.recordApprovedProofPayments({
        submissionId: 'batch-writer-5005',
        source: 'gcash-history',
        branchId: 5,
        amount: 1000,
        reference: 'BATCH-WRITER-5005',
        date: '2026-08-08',
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
    const batchRetry = await actualPaymentsRouter.recordApprovedProofPayments({
        submissionId: 'batch-writer-5005',
        source: 'gcash-history',
        branchId: 5,
        amount: 1000,
        reference: 'BATCH-WRITER-5005',
        date: '2026-08-08',
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

    const relationalInsertedEntries = [];
    const relationalReferenceChecks = [];
    let relationalOrSequence = 0;
    const dbModulePath = require.resolve(path.join(projectRoot, 'core/data/db'));
    const originalDbExports = require.cache[dbModulePath]?.exports || require(dbModulePath);
    const paymentNumberingModulePath = require.resolve('../backend/payment-numbering');
    require.cache[relationalModulePath].exports = { isRelationalReady: async () => true };
    require.cache[dbModulePath].exports = { ...originalDbExports, query: async () => [[], []] };
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
            withTransaction: async (work) => {
                const staged = [];
                const connection = {
                    query: async (sql, params = []) => {
                        if (/INSERT INTO payment_entries/i.test(sql)) {
                            staged.push({
                                id: params[0],
                                accountNumber: params[2],
                                reference: params[7],
                                orNumber: params[8]
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
                assert.strictEqual(payload.date, currentPostingDate);
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
                } else {
                    assert.strictEqual(payload.reference, 'DIRECTADVANCE1002');
                    assert.strictEqual(payload.amount, 500);
                    assert.strictEqual(payload.allocations.length, 1);
                    assert.strictEqual(payload.allocations[0].accountNumber, 'ACC-PAID');
                    assert.strictEqual(payload.allocations[0].amount, 500);
                    assert.strictEqual(payload.allocations[0].billingMonth, currentBillingMonth);
                    assert.strictEqual(payload.allocations[0].isAdvancePayment, true);
                    assert(payload.allocations[0].description.includes('advance payment'));
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
                        'ACC-PAID': 0
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

    const endingBalanceMismatch = await invokeDirectPost({
        amount: 1000,
        allocations: [
            { accountNumber: 'ACC-3001', amount: 301 },
            { accountNumber: 'ACC-3002', amount: 299 },
            { accountNumber: 'ACC-3003', amount: 400 }
        ],
        assignmentConfirmed: true
    });
    assert.strictEqual(endingBalanceMismatch.statusCode, 409);
    assert.strictEqual(endingBalanceMismatch.payload.code, 'GCASH_ALLOCATION_EXCEEDS_ENDING_BALANCE');
    assert.strictEqual(endingBalanceMismatch.payload.endingBalance, 300);
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
    assert.strictEqual(directPost.payload.assignment.paymentDate, currentPostingDate);
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
        assignmentConfirmed: true
    }, 'DIRECT-ADVANCE-1002');
    assert.strictEqual(advancePost.statusCode, 201);
    assert.strictEqual(advancePost.payload.assignment.status, 'posted');
    assert.strictEqual(advancePost.payload.assignment.allocations.length, 1);
    assert.strictEqual(advancePost.payload.assignment.allocations[0].accountNumber, 'ACC-PAID');
    assert.strictEqual(advancePost.payload.assignment.allocations[0].amount, 500);
    assert.strictEqual(paymentWriteCount, 2);
    assert.strictEqual(paymentWritePayloads[1].allocations[0].isAdvancePayment, true);

    console.log('PASS GCash history de-duplication, recipient labels, immutable account/cycle assignment, and guarded posting UI contracts');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
