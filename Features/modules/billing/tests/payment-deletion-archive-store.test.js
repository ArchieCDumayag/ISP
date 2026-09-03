const assert = require('assert');
const fs = require('fs');
const path = require('path');

const originalStorageDriver = process.env.STORAGE_DRIVER;
process.env.STORAGE_DRIVER = 'json';

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const dataStorePath = require.resolve(path.join(projectRoot, 'core/data/data-store'));
const archiveStorePath = require.resolve(path.join(
    projectRoot,
    'Features/modules/billing/backend/payment-deletion-archive-store'
));
const originalDataStoreExports = require(dataStorePath);
const jsonStores = new Map();
const jsonArchiveFiles = new Map();
const originalReadFile = fs.promises.readFile.bind(fs.promises);

const clone = (value) => JSON.parse(JSON.stringify(value));

require.cache[dataStorePath].exports = {
    ...originalDataStoreExports,
    readJson: async (key, fallback) => (
        jsonStores.has(key) ? clone(jsonStores.get(key)) : clone(fallback)
    ),
    writeJson: async (key, value) => {
        jsonStores.set(key, clone(value));
        jsonArchiveFiles.set(key, JSON.stringify(value));
    }
};
fs.promises.readFile = async (filePath, encoding) => {
    const basename = path.basename(String(filePath || ''));
    if (basename.startsWith('payment_deletion_archive_branch_') && basename.endsWith('.json')) {
        const key = basename.slice(0, -'.json'.length);
        if (jsonArchiveFiles.has(key)) return jsonArchiveFiles.get(key);
        const error = new Error(`Archive fixture not found: ${key}`);
        error.code = 'ENOENT';
        throw error;
    }
    return originalReadFile(filePath, encoding);
};
delete require.cache[archiveStorePath];

const {
    appendPaymentDeletionRecords,
    createPaymentDeletionRecord,
    listPaymentDeletionRecords,
    markPaymentDeletionRestored,
    readPaymentDeletionArchive
} = require(archiveStorePath);

class FakeExecutor {
    constructor() {
        this.rows = new Map();
        this.calls = [];
    }

    async query(sql, params = []) {
        this.calls.push({ sql, params: clone(params) });
        if (/^\s*INSERT INTO `app_store`/i.test(sql)) {
            if (!this.rows.has(params[0])) this.rows.set(params[0], params[1]);
            return [{ affectedRows: 1 }, []];
        }
        if (/^\s*SELECT payload/i.test(sql)) {
            return [this.rows.has(params[0]) ? [{ payload: this.rows.get(params[0]) }] : [], []];
        }
        if (/^\s*UPDATE `app_store`/i.test(sql)) {
            this.rows.set(params[1], params[0]);
            return [{ affectedRows: 1 }, []];
        }
        throw new Error(`Unexpected SQL in payment deletion archive test: ${sql}`);
    }
}

