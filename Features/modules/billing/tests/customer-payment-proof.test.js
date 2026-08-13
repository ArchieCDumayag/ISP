const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const {
    normalizeProofReference,
    parseProofImagePayload
} = require(path.join(projectRoot, 'Features/modules/billing/backend/payment-confirmation-queue-store'));
const {
    extractGcashScreenshotFields,
    buildGcashScreenshotChecks,
    mergeGcashVisionAnalysis,
    sanitizeGcashProofAnalysis,
    shouldRunSupplementalOcr
} = require(path.join(projectRoot, 'Features/modules/billing/backend/gcash-screenshot-parser'));
const {
    getGcashVisionAiDecision,
    normalizeVisionAiResponse
} = require(path.join(projectRoot, 'Features/modules/billing/backend/gcash-vision-ai'));

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const parsed = parseProofImagePayload(tinyPng, 'image/png');
assert.strictEqual(parsed.mimeType, 'image/png');
assert.strictEqual(parsed.extension, 'png');
assert(parsed.buffer.length > 0);
assert.strictEqual(normalizeProofReference(' 1234 5678 9012 '), '123456789012');
assert.throws(
    () => parseProofImagePayload('data:text/plain;base64,SGVsbG8=', 'text/plain'),
    /Unsupported proof image type/
);
assert.throws(
    () => parseProofImagePayload('data:image/png;base64,SGVsbG8=', 'image/png'),
    /does not match its image type/
);

const extracted = extractGcashScreenshotFields(`
Express Send
AR***E D.
+63 936 156 5251
Sent via GCash
Amount 1,200.00
Total Amount Sent PHP 1,200.00
Ref No. 7043 783 737299
Aug 09, 2026 4:34 PM
`, { confidence: 91.24 });
assert.strictEqual(extracted.state, 'complete');
assert.strictEqual(extracted.fields.amount, 1200);
assert.strictEqual(extracted.fields.reference, '7043783737299');
assert.strictEqual(extracted.fields.transactionAt, '2026-08-09T16:34');
assert.strictEqual(extracted.fields.recipientNumber, '+63 936 156 5251');
assert.strictEqual(extracted.fields.status, 'successful');
assert.strictEqual(extracted.confidence, 91.2);
assert.strictEqual(shouldRunSupplementalOcr(extracted), false);
const extractionChecks = buildGcashScreenshotChecks(extracted, {
    expectedAmount: 1200,
    submittedReference: '7043783737299',
    submittedPaymentDate: '2026-08-09T16:34',
    merchantNumber: '09361565251'
});
assert.deepStrictEqual(extractionChecks, {
    amountMatchesInvoice: true,
    referenceMatchesSubmission: true,
    dateMatchesSubmission: true,
    recipientMatchesMerchant: true,
    successfulStatus: true
});

const noisyPhoneReading = extractGcashScreenshotFields(`
10:19AM 122 45% VoLTE 4G
163 965 140 4623
Sent via GCash
Amount 800.00
Total Amount Sent 800.00
Ref No. 1043 777 371807
Aug 09,2026 1:07 PM
`, { confidence: 74 });
assert.strictEqual(noisyPhoneReading.state, 'complete');
assert.strictEqual(noisyPhoneReading.fields.amount, 800);
assert.strictEqual(noisyPhoneReading.fields.reference, '1043777371807');
assert.strictEqual(noisyPhoneReading.fields.transactionAt, '2026-08-09T13:07');
assert.strictEqual(noisyPhoneReading.fields.recipientNumber, '+63 965 140 4623');
assert.strictEqual(noisyPhoneReading.fields.recipientName, '');
assert.strictEqual(shouldRunSupplementalOcr(noisyPhoneReading), true);

