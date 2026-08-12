const crypto = require('crypto');
const createError = require('http-errors');
const { createWorker, OEM, PSM } = require('tesseract.js');
const englishData = require('@tesseract.js-data/eng');
const {
    analyzeGcashScreenshotWithVision,
    getGcashVisionAiDecision
} = require('./gcash-vision-ai');

// The field extraction rules are adapted for the same GCash labels handled by
// AJAbanto/Gcash_screenshot_parser (MIT, 2022). OCR is supporting evidence only;
// this module never confirms or posts a payment.

const OCR_TIMEOUT_MS = 60 * 1000;
const OCR_CACHE_TTL_MS = 15 * 60 * 1000;
const OCR_CACHE_LIMIT = 100;
const OCR_QUEUE_LIMIT = 5;
const OCR_SUPPLEMENTAL_CONFIDENCE_THRESHOLD = 85;
const MONTHS = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12
};

let workerPromise = null;
let recognizeQueue = Promise.resolve();
const resultCache = new Map();
const inFlightAnalyses = new Map();

const toSafeText = (value, maxLength = 0) => {
    const text = String(value == null ? '' : value).trim();
    return maxLength > 0 ? text.slice(0, maxLength) : text;
};

const roundConfidence = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Number(numeric.toFixed(1)) : null;
};

const normalizeOcrText = (value) => String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[₽]/g, '₱')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const normalizeReference = (value) => toSafeText(value, 64)
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/[^A-Z0-9]/g, '');

const normalizeReferenceOcrDigits = (value) => String(value || '')
    .toUpperCase()
    .replace(/[OQD]/g, '0')
    .replace(/[IL|]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/[^0-9]/g, '');

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('63') && digits.length === 12) return `0${digits.slice(2)}`;
    return digits;
};

