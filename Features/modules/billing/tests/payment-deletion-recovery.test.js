const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const paymentsPath = path.join(projectRoot, 'Features/modules/billing/backend/payments.js');
const historyHtmlPath = path.join(projectRoot, 'Features/modules/billing/web/payment-history.html');
const historyCssPath = path.join(projectRoot, 'Features/modules/billing/web/css/payment-history.css');
const historyBrowserPath = path.join(projectRoot, 'Features/modules/billing/web/js/payment-history.js');

const paymentsSource = fs.readFileSync(paymentsPath, 'utf8');
const historyHtml = fs.readFileSync(historyHtmlPath, 'utf8');
const historyCss = fs.readFileSync(historyCssPath, 'utf8');
const historyBrowser = fs.readFileSync(historyBrowserPath, 'utf8');

function sourceSection(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `Missing source marker after ${startMarker}: ${endMarker}`);
    return source.slice(start, end);
}

function assertOrdered(source, markers, message) {
    let previousIndex = -1;
    markers.forEach((marker) => {
        const currentIndex = source.indexOf(marker, previousIndex + 1);
        assert.notEqual(currentIndex, -1, `${message}: missing ${marker}`);
        assert.ok(currentIndex > previousIndex, `${message}: ${marker} is out of order`);
        previousIndex = currentIndex;
    });
}

function assertIncludesAll(source, markers, message) {
    markers.forEach((marker) => {
        assert.ok(source.includes(marker), `${message}: missing ${marker}`);
    });
}