const partialOcr = extractGcashScreenshotFields(`
GCash
Total Amount Sent PHP 1,200.00
`, { confidence: 54.8 });
assert.strictEqual(shouldRunSupplementalOcr(partialOcr), true);
const visionReading = {
    ...normalizeVisionAiResponse({
        fields: {
            amount: 1200,
            reference: '7043 783 737299',
            transactionAt: '2026-08-09T16:34',
            recipientName: 'ARCHIE D.',
            recipientNumber: '09361565251',
            status: 'successful'
        },
        confidence: 94
    }),
    provider: 'Test vision provider',
    model: 'test-vision-model',
    cached: false
};
const hybridReading = mergeGcashVisionAnalysis(partialOcr, visionReading, {
    enabled: true,
    attempted: true,
    provider: 'Test vision provider',
    model: 'test-vision-model'
});
assert.strictEqual(hybridReading.source, 'hybrid');
assert.strictEqual(hybridReading.state, 'complete');
assert.strictEqual(hybridReading.fields.amount, 1200);
assert.strictEqual(hybridReading.fields.reference, '7043783737299');
assert.strictEqual(hybridReading.fields.status, 'successful');
assert.strictEqual(hybridReading.fieldSources.amount, 'local_ocr+vision_ai');
assert.strictEqual(hybridReading.fieldSources.reference, 'vision_ai');
assert.strictEqual(hybridReading.ai.used, true);
assert.strictEqual(hybridReading.ai.confidence, 94);
const sanitizedHybrid = sanitizeGcashProofAnalysis(hybridReading);
assert.strictEqual(sanitizedHybrid.ai.provider, 'Test vision provider');
assert.strictEqual(sanitizedHybrid.ai.model, 'test-vision-model');
assert.strictEqual(sanitizedHybrid.fieldSources.reference, 'vision_ai');
assert.strictEqual(sanitizedHybrid.endpoint, undefined);

const disabledVision = getGcashVisionAiDecision(partialOcr, { env: {} });
assert.strictEqual(disabledVision.use, false);
assert.strictEqual(disabledVision.metadata.status, 'disabled');
const enabledVisionEnv = {
    GCASH_VISION_AI_ENABLED: 'true',
    GCASH_VISION_AI_ENDPOINT: 'http://127.0.0.1:11434/v1/chat/completions',
    GCASH_VISION_AI_MODEL: 'local-vision-model'
};
assert.strictEqual(getGcashVisionAiDecision(partialOcr, { env: enabledVisionEnv }).use, true);
assert.strictEqual(getGcashVisionAiDecision(extracted, { env: enabledVisionEnv }).metadata.status, 'skipped');

const customerRoutes = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/customer-management/backend/customers.js'),
    'utf8'
);
assert(customerRoutes.includes("publicRouter.get('/payments/proof/context'"));
assert(customerRoutes.includes("publicRouter.post('/payments/proof'"));
assert(customerRoutes.includes("publicRouter.post('/payments/proof/analyze'"));
assert(customerRoutes.includes("isFeatureEnabled('paymentConfirmationQueue')"));
assert(customerRoutes.includes("getCustomerFromSession(req, res)"));
assert(customerRoutes.includes('amountValue - expectedAmount'));
assert(customerRoutes.includes("paymentMethod: 'GCash'"));
assert(customerRoutes.includes('buildCustomerGcashProofAnalysis'));
assert(customerRoutes.includes('analyzeGcashScreenshotEvidence'));
assert(customerRoutes.includes('imageMimeType: parsedProof.mimeType'));
assert(customerRoutes.includes('proofAnalysis'));
assert(customerRoutes.includes('listGcashTransactionHistory'));
assert(customerRoutes.includes('evaluateGcashTransactionMatch'));
assert(customerRoutes.includes('matched to imported official GCash history and approved by an Admin'));
assert(!customerRoutes.includes('gcash-notification-bridge-store'));

