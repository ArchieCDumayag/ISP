const assert = require('assert');
const fs = require('fs');
const path = require('path');
const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const {
    parseGcashTextPages
} = require('../backend/gcash-pdf-parser');

let historyStoreMemory = { version: 2, branches: {} };
const dataStoreModulePath = require.resolve(path.join(projectRoot, 'core/data/data-store'));
require.cache[dataStoreModulePath] = {
    id: dataStoreModulePath,
    filename: dataStoreModulePath,
    loaded: true,
    exports: {
        readJson: async () => historyStoreMemory,
        writeJson: async (_key, value) => {
            historyStoreMemory = value;
        }
    }
};
const {
    evaluateGcashTransactionMatch,
    phoneMatches,
    importGcashTransactionBatch,
    claimGcashTransaction,
    finalizeGcashTransactionAssignment,
    releaseGcashTransactionClaim,
    listGcashTransactionHistory
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
    item('17311.82', 465, 684)
];

const parsed = parseGcashTextPages([{ items: fixtureItems }]);
assert.strictEqual(parsed.title, 'GCash Transaction History');
assert.strictEqual(parsed.statementFrom, '2026-08-03');
assert.strictEqual(parsed.statementTo, '2026-08-09');
assert.strictEqual(parsed.transactions.length, 1);
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
assert(routeSource.includes("'/gcash-history/import'"));
assert(routeSource.includes("code: 'GCASH_HISTORY_MATCH_REQUIRED'"));
assert(routeSource.includes('gcashApproval && !gcashMatch?.matched'));
assert(routeSource.includes('claimGcashTransaction'));
assert(routeSource.includes('finalizeGcashTransactionAssignment'));
assert(routeSource.includes("code: 'PAYMENT_ASSIGNMENT_CONFIRMATION_REQUIRED'"));
assert(routeSource.includes("code: 'GCASH_SCREENSHOT_CONFLICT'"));
assert(routeSource.includes('assertLockedGcashApproval'));
assert(!routeSource.includes('/gcash-gmail/'));
assert(!routeSource.includes('gcash-notification-bridge-store'));
assert(htmlSource.includes('id="queueImportGcashHistoryBtn"'));
assert(htmlSource.includes('never approves a payment automatically'));
assert(htmlSource.includes('id="queueGcashHistoryBody"'));
assert(htmlSource.includes('Imported GCash Transactions'));
assert(htmlSource.includes('They do not create a customer proof request or approve a payment by themselves.'));
assert(!htmlSource.includes('id="queueTableBody"'));
assert(!htmlSource.includes('id="queueTableFooter"'));
assert(htmlSource.includes('id="queueApproveAssignmentConfirmed"'));
assert(htmlSource.includes('permanently assigns the matched GCash transaction'));
assert(!htmlSource.includes('queueGmailPanel'));
assert(!htmlSource.includes('queueBridgePanel'));
assert(browserSource.includes("'X-PDF-Password': password"));
assert(browserSource.includes('Official match'));
assert(browserSource.includes("fetch('/api/payment-confirmations/gcash-history?limit=500'"));
assert(browserSource.includes('No pending customer proof submissions. Imported GCash transactions are shown below.'));
assert(browserSource.includes('await Promise.all([fetchQueue(), fetchGcashHistory()])'));
assert(browserSource.includes('assignmentConfirmed: isGcash ? true : undefined'));
assert(browserSource.includes('Assigned and posted'));
assert(!browserSource.includes('/gcash-gmail/'));
assert(!browserSource.includes('/api/payment-bridge'));

(async () => {
    await importGcashTransactionBatch({
        branchId: 1,
        fileName: 'fixture.pdf',
        pdfSha256: 'a'.repeat(64),
        parsed,
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    const claim = await claimGcashTransaction({
        branchId: 1,
        reference: transaction.reference,
        submissionId: 'pcq-claim-1',
        accountNumber: 'ACC-1001',
        customerName: 'Correct Customer',
        amount: 1000,
        paymentDate: '2026-08-08',
        claimedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });
    assert.strictEqual(claim.assignment.status, 'claimed');
    assert.strictEqual(claim.assignment.accountNumber, 'ACC-1001');
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

    console.log('PASS GCash official-history parsing, immutable assignment, wrong-customer reuse checks, and manual approval gate');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