async function run() {
    assert.throws(
        () => createPaymentDeletionRecord({
            branchId: 1,
            accountNumber: 'ACC-001',
            entry: { id: 'pay-001', amount: 800 },
            actor: { id: 'admin-1' }
        }),
        (error) => error.status === 400 && /Deletion reason is required/i.test(error.message)
    );
    assert.throws(
        () => createPaymentDeletionRecord({
            branchId: 1,
            accountNumber: 'ACC-001',
            entry: { id: 'pay-001', amount: 800 },
            reason: 'Duplicate cash entry.'
        }),
        (error) => error.status === 400 && /Admin identity is required/i.test(error.message)
    );

    const deletion = createPaymentDeletionRecord({
        id: 'payment-delete-test-001',
        branchId: 1,
        accountNumber: 'ACC-001',
        entry: {
            id: 'pay-001',
            amount: 800,
            reference: 'CASH-001',
            paymentMethod: 'Cash',
            amountCorrectionHistory: [{ id: 'correction-001', previousAmount: 900, correctedAmount: 800 }]
        },
        customer: { name: 'Test Customer' },
        related: {
            remittanceIds: ['remit-001'],
            amountCorrections: [{ correctionId: 'correction-001' }]
        },
        reason: 'Duplicate cash entry.',
        actor: { id: 'admin-1', username: 'admin', name: 'Admin One', role: 'Admin' },
        deletedAt: '2026-09-01T01:00:00.000Z'
    });
    assert.equal(deletion.status, 'deleted');
    assert.equal(deletion.deletedBy.name, 'Admin One');
    assert.equal(deletion.deletionReason, 'Duplicate cash entry.');
    assert.equal(deletion.audit.length, 1);
    assert.equal(deletion.audit[0].action, 'deleted');
    assert.deepEqual(deletion.related.remittanceIds, ['remit-001']);

    const appended = await appendPaymentDeletionRecords({ branchId: 1, records: [deletion] });
    assert.equal(appended.length, 1);
    assert.equal(appended[0].entry.amountCorrectionHistory[0].correctedAmount, 800);

    const activeList = await listPaymentDeletionRecords({ branchId: 1 });
    assert.equal(activeList.total, 1);
    assert.equal(activeList.items[0].entryId, 'pay-001');
    const searchList = await listPaymentDeletionRecords({ branchId: 1, search: 'cash-001' });
    assert.equal(searchList.total, 1);
    const otherBranchList = await listPaymentDeletionRecords({ branchId: 2 });
    assert.equal(otherBranchList.total, 0);

    await assert.rejects(
        appendPaymentDeletionRecords({
            branchId: 1,
            records: [{ ...deletion, id: 'payment-delete-test-duplicate' }]
        }),
        (error) => error.status === 409 && /already in Deleted Payments/i.test(error.message)
    );

    await assert.rejects(
        markPaymentDeletionRestored({
            branchId: 1,
            id: deletion.id,
            actor: { id: 'admin-1' }
        }),
        (error) => error.status === 400 && /Restore reason is required/i.test(error.message)
    );
    const restored = await markPaymentDeletionRestored({
        branchId: 1,
        id: deletion.id,
        reason: 'Verified against the original receipt.',
        actor: { id: 'admin-2', username: 'owner', name: 'Admin Two', role: 'Admin' },
        restoredAt: '2026-09-01T02:00:00.000Z'
    });
    assert.equal(restored.status, 'restored');
    assert.equal(restored.restoreReason, 'Verified against the original receipt.');
    assert.equal(restored.audit.length, 2);
    assert.equal(restored.audit[1].action, 'restored');
    assert.equal((await listPaymentDeletionRecords({ branchId: 1 })).total, 0);
    const completeAudit = await listPaymentDeletionRecords({ branchId: 1, includeRestored: true });
    assert.equal(completeAudit.total, 1);
    assert.equal(completeAudit.items[0].restoredBy.name, 'Admin Two');
    assert.equal((await readPaymentDeletionArchive({ branchId: 1 })).records.length, 1);

    const malformedJsonKey = 'payment_deletion_archive_branch_3';
    jsonArchiveFiles.set(malformedJsonKey, '{"version":1,"records":');
    const malformedJsonBefore = jsonArchiveFiles.get(malformedJsonKey);
    await assert.rejects(
        readPaymentDeletionArchive({ branchId: 3 }),
        (error) => error.status === 409 && error.code === 'PAYMENT_DELETION_ARCHIVE_MALFORMED'
    );
    const branchThreeRecord = createPaymentDeletionRecord({
        branchId: 3,
        accountNumber: 'ACC-003',
        entry: { id: 'pay-003', amount: 300 },
        reason: 'Archive corruption safety test.',
        actor: { id: 'admin-3', role: 'Admin' }
    });
    await assert.rejects(
        appendPaymentDeletionRecords({ branchId: 3, records: [branchThreeRecord] }),
        (error) => error.status === 409 && error.code === 'PAYMENT_DELETION_ARCHIVE_MALFORMED'
    );
    assert.equal(jsonArchiveFiles.get(malformedJsonKey), malformedJsonBefore, 'malformed JSON must never be overwritten');

    const malformedRecordKey = 'payment_deletion_archive_branch_4';
    const malformedRecord = createPaymentDeletionRecord({
        branchId: 4,
        accountNumber: 'ACC-004',
        entry: { id: 'pay-004', amount: 400 },
        reason: 'Malformed record safety test.',
        actor: { id: 'admin-4', role: 'Admin' }
    });
    malformedRecord.deletionReason = '';
    jsonArchiveFiles.set(malformedRecordKey, JSON.stringify({
        version: 1,
        branchId: 4,
        records: [malformedRecord],
        updatedAt: new Date().toISOString()
    }));
    const malformedRecordBefore = jsonArchiveFiles.get(malformedRecordKey);
    await assert.rejects(
        appendPaymentDeletionRecords({
            branchId: 4,
            records: [createPaymentDeletionRecord({
                branchId: 4,
                accountNumber: 'ACC-005',
                entry: { id: 'pay-005', amount: 500 },
                reason: 'Second malformed record safety test.',
                actor: { id: 'admin-4', role: 'Admin' }
            })]
        }),
        (error) => error.status === 409 && error.code === 'PAYMENT_DELETION_ARCHIVE_MALFORMED'
    );
    assert.equal(jsonArchiveFiles.get(malformedRecordKey), malformedRecordBefore, 'invalid records must never be filtered and overwritten');

    const malformedAuditKey = 'payment_deletion_archive_branch_5';
    const malformedAuditRecord = createPaymentDeletionRecord({
        branchId: 5,
        accountNumber: 'ACC-005',
        entry: { id: 'pay-audit-005', amount: 500 },
        reason: 'Malformed audit safety test.',
        actor: { id: 'admin-5', role: 'Admin' }
    });
    malformedAuditRecord.audit[0].reason = '';
    jsonArchiveFiles.set(malformedAuditKey, JSON.stringify({
        version: 1,
        branchId: 5,
        records: [malformedAuditRecord],
        updatedAt: new Date().toISOString()
    }));
    const malformedAuditBefore = jsonArchiveFiles.get(malformedAuditKey);
    await assert.rejects(
        markPaymentDeletionRestored({
            branchId: 5,
            id: malformedAuditRecord.id,
            reason: 'Restore must not rewrite a damaged audit.',
            actor: { id: 'admin-5', role: 'Admin' }
        }),
        (error) => error.status === 409 && error.code === 'PAYMENT_DELETION_ARCHIVE_MALFORMED'
    );
    assert.equal(jsonArchiveFiles.get(malformedAuditKey), malformedAuditBefore, 'damaged audit events must never be normalized and overwritten');

    const executor = new FakeExecutor();
    const relationalDeletion = createPaymentDeletionRecord({
        id: 'payment-delete-test-002',
        branchId: 7,
        accountNumber: 'ACC-007',
        entry: { id: 'pay-007', amount: 1250, orNumber: 'OR-000007' },
        customer: { name: 'Relational Customer' },
        related: { amountCorrections: [{ correctionId: 'correction-007' }] },
        reason: 'Incorrect account assignment.',
        actor: { id: 'admin-7', name: 'Branch Admin', role: 'Admin' },
        deletedAt: '2026-09-01T03:00:00.000Z'
    });

    await appendPaymentDeletionRecords({
        branchId: 7,
        records: [relationalDeletion],
        executor
    });
    assert(executor.calls.some((call) => /^\s*INSERT INTO `app_store`/i.test(call.sql)));
    assert(executor.calls.some((call) => /SELECT payload[\s\S]*FOR UPDATE/i.test(call.sql)));
    assert(executor.calls.some((call) => /^\s*UPDATE `app_store`/i.test(call.sql)));
    const storedRelationalArchive = await readPaymentDeletionArchive({ branchId: 7, executor });
    assert.equal(storedRelationalArchive.records.length, 1);
    assert.equal(storedRelationalArchive.records[0].related.amountCorrections[0].correctionId, 'correction-007');

    const callsBeforeRestore = executor.calls.length;
    const restoredRelational = await markPaymentDeletionRestored({
        branchId: 7,
        id: relationalDeletion.id,
        reason: 'Original payment and audit verified.',
        actor: { id: 'admin-8', name: 'Review Admin', role: 'Admin' },
        restoredAt: '2026-09-01T04:00:00.000Z',
        executor
    });
    assert.equal(restoredRelational.status, 'restored');
    assert(
        executor.calls.slice(callsBeforeRestore).some((call) => /SELECT payload[\s\S]*FOR UPDATE/i.test(call.sql)),
        'transactional restore must lock the branch archive row'
    );
    assert.equal((await listPaymentDeletionRecords({ branchId: 7, executor })).total, 0);
    assert.equal((await listPaymentDeletionRecords({ branchId: 7, executor, includeRestored: true })).total, 1);

    const damagedExecutor = new FakeExecutor();
    const damagedStoreKey = 'payment_deletion_archive_branch_8';
    damagedExecutor.rows.set(damagedStoreKey, '{not-json');
    const damagedPayloadBefore = damagedExecutor.rows.get(damagedStoreKey);
    await assert.rejects(
        appendPaymentDeletionRecords({
            branchId: 8,
            records: [createPaymentDeletionRecord({
                branchId: 8,
                accountNumber: 'ACC-008',
                entry: { id: 'pay-008', amount: 800 },
                reason: 'Transactional corruption safety test.',
                actor: { id: 'admin-8', role: 'Admin' }
            })],
            executor: damagedExecutor
        }),
        (error) => error.status === 409 && error.code === 'PAYMENT_DELETION_ARCHIVE_MALFORMED'
    );
    assert.equal(damagedExecutor.rows.get(damagedStoreKey), damagedPayloadBefore, 'malformed app_store payload must never be overwritten');

    console.log('PASS payment deletion archive JSON and transactional app_store behavior');
}

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        fs.promises.readFile = originalReadFile;
        require.cache[dataStorePath].exports = originalDataStoreExports;
        delete require.cache[archiveStorePath];
        if (originalStorageDriver == null) delete process.env.STORAGE_DRIVER;
        else process.env.STORAGE_DRIVER = originalStorageDriver;
    });