const extractPhilippineRecipientNumber = (value) => {
    const matches = String(value || '').matchAll(/(?:\+?\s*(?:1\s*)?63|0)[\s-]*9\d{2}[\s-]*\d{3}[\s-]*\d{4}/g);
    for (const match of matches) {
        let digits = String(match[0] || '').replace(/\D/g, '');
        if (digits.length === 13 && digits.startsWith('163')) digits = digits.slice(1);
        if (digits.length === 11 && digits.startsWith('09')) digits = `63${digits.slice(1)}`;
        if (digits.length !== 12 || !digits.startsWith('639')) continue;
        return `+63 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
    }
    return '';
};

const cleanRecipientNameCandidate = (value, { requireReceiptStyle = false } = {}) => {
    const candidate = toSafeText(value, 120);
    if (!candidate) return '';
    if (/\b\d{1,2}[:.]\d{2}\s*(?:AM|PM)?\b|\d{1,3}%|\b(?:LTE|VoLTE|Wi-?Fi|[345]G)\b/i.test(candidate)) return '';
    if (/express\s+send|send\s+money|sent\s+via\s+gcash|recipient|sent\s+to|paid\s+to|\bamount\b|\btotal\b|\bref(?:erence)?\b|download|share/i.test(candidate)) return '';
    if ((candidate.match(/\d/g) || []).length > 1) return '';
    const cleaned = candidate
        .replace(/[^A-Za-z\u00c0-\u00ff*\u2022\u00b7.' -]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[^A-Za-z\u00c0-\u00ff]+|[^A-Za-z\u00c0-\u00ff.*\u2022\u00b7]+$/g, '')
        .trim();
    const letterCount = (cleaned.match(/[A-Za-z\u00c0-\u00ff]/g) || []).length;
    if (letterCount < 2 || cleaned.length > 60 || cleaned.split(/\s+/).length > 6) return '';
    if (requireReceiptStyle) {
        const latinLetters = cleaned.match(/[A-Za-z]/g) || [];
        const uppercaseCount = latinLetters.filter((letter) => letter === letter.toUpperCase()).length;
        if (latinLetters.length && uppercaseCount / latinLetters.length < 0.75) return '';
    }
    return cleaned;
};

const phoneMatches = (left, right) => {
    const first = normalizePhone(left);
    const second = normalizePhone(right);
    if (!first || !second) return false;
    return first === second || first.slice(-10) === second.slice(-10);
};

const normalizeMoney = (value) => {
    const numeric = Number(String(value == null ? '' : value).replace(/[,\s]/g, ''));
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100000000) return null;
    return Number(numeric.toFixed(2));
};

const parseMoneyFromText = (value) => {
    const text = String(value || '');
    const currencyMatch = text.match(/(?:PHP|PESO(?:S)?|₱|\bP)\s*([0-9][0-9,\s]*(?:\.\d{1,2})?)/i);
    if (currencyMatch) return normalizeMoney(currencyMatch[1]);
    const decimalMatches = Array.from(text.matchAll(/(?:^|\s)([0-9][0-9,]*(?:\.\d{2}))(?:\s|$)/g));
    if (decimalMatches.length) return normalizeMoney(decimalMatches[decimalMatches.length - 1][1]);
    return null;
};

const extractAmount = (lines) => {
    const candidates = [];
    lines.forEach((line, index) => {
        const normalized = line.toLowerCase();
        const nextLine = lines[index + 1] || '';
        const combined = `${line} ${nextLine}`;
        const amount = parseMoneyFromText(line) ?? parseMoneyFromText(combined);
        if (amount == null) return;
        let priority = 10;
        if (/total\s+amount\s+(?:sent|paid)|amount\s+(?:sent|paid|due)|total\s+(?:paid|sent)/i.test(normalized)) priority = 100;
        else if (/\bamount\b|\btotal\b/i.test(normalized)) priority = 80;
        else if (/(?:PHP|PESO(?:S)?|₱)/i.test(line)) priority = 60;
        candidates.push({ amount, priority, index });
    });
    candidates.sort((left, right) => right.priority - left.priority || left.index - right.index);
    return candidates[0]?.amount ?? null;
};

const extractReference = (lines, rawText) => {
    for (const line of lines) {
        const match = line.match(/(?:ref(?:erence)?\s*(?:no|number)?\.?|transaction\s*(?:no|number|id))\s*[:#.-]*\s*([0-9OQDILSB|][0-9OQDILSB|\s-]{7,30})/i);
        if (!match) continue;
        const numeric = normalizeReferenceOcrDigits(match[1]);
        if (numeric.length >= 10 && numeric.length <= 18) return numeric;
        const normalized = normalizeReference(match[1]);
        if (normalized.length >= 8) return normalized;
    }
    for (const line of lines) {
        const beforeDate = line.split(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i)[0];
        const withoutMoney = beforeDate.replace(/(?:PHP|PESO(?:S)?|₱|\bP)?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})/gi, ' ');
        const candidates = Array.from(withoutMoney.matchAll(/[0-9][0-9\s-]{9,28}/g));
        for (const candidate of candidates) {
            const numeric = normalizeReferenceOcrDigits(candidate[0]);
            if (numeric.length >= 12 && numeric.length <= 14 && !/^63\d{10}$/.test(numeric)) return numeric;
        }
    }
    return '';
};

const pad2 = (value) => String(value).padStart(2, '0');

const buildLocalDateTime = ({ year, month, day, hour = 0, minute = 0, meridiem = '' }) => {
    let resolvedHour = Number(hour) || 0;
    const marker = String(meridiem || '').toUpperCase();
    if (marker === 'PM' && resolvedHour < 12) resolvedHour += 12;
    if (marker === 'AM' && resolvedHour === 12) resolvedHour = 0;
    const values = [year, month, day, resolvedHour, minute].map(Number);
    if (!values.every(Number.isFinite)) return '';
    if (values[0] < 2000 || values[0] > 2100 || values[1] < 1 || values[1] > 12 || values[2] < 1 || values[2] > 31) return '';
    if (values[3] < 0 || values[3] > 23 || values[4] < 0 || values[4] > 59) return '';
    return `${values[0]}-${pad2(values[1])}-${pad2(values[2])}T${pad2(values[3])}:${pad2(values[4])}`;
};

const extractTransactionAt = (rawText) => {
    const text = String(rawText || '').replace(/\n/g, ' ');
    const monthPattern = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
    const monthMatch = text.match(new RegExp(`${monthPattern}\\s+(\\d{1,2})\\s*,?\\s*(\\d{4})\\s+(\\d{1,2})[:.]([0-5]\\d)\\s*(AM|PM)`, 'i'));
    if (monthMatch) {
        return buildLocalDateTime({
            year: monthMatch[3],
            month: MONTHS[String(monthMatch[1]).toLowerCase()],
            day: monthMatch[2],
            hour: monthMatch[4],
            minute: monthMatch[5],
            meridiem: monthMatch[6]
        });
    }

    const isoMatch = text.match(/\b(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)(?:\s+|T)([0-2]?\d)[:.]([0-5]\d)(?:\s*(AM|PM))?/i);
    if (isoMatch) {
        return buildLocalDateTime({
            year: isoMatch[1],
            month: isoMatch[2],
            day: isoMatch[3],
            hour: isoMatch[4],
            minute: isoMatch[5],
            meridiem: isoMatch[6]
        });
    }

    const numericMatch = text.match(/\b([01]?\d)[/-]([0-3]?\d)[/-](20\d{2})(?:\s+)([0-2]?\d)[:.]([0-5]\d)(?:\s*(AM|PM))?/i);
    if (numericMatch) {
        return buildLocalDateTime({
            year: numericMatch[3],
            month: numericMatch[1],
            day: numericMatch[2],
            hour: numericMatch[4],
            minute: numericMatch[5],
            meridiem: numericMatch[6]
        });
    }
    return '';
};

const extractRecipient = (lines, rawText) => {
    const recipientNumber = extractPhilippineRecipientNumber(rawText);
    let recipientName = '';

    if (recipientNumber) {
        const phoneSuffix = normalizePhone(recipientNumber).slice(-10);
        const phoneIndex = lines.findIndex((line) => normalizePhone(line).includes(phoneSuffix));
        for (let index = phoneIndex - 1; index >= Math.max(0, phoneIndex - 3); index -= 1) {
            const candidate = cleanRecipientNameCandidate(lines[index], { requireReceiptStyle: true });
            if (!candidate) continue;
            recipientName = candidate;
            break;
        }
    }

    if (!recipientName) {
        for (let index = 0; index < lines.length; index += 1) {
            const match = lines[index].match(/(?:sent\s+to|paid\s+to|recipient)\s*[:.-]*\s*(.+)$/i);
            if (match?.[1]) {
                recipientName = cleanRecipientNameCandidate(match[1]);
                break;
            }
        }
    }

    return {
        recipientName,
        recipientNumber,
        recipient: [recipientName, recipientNumber].filter(Boolean).join(' · ')
    };
};

const extractStatus = (rawText) => {
    const text = String(rawText || '').toLowerCase();
    if (/transaction\s+(?:failed|unsuccessful)|payment\s+(?:failed|unsuccessful)|not\s+sent|declined|reversed/.test(text)) return 'failed';
    if (/transaction\s+pending|payment\s+pending|processing|in\s+progress/.test(text)) return 'pending';
    if (/transaction\s+(?:successful|complete(?:d)?)|successfully\s+(?:sent|paid)|payment\s+(?:successful|complete(?:d)?)|total\s+amount\s+sent|sent\s+via\s+gcash|amount\s+sent/.test(text)) return 'successful';
    return 'unknown';
};

const extractGcashScreenshotFields = (rawText, { confidence = null } = {}) => {
    const text = normalizeOcrText(rawText);
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const recipient = extractRecipient(lines, text);
    const fields = {
        amount: extractAmount(lines),
        reference: extractReference(lines, text),
        transactionAt: extractTransactionAt(text),
        ...recipient,
        status: extractStatus(text)
    };
    const missing = [];
    if (fields.amount == null) missing.push('amount');
    if (!fields.reference) missing.push('reference number');
    if (!fields.transactionAt) missing.push('date and time');
    if (!fields.recipient) missing.push('recipient');
    if (fields.status === 'unknown') missing.push('transaction status');
    const state = !text
        ? 'unreadable'
        : (missing.length ? 'partial' : 'complete');
    return {
        engine: 'tesseract.js',
        parser: 'gcash-label-parser-v2',
        source: 'screenshot_ocr',
        state,
        confidence: roundConfidence(confidence),
        fields,
        missing,
        warnings: missing.length
            ? [`Could not reliably read: ${missing.join(', ')}.`]
            : [],
        analyzedAt: new Date().toISOString()
    };
};

const ANALYSIS_FIELD_LABELS = {
    amount: 'amount',
    reference: 'reference number',
    transactionAt: 'date and time',
    recipient: 'recipient',
    status: 'transaction status'
};

const isAnalysisFieldPresent = (field, value) => {
    if (field === 'amount') return normalizeMoney(value) != null;
    if (field === 'status') return ['successful', 'pending', 'failed'].includes(String(value || '').toLowerCase());
    return Boolean(toSafeText(value));
};

const buildLocalFieldSources = (fields = {}) => {
    const sources = {};
    ['amount', 'reference', 'transactionAt', 'recipientName', 'recipientNumber', 'recipient', 'status'].forEach((field) => {
        sources[field] = isAnalysisFieldPresent(field, fields[field]) ? 'local_ocr' : null;
    });
    return sources;
};

const analysisValuesAgree = (field, left, right) => {
    if (!isAnalysisFieldPresent(field, left) || !isAnalysisFieldPresent(field, right)) return false;
    if (field === 'amount') return normalizeMoney(left) === normalizeMoney(right);
    if (field === 'reference') return normalizeReference(left) === normalizeReference(right);
    if (field === 'recipientNumber') return phoneMatches(left, right);
    if (field === 'transactionAt') return String(left).slice(0, 16) === String(right).slice(0, 16);
    return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
};

const getMissingAnalysisFields = (fields = {}) => Object.entries(ANALYSIS_FIELD_LABELS)
    .filter(([field]) => !isAnalysisFieldPresent(field, fields[field]))
    .map(([, label]) => label);

const mergeGcashVisionAnalysis = (baseAnalysis, visionAnalysis, metadata = {}) => {
    const localFields = baseAnalysis?.fields || {};
    const visionFields = visionAnalysis?.fields || {};
    const fields = { ...localFields };
    const fieldSources = buildLocalFieldSources(localFields);
    const warnings = Array.isArray(baseAnalysis?.warnings) ? baseAnalysis.warnings.slice() : [];
    const comparisonLabels = {
        amount: 'amount',
        reference: 'reference number',
        transactionAt: 'date/time',
        recipientNumber: 'recipient number',
        status: 'transaction status'
    };

    ['amount', 'reference', 'transactionAt', 'recipientName', 'recipientNumber', 'status'].forEach((field) => {
        const localPresent = isAnalysisFieldPresent(field, fields[field]);
        const visionPresent = isAnalysisFieldPresent(field, visionFields[field]);
        if (!localPresent && visionPresent) {
            fields[field] = visionFields[field];
            fieldSources[field] = 'vision_ai';
            return;
        }
        if (localPresent && visionPresent) {
            if (analysisValuesAgree(field, fields[field], visionFields[field])) {
                fieldSources[field] = 'local_ocr+vision_ai';
            } else if (comparisonLabels[field]) {
                warnings.push(`Vision AI read a different ${comparisonLabels[field]} than local OCR. Admin must compare the screenshot manually.`);
            }
        }
    });

    const composedRecipient = [fields.recipientName, fields.recipientNumber].filter(Boolean).join(' · ');
    if (!isAnalysisFieldPresent('recipient', fields.recipient) && composedRecipient) {
        fields.recipient = composedRecipient;
        fieldSources.recipient = fieldSources.recipientName === 'vision_ai' || fieldSources.recipientNumber === 'vision_ai'
            ? 'vision_ai'
            : (fieldSources.recipientName || fieldSources.recipientNumber || null);
    } else if (isAnalysisFieldPresent('recipient', fields.recipient) && isAnalysisFieldPresent('recipient', visionFields.recipient)) {
        fieldSources.recipient = analysisValuesAgree('recipient', fields.recipient, visionFields.recipient)
            ? 'local_ocr+vision_ai'
            : (fieldSources.recipient || 'local_ocr');
    }

    (visionAnalysis?.warnings || []).forEach((warning) => {
        const text = toSafeText(warning, 180);
        if (text) warnings.push(`Vision AI: ${text}`);
    });
    const missing = getMissingAnalysisFields(fields);
    if (missing.length) warnings.push(`Could not reliably read: ${missing.join(', ')}.`);
    const localHasFields = Object.values(buildLocalFieldSources(localFields)).some(Boolean);
    const visionFilledFields = Object.values(fieldSources).some((source) => source === 'vision_ai');
    const state = missing.length
        ? (Object.values(fieldSources).some(Boolean) ? 'partial' : 'unreadable')
        : 'complete';
    return {
        ...baseAnalysis,
        engine: localHasFields ? 'tesseract.js + vision-ai' : 'vision-ai',
        parser: 'gcash-label-parser-v2',
        source: localHasFields ? 'hybrid' : 'vision_ai',
        state,
        fields,
        fieldSources,
        missing,
        warnings: Array.from(new Set(warnings.filter(Boolean))),
        ai: {
            ...metadata,
            attempted: true,
            used: true,
            status: 'used',
            provider: visionAnalysis?.provider || metadata.provider || '',
            model: visionAnalysis?.model || metadata.model || '',
            confidence: roundConfidence(visionAnalysis?.confidence),
            cached: Boolean(visionAnalysis?.cached),
            reason: visionFilledFields
                ? 'Vision AI filled fields that local OCR could not read.'
                : 'Vision AI compared its reading with the local OCR result.'
        },
        analyzedAt: new Date().toISOString()
    };
};

const buildOcrFailureAnalysis = (error) => ({
    engine: 'tesseract.js',
    parser: 'gcash-label-parser-v1',
    source: 'screenshot_ocr',
    state: 'error',
    confidence: null,
    fields: {
        amount: null,
        reference: '',
        transactionAt: '',
        recipientName: '',
        recipientNumber: '',
        recipient: '',
        status: 'unknown'
    },
    missing: Object.values(ANALYSIS_FIELD_LABELS),
    warnings: [toSafeText(error?.message, 200) || 'Local screenshot OCR could not read this image.'],
    analyzedAt: new Date().toISOString()
});

const buildGcashScreenshotChecks = (analysis, {
    expectedAmount = null,
    submittedReference = '',
    submittedPaymentDate = '',
    merchantNumber = ''
} = {}) => {
    const fields = analysis?.fields || {};
    const expectedMoney = normalizeMoney(expectedAmount);
    const submittedDate = String(submittedPaymentDate || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
    const extractedDate = String(fields.transactionAt || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
    return {
        amountMatchesInvoice: fields.amount == null || expectedMoney == null
            ? null
            : fields.amount === expectedMoney,
        referenceMatchesSubmission: !fields.reference || !submittedReference
            ? null
            : normalizeReference(fields.reference) === normalizeReference(submittedReference),
        dateMatchesSubmission: !extractedDate || !submittedDate
            ? null
            : extractedDate === submittedDate,
        recipientMatchesMerchant: !fields.recipientNumber || !normalizePhone(merchantNumber)
            ? null
            : phoneMatches(fields.recipientNumber, merchantNumber),
        successfulStatus: fields.status === 'unknown'
            ? null
            : fields.status === 'successful'
    };
};

const sanitizeGcashProofAnalysis = (value) => {
    const fields = value?.fields || {};
    const fieldSources = value?.fieldSources || {};
    const checks = value?.checks || {};
    const historyMatch = value?.historyMatch || null;
    const ai = value?.ai && typeof value.ai === 'object' ? value.ai : null;
    const sanitizeFieldSource = (source) => ['local_ocr', 'vision_ai', 'local_ocr+vision_ai'].includes(source)
        ? source
        : null;
    return {
        engine: toSafeText(value?.engine, 40) || 'tesseract.js',
        parser: toSafeText(value?.parser, 60) || 'gcash-label-parser-v1',
        source: ['screenshot_ocr', 'hybrid', 'vision_ai'].includes(value?.source) ? value.source : 'screenshot_ocr',
        state: ['complete', 'partial', 'unreadable', 'error'].includes(value?.state) ? value.state : 'partial',
        confidence: roundConfidence(value?.confidence),
        fields: {
            amount: normalizeMoney(fields.amount),
            reference: normalizeReference(fields.reference).slice(0, 64),
            transactionAt: toSafeText(fields.transactionAt, 32),
            recipientName: toSafeText(fields.recipientName, 120),
            recipientNumber: toSafeText(fields.recipientNumber, 40),
            recipient: toSafeText(fields.recipient, 180),
            status: ['successful', 'pending', 'failed', 'unknown'].includes(fields.status) ? fields.status : 'unknown'
        },
        fieldSources: {
            amount: sanitizeFieldSource(fieldSources.amount),
            reference: sanitizeFieldSource(fieldSources.reference),
            transactionAt: sanitizeFieldSource(fieldSources.transactionAt),
            recipientName: sanitizeFieldSource(fieldSources.recipientName),
            recipientNumber: sanitizeFieldSource(fieldSources.recipientNumber),
            recipient: sanitizeFieldSource(fieldSources.recipient),
            status: sanitizeFieldSource(fieldSources.status)
        },
        missing: Array.isArray(value?.missing) ? value.missing.map((item) => toSafeText(item, 60)).filter(Boolean).slice(0, 8) : [],
        warnings: Array.isArray(value?.warnings) ? value.warnings.map((item) => toSafeText(item, 240)).filter(Boolean).slice(0, 16) : [],
        checks: {
            amountMatchesInvoice: typeof checks.amountMatchesInvoice === 'boolean' ? checks.amountMatchesInvoice : null,
            referenceMatchesSubmission: typeof checks.referenceMatchesSubmission === 'boolean' ? checks.referenceMatchesSubmission : null,
            dateMatchesSubmission: typeof checks.dateMatchesSubmission === 'boolean' ? checks.dateMatchesSubmission : null,
            recipientMatchesMerchant: typeof checks.recipientMatchesMerchant === 'boolean' ? checks.recipientMatchesMerchant : null,
            successfulStatus: typeof checks.successfulStatus === 'boolean' ? checks.successfulStatus : null
        },
        historyMatch: historyMatch && typeof historyMatch === 'object' ? {
            matched: Boolean(historyMatch.matched),
            status: toSafeText(historyMatch.status, 60),
            message: toSafeText(historyMatch.message, 300),
            checks: historyMatch.checks && typeof historyMatch.checks === 'object'
                ? historyMatch.checks
                : {}
        } : null,
        ai: ai ? {
            enabled: Boolean(ai.enabled),
            attempted: Boolean(ai.attempted),
            used: Boolean(ai.used),
            status: ['disabled', 'not_configured', 'skipped', 'ready', 'used', 'failed'].includes(ai.status)
                ? ai.status
                : 'failed',
            provider: toSafeText(ai.provider, 60),
            model: toSafeText(ai.model, 120),
            confidence: roundConfidence(ai.confidence),
            cached: Boolean(ai.cached),
            reason: toSafeText(ai.reason, 240)
        } : null,
        analyzedAt: toSafeText(value?.analyzedAt, 40) || new Date().toISOString()
    };
};

const pruneCache = () => {
    const now = Date.now();
    for (const [key, entry] of resultCache.entries()) {
        if (!entry || now - entry.createdAt > OCR_CACHE_TTL_MS) resultCache.delete(key);
    }
    while (resultCache.size > OCR_CACHE_LIMIT) {
        resultCache.delete(resultCache.keys().next().value);
    }
};

const getWorker = async () => {
    if (!workerPromise) {
        workerPromise = createWorker(englishData.code, OEM.LSTM, {
            langPath: englishData.langPath,
            gzip: englishData.gzip,
            cacheMethod: 'readOnly'
        }).then(async (worker) => {
            await worker.setParameters({
                preserve_interword_spaces: '1',
                user_defined_dpi: '300'
            });
            return worker;
        }).catch((error) => {
            workerPromise = null;
            throw error;
        });
    }
    return workerPromise;
};

const recognizeBuffer = async (buffer, pageSegMode = PSM.SINGLE_BLOCK) => {
    const worker = await getWorker();
    await worker.setParameters({ tessedit_pageseg_mode: pageSegMode });
    const recognizePromise = worker.recognize(buffer, { rotateAuto: true });
    let timeoutId;
    try {
        return await Promise.race([
            recognizePromise,
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(createError(504, 'Screenshot OCR timed out. You may still submit it for manual review.')), OCR_TIMEOUT_MS);
            })
        ]);
    } finally {
        clearTimeout(timeoutId);
    }
};

const buildAnalysisFromRecognitions = (recognitions = []) => {
    const usable = recognitions.filter((item) => item?.recognized?.data);
    const confidence = usable.reduce((highest, item) => {
        const value = Number(item.recognized.data.confidence);
        return Number.isFinite(value) ? Math.max(highest, value) : highest;
    }, 0);
    const result = extractGcashScreenshotFields(
        usable.map((item) => item.recognized.data.text).filter(Boolean).join('\n'),
        { confidence: usable.length ? confidence : null }
    );
    result.ocrPasses = usable.map((item) => item.name);
    return result;
};

const shouldRunSupplementalOcr = (analysis) => {
    const confidence = Number(analysis?.confidence);
    return analysis?.state !== 'complete'
        || !Number.isFinite(confidence)
        || confidence < OCR_SUPPLEMENTAL_CONFIDENCE_THRESHOLD;
};

const shouldRunSparseOcr = (analysis) => analysis?.state !== 'complete'
    && (analysis?.missing || []).some((field) => ['reference number', 'date and time', 'recipient'].includes(field));

const analyzeGcashScreenshotBuffer = async (buffer) => {
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
        throw createError(400, 'A valid screenshot image is required for OCR.');
    }
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    pruneCache();
    const cached = resultCache.get(sha256);
    if (cached) return { ...cached.result, cached: true, sha256 };
    const inFlight = inFlightAnalyses.get(sha256);
    if (inFlight) return { ...(await inFlight), cached: true, sha256 };
    if (inFlightAnalyses.size >= OCR_QUEUE_LIMIT) {
        throw createError(503, 'Screenshot analyzer is busy. You may retry or submit the proof for manual review.');
    }

    const task = recognizeQueue.catch(() => {}).then(async () => {
        const secondCached = resultCache.get(sha256);
        if (secondCached) return secondCached.result;
        const recognitions = [];
        try {
            recognitions.push({
                name: 'single_block',
                recognized: await recognizeBuffer(buffer, PSM.SINGLE_BLOCK)
            });
            let result = buildAnalysisFromRecognitions(recognitions);
            if (shouldRunSupplementalOcr(result)) {
                recognitions.push({
                    name: 'auto',
                    recognized: await recognizeBuffer(buffer, PSM.AUTO)
                });
                result = buildAnalysisFromRecognitions(recognitions);
            }
            if (shouldRunSparseOcr(result)) {
                recognitions.push({
                    name: 'sparse_text',
                    recognized: await recognizeBuffer(buffer, PSM.SPARSE_TEXT)
                });
                result = buildAnalysisFromRecognitions(recognitions);
            }
            resultCache.set(sha256, { createdAt: Date.now(), result });
            pruneCache();
            return result;
        } catch (error) {
            const timedOut = Number(error?.status || error?.statusCode) === 504;
            if (timedOut && workerPromise) {
                const currentWorker = workerPromise;
                workerPromise = null;
                Promise.resolve(currentWorker).then((worker) => worker.terminate()).catch(() => {});
            }
            throw error;
        }
    });
    inFlightAnalyses.set(sha256, task);
    recognizeQueue = task.catch(() => {});
    try {
        const result = await task;
        return { ...result, cached: false, sha256 };
    } finally {
        inFlightAnalyses.delete(sha256);
    }
};

const analyzeGcashScreenshotEvidence = async (buffer, {
    mimeType = 'image/jpeg',
    env = process.env,
    fetchImpl = globalThis.fetch
} = {}) => {
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
        throw createError(400, 'A valid screenshot image is required for analysis.');
    }
    let baseAnalysis;
    try {
        baseAnalysis = await analyzeGcashScreenshotBuffer(buffer);
    } catch (error) {
        baseAnalysis = buildOcrFailureAnalysis(error);
    }
    const decision = getGcashVisionAiDecision(baseAnalysis, { env });
    const localResult = {
        ...baseAnalysis,
        fieldSources: buildLocalFieldSources(baseAnalysis.fields),
        ai: decision.metadata
    };
    if (!decision.use) return localResult;
    try {
        const visionAnalysis = await analyzeGcashScreenshotWithVision(buffer, {
            mimeType,
            env,
            fetchImpl
        });
        return mergeGcashVisionAnalysis(localResult, visionAnalysis, decision.metadata);
    } catch (error) {
        const reason = Number(error?.status || error?.statusCode) === 504
            ? 'Vision AI analysis timed out.'
            : 'Vision AI analysis was unavailable.';
        return {
            ...localResult,
            warnings: Array.from(new Set([
                ...(localResult.warnings || []),
                `${reason} Admin will review the screenshot manually.`
            ])),
            ai: {
                ...decision.metadata,
                attempted: true,
                used: false,
                status: 'failed',
                reason
            }
        };
    }
};

const terminateGcashOcrWorker = async () => {
    const current = workerPromise;
    workerPromise = null;
    if (!current) return;
    const worker = await current.catch(() => null);
    if (worker) await worker.terminate();
};

module.exports = {
    analyzeGcashScreenshotBuffer,
    analyzeGcashScreenshotEvidence,
    buildGcashScreenshotChecks,
    extractGcashScreenshotFields,
    mergeGcashVisionAnalysis,
    normalizeReference,
    normalizePhone,
    phoneMatches,
    sanitizeGcashProofAnalysis,
    shouldRunSupplementalOcr,
    terminateGcashOcrWorker
};