function run() {
    assertIncludesAll(paymentsSource, [
        "'./payment-deletion-archive-store'",
        'appendPaymentDeletionRecords',
        'createPaymentDeletionRecord',
        'listPaymentDeletionRecords',
        'markPaymentDeletionRestored',
        'readPaymentDeletionArchive',
        'router.use(serializePaymentMutationRequest)'
    ], 'payment recovery backend wiring');

    const adminGuard = sourceSection(
        paymentsSource,
        'const assertAdminUser = async (req) =>',
        'const toMysqlDateTime ='
    );
    assert.match(adminGuard, /accountHasRole\(user, ['"]Admin['"]\)/);
    assert.match(adminGuard, /Admin access is required/);

    const deletedListRoute = sourceSection(
        paymentsSource,
        "router.get('/deleted'",
        "router.post('/deleted/:deletionId/restore'"
    );
    assert.match(deletedListRoute, /await assertAdminUser\(req\)/);
    assert.match(deletedListRoute, /getPublicDeletedPaymentRecords\(branchId\)/);
    assert.match(deletedListRoute, /res\.json\(\{ ok: true, total: records\.length, records \}\)/);

    const restoreRoute = sourceSection(
        paymentsSource,
        "router.post('/deleted/:deletionId/restore'",
        "router.delete('/clear'"
    );
    assert.match(restoreRoute, /await assertAdminUser\(req\)/);
    assert.match(restoreRoute, /deletionId: req\.params\.deletionId/);
    assert.match(restoreRoute, /reason: req\.body\?\.reason/);
    assert.doesNotMatch(restoreRoute, /req\.body\?\.(?:entry|payment|accountNumber|amount|reference)/);

    const clearRoute = sourceSection(
        paymentsSource,
        "router.delete('/clear'",
        "router.post('/import-excel'"
    );
    assert.match(clearRoute, /await assertAdminUser\(req\)/);
    assert.match(clearRoute, /normalizePaymentDeletionReason\(req\.body\?\.reason/);
    assert.match(clearRoute, /deletePaymentEntriesForAccount\(\{/);
    assert.match(clearRoute, /reason: deletionReason/);
    assert.match(clearRoute, /archivedCount: removedCount/);
    assert.match(clearRoute, /PAYMENT_ARCHIVE_PARTIAL/);
    assert.match(clearRoute, /payments-clear-partial/);
    assertIncludesAll(clearRoute, [
        'getPostedGcashPaymentEntryIdSet(branchId)',
        'assertPostedGcashPaymentEntriesNotDeleted(',
        'postedGcashEntryIds'
    ], 'Archive All posted-GCash protection');
    assertOrdered(clearRoute, [
        'const postedGcashEntryIds = await getPostedGcashPaymentEntryIdSet(branchId);',
        'assertPostedGcashPaymentEntriesNotDeleted(',
        'const backup = await createPaymentRecordsBackup(',
        'for (const [accountNumber, bucket] of Object.entries(targetPayments))'
    ], 'Archive All must reject posted official GCash entries before backup or account deletion');

    const bulkDeleteRoute = sourceSection(
        paymentsSource,
        "router.post('/:accountNumber/bulk-delete'",
        "router.delete('/:accountNumber/:entryId'"
    );
    assert.match(bulkDeleteRoute, /await assertAdminUser\(req\)/);
    assert.match(bulkDeleteRoute, /reason: req\.body\?\.reason/);
    assert.match(bulkDeleteRoute, /user,/);
    assert.match(bulkDeleteRoute, /deletionRecordIds/);

    const singleDeleteRoute = sourceSection(
        paymentsSource,
        "router.delete('/:accountNumber/:entryId'",
        "router.post('/:accountNumber/xendit/link'"
    );
    assert.match(singleDeleteRoute, /await assertAdminUser\(req\)/);
    assert.match(singleDeleteRoute, /reason: req\.body\?\.reason/);
    assert.match(singleDeleteRoute, /user,/);
    assert.match(singleDeleteRoute, /deletionRecordId/);

    const deleteService = sourceSection(
        paymentsSource,
        'const deletePaymentEntriesForAccount = async ({',
        'const PAYMENT_RESTORE_ENTRY_FIELDS = ['
    );
    assertIncludesAll(deleteService, [
        'getPostedGcashPaymentEntryIdSet(branchId)',
        'assertPostedGcashPaymentEntriesNotDeleted(normalizedEntryIds, immutableGcashEntryIds)',
        'normalizePaymentDeletionReason(reason)',
        'getBranchPaymentCustomer(branchId, normalizedAccountNumber)',
        'deletedEntries.length !== normalizedEntryIds.length',
        'assertClosedAccountPaymentEvidenceNotDeleted(deletedEntries)',
        'readRelationalPaymentAmountCorrections(',
        'createPaymentDeletionRecordsForEntries({',
        'corrections,',
        'appendPaymentDeletionRecords({',
        'executor: connection',
        'DELETE FROM payment_entries',
        'affectedRows !== normalizedEntryIds.length',
        'await writePayments(payments)'
    ], 'audited payment deletion');
    assertOrdered(deleteService, [
        'assertPostedGcashPaymentEntriesNotDeleted(normalizedEntryIds, immutableGcashEntryIds)',
        'getActiveClosedCustomerAccount(branchId, normalizedAccountNumber)',
        'appendPaymentDeletionRecords({'
    ], 'posted official GCash entries must be rejected before any deletion archive mutation');
    assertOrdered(deleteService, [
        'readRelationalPaymentAmountCorrections(',
        'createPaymentDeletionRecordsForEntries({',
        'await appendPaymentDeletionRecords({',
        'DELETE FROM payment_entries'
    ], 'relational deletion must snapshot corrections and archive before deleting');
    assertOrdered(deleteService, [
        'await appendPaymentDeletionRecords({ branchId, records: recordsToAppend });',
        'payments[normalizedAccountNumber].history = history.filter(',
        'await writePayments(payments)'
    ], 'JSON deletion must archive before removing the live entry');

    const correctionRestore = sourceSection(
        paymentsSource,
        'const restoreRelationalPaymentAmountCorrections = async',
        'const groupPaymentCorrectionsByEntryId ='
    );
    assert.match(correctionRestore, /INSERT INTO \$\{COLLECTOR_PAYMENT_AMOUNT_CORRECTION_TABLE\}/);
    assert.match(correctionRestore, /correction_id/);
    assert.match(correctionRestore, /previous_amount/);
    assert.match(correctionRestore, /corrected_amount/);
    assert.match(correctionRestore, /correction_reason/);
    assert.match(correctionRestore, /cannot be restored safely/);

    const gcashRestoreAuthority = sourceSection(
        paymentsSource,
        'const assertPaymentRestoreReferenceAuthority = async',
        'const assertJsonPaymentRestoreAvailable = ({'
    );
    assertIncludesAll(gcashRestoreAuthority, [
        'listGcashTransactionHistory({ branchId, all: true })',
        'paymentReferencesMatch(transaction?.reference, reference)',
        "transaction?.assignment?.status === 'posted'",
        'getGcashAssignmentPaymentEntryIds(transaction.assignment).has(entryId)',
        'history?.pendingReservations',
        'paymentReferencesMatch(reservation?.reference, reference)',
        'PAYMENT_RESTORE_GCASH_REFERENCE_CONFLICT'
    ], 'official and pending GCash reference restore authority');
    assert.match(
        gcashRestoreAuthority,
        /matchingTransactions\.length\s*&&\s*!ownedPostedTransaction/,
        'an official GCash reference may only be retained by the same archived posted entry'
    );
    assert.match(
        gcashRestoreAuthority,
        /conflictingTransaction\s*\|\|\s*pendingReservation/,
        'a second official owner or a pending reservation must block restore'
    );

    const jsonCollisionGuard = sourceSection(
        paymentsSource,
        'const assertJsonPaymentRestoreAvailable = ({',
        'const assertRelationalPaymentRestoreAvailable = async'
    );
    assertIncludesAll(jsonCollisionGuard, [
        'PAYMENT_RESTORE_ID_CONFLICT',
        'PAYMENT_RESTORE_REFERENCE_CONFLICT',
        'PAYMENT_RESTORE_OR_CONFLICT',
        'PAYMENT_RESTORE_FINGERPRINT_CONFLICT',
        'paymentReferencesMatch(',
        'normalizeManualPaymentReferenceKey('
    ], 'JSON restore collision guards');

    const relationalCollisionGuard = sourceSection(
        paymentsSource,
        'const assertRelationalPaymentRestoreAvailable = async',
        'const getPaymentDeletionRecordById ='
    );
    assertIncludesAll(relationalCollisionGuard, [
        'SELECT id FROM payment_entries WHERE id = ? LIMIT 1',
        'assertEntryNumbersAvailable(connection, branchId, entry)',
        'PAYMENT_RESTORE_ID_CONFLICT',
        'PAYMENT_RESTORE_REFERENCE_CONFLICT',
        'PAYMENT_RESTORE_OR_CONFLICT',
        'PAYMENT_RESTORE_FINGERPRINT_CONFLICT'
    ], 'relational restore collision guards');

    const restoreService = sourceSection(
        paymentsSource,
        'const restorePaymentDeletionRecord = async ({',
        'const listAllPaymentDeletionRecords = async'
    );
    assertIncludesAll(restoreService, [
        "action: 'restoration'",
        'getBranchPaymentCustomer(branchId, accountNumber)',
        'getActiveClosedCustomerAccount(branchId, accountNumber)',
        'await lockPaymentAccount(connection, branchId, accountNumber)',
        'readPaymentDeletionArchive({ branchId, executor: connection, lock: true })',
        'assertRelationalPaymentRestoreAvailable(connection, branchId, currentRecord)',
        'insertPaymentEntry(currentRecord.entry, branchId, accountNumber, connection)',
        'restoreRelationalPaymentAmountCorrections(',
        'currentRecord?.related?.amountCorrections || []',
        'markPaymentDeletionRestored({',
        "triggerBranchServiceRefresh(branchId, 'payments-restore')"
    ], 'audited exact-entry restore');
    assertOrdered(restoreService, [
        'assertRelationalPaymentRestoreAvailable(connection, branchId, currentRecord)',
        'insertPaymentEntry(currentRecord.entry, branchId, accountNumber, connection)',
        'await restoreRelationalPaymentAmountCorrections(',
        'restoredRecord = await markPaymentDeletionRestored({'
    ], 'relational restore must validate, restore the payment and corrections, then close the audit');
    assert.match(restoreService, /PAYMENT_ALREADY_RESTORED/);
    assert.match(restoreService, /assertJsonPaymentRestoreAvailable\(\{/);
    assert.equal(
        (restoreService.match(/await assertPaymentRestoreReferenceAuthority\(\{ branchId, record: currentRecord \}\);/g) || []).length,
        2,
        'both relational and JSON restore paths must enforce GCash reference authority'
    );

    const publicDeletedRecords = sourceSection(
        paymentsSource,
        'const toPublicPaymentDeletionRecord = (record = {}, activeEntry = null, { relational = false } = {}) =>',
        'const deriveCreditLimit ='
    );
    assertIncludesAll(publicDeletedRecords, [
        'restorable: !sourceStillPresent || (exactActiveMatch && !relational)',
        'recoveryPending: exactActiveMatch && !relational',
        'exactActiveMatch && relational',
        'relational recovery cannot be finalized automatically',
        'record?.entry?.amountCorrections',
        'isRelationalReady()',
        '{ relational }'
    ], 'relational recovery-pending presentation guard');

    assert.doesNotMatch(paymentsSource, /router\.(?:delete|post)\('\/deleted\/:deletionId\/(?:purge|delete)'/);

    assertIncludesAll(historyHtml, [
        'id="paymentHistoryTabs" role="tablist"',
        'id="paymentHistoryActiveTab"',
        'data-payment-history-tab="active"',
        'id="paymentHistoryDeletedTab"',
        'data-payment-history-tab="deleted"',
        'aria-controls="paymentHistoryDeletedPanel"',
        'id="paymentHistoryDeletedPanel"',
        'aria-labelledby="paymentHistoryDeletedTab"',
        'Deleted Payments',
        'id="paymentHistoryDeletedTableBody"',
        'Deleted At / Reason',
        'Permanent purge is not available here.',
        'id="paymentHistoryDeleteModal"',
        'id="paymentHistoryRestoreModal"',
        'id="paymentHistoryAuditModal"',
        'id="paymentHistoryRestoreConfirmed" required'
    ], 'Deleted Payments HTML workflow');
    assert.match(
        historyHtml,
        /id="paymentHistoryDeleteReason"[\s\S]*?minlength="8"[\s\S]*?maxlength="500"[\s\S]*?required/
    );
    assert.match(
        historyHtml,
        /id="paymentHistoryRestoreReason"[\s\S]*?minlength="8"[\s\S]*?maxlength="500"[\s\S]*?required/
    );
    assert.match(historyHtml, /id="paymentHistoryDeleteModal"[^>]*data-bs-backdrop="static"[^>]*data-bs-keyboard="false"/);
    assert.match(historyHtml, /id="paymentHistoryRestoreModal"[^>]*data-bs-backdrop="static"[^>]*data-bs-keyboard="false"/);
    const historyScriptVersion = historyHtml.match(/js\/payment-history\.js\?v=([^"']+)/)?.[1] || '';
    assert.ok(historyScriptVersion && historyScriptVersion !== '4.6', 'payment-history.js cache key must change with the recovery workflow');
    assert.match(
        historyCss,
        /@media \(max-width: 1320px\)[\s\S]*?\.payment-history-deleted-inline-filters\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(8\.5rem, 1fr\)\)/,
        'deleted filters must wrap before the 961px clipping range'
    );
    assert.match(
        historyCss,
        /#paymentHistoryDeleteModal\.modal,[\s\S]*?#paymentHistoryAuditModal\.modal\s*\{[\s\S]*?z-index:\s*1110 !important;[\s\S]*?pointer-events:\s*auto !important;/,
        'recovery modals must remain interactive above the Tabler backdrop'
    );
    assert.match(historyCss, /\.payment-history-body > \.modal-backdrop,[\s\S]*?z-index:\s*1100 !important;/);

    assertIncludesAll(historyBrowser, [
        "document.getElementById('paymentHistoryDeletedTab')",
        "document.getElementById('paymentHistoryDeletedTableBody')",
        "document.getElementById('paymentHistoryDeleteForm')",
        "document.getElementById('paymentHistoryRestoreForm')",
        'async function loadDeletedPayments',
        'function renderDeletedTable',
        'function applyDeletedFilters',
        'function openDeleteModal',
        'function openRestoreModal',
        'function renderAmountCorrections',
        'function openAuditModal',
        'async function restoreDeletedPayment',
        "fetchJSON('/api/payments/deleted')",
        '/api/payments/deleted/${encodeURIComponent(',
        'payment-history-deleted-audit',
        'payment-history-deleted-restore',
        'No deleted payments',
        'Failed to load deleted payments'
    ], 'Deleted Payments browser workflow');

    const renderDeletedTable = sourceSection(
        historyBrowser,
        'function renderDeletedTable',
        'function applyDeletedFilters'
    );
    assert.match(renderDeletedTable, /escapeHtml\([^\n]*(?:deletionReason|reason)/);
    assert.match(renderDeletedTable, /escapeHtml\([^\n]*(?:deletedBy|deletedByLabel)/);
    assert.match(renderDeletedTable, /escapeHtml\([^\n]*(?:reference|orNumber|paymentNumber)/);

    const deletedRowMapping = sourceSection(
        historyBrowser,
        'function buildDeletedRows',
        'function updateDeletedCount'
    );
    assert.match(deletedRowMapping, /record\?\.related\?\.amountCorrections/);
    assert.match(deletedRowMapping, /relatedAmountCorrections\.length/);
    assert.match(deletedRowMapping, /entry\?\.amountCorrections/);

    const activeDeleteAction = sourceSection(
        historyBrowser,
        'const deleteButton =',
        'return `'
    );
    assert.match(activeDeleteAction, /gcashDeleteLockReason/);
    assert.match(activeDeleteAction, /Delete locked/);
    assert.match(activeDeleteAction, /disabled aria-disabled="true"/);

    const gcashDeleteProtection = sourceSection(
        historyBrowser,
        'const resolveGcashDeleteLockReason =',
        'function updateDeletedCount'
    );
    assert.match(gcashDeleteProtection, /row\?\.isGcashBound/);
    assert.match(gcashDeleteProtection, /paymentMethodKey === ['"]gcash['"]/);
    assert.match(gcashDeleteProtection, /!state\.gcashBindingsLoaded/);
    assert.match(gcashDeleteProtection, /GCash transaction is already posted/);
    assert.match(gcashDeleteProtection, /binding status is unavailable/);

    const deleteBrowserFlow = sourceSection(
        historyBrowser,
        'function openDeleteModal',
        'function openRestoreModal'
    );
    assert.match(deleteBrowserFlow, /readAuditReason\(deleteReasonInput\)/);
    assert.match(deleteBrowserFlow, /isValidAuditReason\(reason\)/);
    assert.match(deleteBrowserFlow, /method: ['"]DELETE['"]/);
    assert.match(deleteBrowserFlow, /['"]Content-Type['"]:\s*['"]application\/json['"]/);
    assert.match(deleteBrowserFlow, /JSON\.stringify\(\{ reason \}\)/);
    const deleteModalFlow = sourceSection(
        deleteBrowserFlow,
        'function openDeleteModal',
        'async function deletePayment'
    );
    assert.match(deleteModalFlow, /resolveGcashDeleteLockReason\(row\)/);
    assert.match(deleteModalFlow, /Archive every branch ledger entry, including payments, charges, and adjustments\./);
    assert.match(deleteModalFlow, /entries outside the currently filtered table/);
    assert.doesNotMatch(deleteModalFlow, /state\.allRows\.length/);

    const deleteSubmitFlow = sourceSection(
        deleteBrowserFlow,
        'async function submitDeleteRequest',
        'function updateRestoreSubmitState'
    );
    const archiveAllErrorFlow = sourceSection(
        deleteSubmitFlow,
        '} catch (error) {',
        '} finally {'
    );
    assert.match(archiveAllErrorFlow, /completedDeleteMode === ['"]clear['"]/);
    assert.match(archiveAllErrorFlow, /Promise\.allSettled\(\[/);
    assert.match(archiveAllErrorFlow, /loadHistory\(\)/);
    assert.match(archiveAllErrorFlow, /loadDeletedPayments\(\{ force: true \}\)/);

    const restoreBrowserFlow = sourceSection(
        historyBrowser,
        'async function restoreDeletedPayment',
        'function openAuditModal'
    );
    assert.match(restoreBrowserFlow, /restoreConfirmedInput\?\.checked/);
    assert.match(restoreBrowserFlow, /isValidAuditReason\(reason\)/);
    assert.match(restoreBrowserFlow, /method: ['"]POST['"]/);
    assert.match(restoreBrowserFlow, /JSON\.stringify\(\{ reason \}\)/);
    assert.match(restoreBrowserFlow, /await Promise\.all\(\[/);
    assert.match(restoreBrowserFlow, /loadHistory\(\)/);
    assert.match(restoreBrowserFlow, /loadDeletedPayments\(\{ force: true \}\)/);
    assert.match(restoreBrowserFlow, /let didRestore = false/);
    assert.match(restoreBrowserFlow, /if \(didRestore\) focusModalTarget\(deletedHistoryTab\)/);

    const correctionAuditRenderer = sourceSection(
        historyBrowser,
        'function renderAmountCorrections',
        'function openAuditModal'
    );
    assertIncludesAll(correctionAuditRenderer, [
        'previousAmount',
        'previous_amount',
        'fromAmount',
        'correctedAmount',
        'corrected_amount',
        'toAmount',
        'correctedAt',
        'corrected_at',
        'correctedByUserId',
        'correctedByUsername',
        'correctedByName',
        'correctedByRole',
        'correctionReason',
        'correction_reason',
        'Previous amount',
        'Corrected amount',
        'Corrected by',
        'Reason'
    ], 'amount-correction audit fields');
    assert.match(correctionAuditRenderer, /formatCurrency\(previousAmount\)/);
    assert.match(correctionAuditRenderer, /formatCurrency\(correctedAmount\)/);
    assert.match(correctionAuditRenderer, /formatEntryDate\(correctedAt, safeDate\(correctedAt\)\)/);
    assert.match(correctionAuditRenderer, /escapeHtml\(correctedAtLabel\)/);
    assert.match(correctionAuditRenderer, /escapeHtml\(correctedByLabel\)/);
    assert.match(correctionAuditRenderer, /escapeHtml\(reason\)/);

    const auditModalFlow = sourceSection(
        historyBrowser,
        'function openAuditModal',
        'async function backupPaymentRecords'
    );
    assert.match(auditModalFlow, /renderAmountCorrections\(row\.amountCorrections\)/);

    const clearBrowserRequest = sourceSection(
        historyBrowser,
        'async function archiveAllPaymentRecords',
        'async function submitDeleteRequest'
    );
    assert.match(clearBrowserRequest, /fetchJSON\('\/api\/payments\/clear'/);
    assert.match(clearBrowserRequest, /JSON\.stringify\(\{ reason \}\)/);
    const clearBrowserAction = sourceSection(
        historyBrowser,
        'function clearPaymentRecords',
        'function applyFilters'
    );
    assert.match(clearBrowserAction, /openDeleteModal\(null, \{ mode: ['"]clear['"], trigger:/);
    assert.doesNotMatch(clearBrowserAction, /canUseBrowserFallback|downloadJsonBackup|deleteEntriesFromPayments/);
    assert.doesNotMatch(historyBrowser, /async function deleteEntriesFromPayments/);

    const modalFocusHelpers = sourceSection(
        historyBrowser,
        'const modalFocusContexts = new WeakMap()',
        'const showUnmatchedModal ='
    );
    assertIncludesAll(modalFocusHelpers, [
        'rememberModalFocus',
        'focusModalInitialControl',
        'restoreModalTriggerFocus',
        'bindFallbackModalDismiss',
        'isRecoveryModalBusy',
        'setRecoveryModalDismissBusy',
        "event.target?.closest?.('[data-bs-dismiss=\"modal\"]')",
        'hideModal(modalEl)',
        'returnFocus',
        'fallbackFocus',
        "new Event('shown.bs.modal')",
        "new Event('hidden.bs.modal')"
    ], 'modal focus lifecycle helpers');
    assert.doesNotMatch(deleteModalFlow, /setTimeout\([^\n]*deleteReasonInput/);
    assert.doesNotMatch(restoreBrowserFlow, /setTimeout\([^\n]*restoreReasonInput/);
    assertIncludesAll(historyBrowser, [
        "deleteModalEl?.addEventListener('shown.bs.modal'",
        "deleteModalEl?.addEventListener('hidden.bs.modal'",
        "restoreModalEl?.addEventListener('shown.bs.modal'",
        "restoreModalEl?.addEventListener('hidden.bs.modal'",
        "auditModalEl?.addEventListener('shown.bs.modal'",
        "auditModalEl?.addEventListener('hidden.bs.modal'",
        'recoveryModalElements.forEach(bindFallbackModalDismiss)',
        "event.key !== 'Escape'",
        'event.stopPropagation()',
        'hideModal(visibleModal)',
        'openDeleteModal(row, { trigger: deleteBtn })',
        'openAuditModal(row, { trigger: actionBtn })',
        'openRestoreModal(row, { trigger: actionBtn })'
    ], 'modal focus and initiator wiring');
    assert.match(deleteSubmitFlow, /const completedDeleteMode = state\.deleteMode/);
    assert.match(deleteSubmitFlow, /let didArchive = false/);
    assert.match(deleteSubmitFlow, /setRecoveryModalDismissBusy\(deleteModalEl, true\)/);
    assert.match(deleteSubmitFlow, /setRecoveryModalDismissBusy\(deleteModalEl, false\)/);
    assert.match(deleteSubmitFlow, /focusModalTarget\(completedDeleteMode === ['"]clear['"] \? clearBtn : activeHistoryTab\)/);
    assert.match(restoreBrowserFlow, /setRecoveryModalDismissBusy\(restoreModalEl, true\)/);
    assert.match(restoreBrowserFlow, /setRecoveryModalDismissBusy\(restoreModalEl, false\)/);
    assert.match(historyBrowser, /if \(isRecoveryModalBusy\(visibleModal\)\)[\s\S]*?event\.stopPropagation\(\);[\s\S]*?return;/);

    // Compile without executing to catch browser-script syntax regressions.
    assert.doesNotThrow(() => new Function(historyBrowser));

    console.log('PASS audited Deleted Payments backend routes, collision/correction safeguards, and recovery UI contracts');
}

run();