const customerPageSource = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/customer-app/web/customer-payment-proof.html'),
    'utf8'
);
const customerBrowserSource = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/customer-app/web/js/customer-payment-proof.js'),
    'utf8'
);
assert(customerPageSource.includes('id="proofAnalysisPanel"'));
assert(customerPageSource.includes('id="proofAnalysisSource"'));
assert(customerPageSource.includes('id="proofAnalysisHistory"'));
assert(customerPageSource.includes('Local OCR is used first'));
assert(customerBrowserSource.includes("apiJson('/api/customers/payments/proof/analyze'"));
assert(customerBrowserSource.includes('renderAnalysis(payload.analysis'));
assert(customerBrowserSource.includes('Local OCR + Vision AI'));
assert(customerBrowserSource.includes('analysis.historyMatch?.matched'));
assert(!customerBrowserSource.includes('bridgeMatch'));

const schemaSource = fs.readFileSync(path.join(projectRoot, 'scripts/schema.sql'), 'utf8');
assert(schemaSource.includes('proof_analysis_json LONGTEXT NULL'));

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(serverSource.includes("'customer-payment-proof.html'"));

const queueSource = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/billing/backend/payment-confirmations.js'),
    'utf8'
);
assert(queueSource.includes("router.post('/:id/approve'"));
assert(queueSource.includes("router.post('/:id/request-new-proof'"));
assert(queueSource.includes("status: 'needs_new_proof'"));
const requestNewProofRoute = queueSource.match(/router\.post\('\/:id\/request-new-proof'[\s\S]*?(?=router\.post\('\/:id\/approve')/)?.[0] || '';
assert(requestNewProofRoute.includes("status: 'needs_new_proof'"));
assert(!requestNewProofRoute.includes('recordApprovedProofPayment'));
assert(!requestNewProofRoute.includes('triggerBranchServiceRefresh'));
assert(queueSource.includes('recordApprovedProofPayment'));
assert(queueSource.includes('GCASH_HISTORY_MATCH_REQUIRED'));
assert(!queueSource.includes('gcash-notification-bridge-store'));
assert(queueSource.includes('GCASH_PROOF_FIELDS_LOCKED'));
assert(queueSource.includes('GCASH_SCREENSHOT_CONFLICT'));
assert(queueSource.includes('PAYMENT_ASSIGNMENT_CONFIRMATION_REQUIRED'));
assert(queueSource.includes('customerPhone: readCustomerPhone'));
assert(queueSource.includes("fieldSources[field] === 'vision_ai'"));

const adminQueuePage = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/billing/web/payment-confirmation-queue.html'),
    'utf8'
);
assert(adminQueuePage.includes('id="queueApproveProofAnalysis"'));
assert(adminQueuePage.includes('id="queueApproveAssignmentConfirmed"'));
assert(adminQueuePage.includes('Approve &amp; Post'));
assert(adminQueuePage.includes('Payment Confirmation Queue'));
assert(adminQueuePage.includes('Imported GCash Transactions'));
assert(!adminQueuePage.includes('id="queueTableBody"'));
assert(!adminQueuePage.includes('Proof (Image)'));
assert(!adminQueuePage.includes('Transaction Match'));
assert(!adminQueuePage.includes('queueBridgePanel'));
assert(!adminQueuePage.includes('queueGmailPanel'));

const adminQueueBrowser = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/billing/web/payment-confirmation-queue.js'),
    'utf8'
);
assert(adminQueueBrowser.includes('approveAmountInput.readOnly = isGcash'));
assert(adminQueueBrowser.includes('approveReferenceInput.readOnly = isGcash'));
assert(adminQueueBrowser.includes('Confirm that this transaction belongs to the displayed customer account'));
assert(adminQueueBrowser.includes('Local OCR + Vision AI'));
assert(adminQueueBrowser.includes('data-action="request-new-proof"'));
assert(adminQueueBrowser.includes('Customer was asked to submit new proof.'));
assert(adminQueueBrowser.includes('Official imported history'));
assert(!adminQueueBrowser.includes('/api/payment-bridge'));
assert(!adminQueueBrowser.includes('/gcash-gmail/'));

console.log('PASS customer GCash OCR/AI fallback, official-history verification, immutable proof fields, and explicit review outcome contracts');
