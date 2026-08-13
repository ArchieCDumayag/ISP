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
assert(routeSource.includes("'/gcash-history/import'"));
assert(routeSource.includes("'/gcash-history/:reference/post-payment'"));
assert(routeSource.includes("'/gcash-history/:reference/remark'"));
assert(routeSource.includes("code: 'GCASH_IMPORTED_AMOUNT_MISMATCH'"));
assert(routeSource.includes("code: 'BILLING_CYCLE_ALREADY_SETTLED'"));
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
assert(htmlSource.includes('Imported rows never post automatically.'));
assert(htmlSource.includes('class="card gcash-history-panel"'));
assert(htmlSource.includes('table table-vcenter table-hover card-table'));
assert(htmlSource.includes('modal modal-blur tabler-form-modal queue-tabler-modal'));
assert(htmlSource.includes('class="form-select" id="queuePostGcashAccount"'));
assert(htmlSource.includes('id="queuePostGcashModal"'));
assert(htmlSource.includes('Confirm &amp; Post Payment'));
assert(htmlSource.includes('<th>Description</th>'));
assert(htmlSource.includes('<th>Amount</th>'));
assert(!htmlSource.includes('<th>Debit</th>'));
assert(!htmlSource.includes('<th>Credit</th>'));
assert(htmlSource.includes('<th>Remark</th>'));
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
assert(browserSource.includes('transaction.recipientLabel'));
assert(browserSource.includes('transaction.description'));
assert(browserSource.includes('No pending customer proof submissions. Imported GCash transactions are shown below.'));
assert(browserSource.includes('await Promise.all([fetchQueue(), fetchGcashHistory()])'));
assert(browserSource.includes('assignmentConfirmed: isGcash ? true : undefined'));
assert(browserSource.includes('Assigned and Posted'));
assert(browserSource.includes('save-gcash-remark'));
assert(browserSource.includes('Expense — Unclassified'));
assert(!browserSource.includes('Choose a classification for this record.'));
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
        branchId: 3,
        fileName: 'direct-post-fixture.pdf',
        pdfSha256: 'c'.repeat(64),
        parsed: {
            ...parsed,
            transactions: [{
                ...transaction,
                reference: 'DIRECT-POST-1001',
                recipient: '09361565251'
            }]
        },
        importedBy: { id: 'admin-1', username: 'admin', name: 'Admin' }
    });

    let paymentWriteCount = 0;
    const paymentsModulePath = require.resolve('../backend/payments');
    const paymentRecordsModulePath = require.resolve('../backend/payment-records');
    require.cache[paymentsModulePath] = {
        id: paymentsModulePath,
        filename: paymentsModulePath,
        loaded: true,
        exports: {
            recordApprovedProofPayment: async (payload) => {
                paymentWriteCount += 1;
                assert.strictEqual(payload.source, 'gcash-history');
                assert.strictEqual(payload.amount, 1000);
                assert.strictEqual(payload.reference, 'DIRECTPOST1001');
                return { id: 'proof-direct-post-1001' };
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
                name: 'Direct Post Customer',
                branchId,
                billingSummary: {
                    rows: [{
                        billingMonthKey: '2026-08',
                        paymentStatus: 'unpaid',
                        balanceAfterPayment: 1000
                    }]
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
    const invokeDirectPost = async (body) => {
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
            params: { reference: 'DIRECT-POST-1001' },
            body,
            user: { id: 'admin-1', username: 'admin', name: 'Admin', role: 'Admin', branchId: 3 }
        }, response, (error) => {
            throw error;
        });
        return result;
    };

    const amountMismatch = await invokeDirectPost({
        accountNumber: 'ACC-3003',
        billingMonth: '2026-08',
        amount: 999,
        assignmentConfirmed: true
    });
    assert.strictEqual(amountMismatch.statusCode, 409);
    assert.strictEqual(amountMismatch.payload.code, 'GCASH_IMPORTED_AMOUNT_MISMATCH');
    assert.strictEqual(paymentWriteCount, 0);

    const directPost = await invokeDirectPost({
        accountNumber: 'ACC-3003',
        billingMonth: '2026-08',
        amount: 1000,
        assignmentConfirmed: true
    });
    assert.strictEqual(directPost.statusCode, 201);
    assert.strictEqual(directPost.payload.assignment.status, 'posted');
    assert.strictEqual(directPost.payload.assignment.accountNumber, 'ACC-3003');
    assert.strictEqual(directPost.payload.assignment.billingMonth, '2026-08');
    assert.strictEqual(paymentWriteCount, 1);

    const retry = await invokeDirectPost({
        accountNumber: 'ACC-3003',
        billingMonth: '2026-08',
        amount: 1000,
        assignmentConfirmed: true
    });
    assert.strictEqual(retry.statusCode, 200);
    assert.strictEqual(retry.payload.idempotent, true);
    assert.strictEqual(paymentWriteCount, 1);

    console.log('PASS GCash history de-duplication, recipient labels, immutable account/cycle assignment, and guarded posting UI contracts');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
