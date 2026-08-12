const crypto = require('crypto');
const createError = require('http-errors');

// This adapter intentionally targets the commonly supported OpenAI-compatible
// chat-completions shape instead of binding Billing to one vendor. Screenshots
// leave the ISP server only when GCASH_VISION_AI_ENABLED is explicitly enabled.

const DEFAULT_TIMEOUT_MS = 25 * 1000;
const MAX_TIMEOUT_MS = 60 * 1000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_LIMIT = 100;
const IN_FLIGHT_LIMIT = 3;
const DEFAULT_OCR_CONFIDENCE_THRESHOLD = 82;
const resultCache = new Map();
const inFlightRequests = new Map();

const toSafeText = (value, maxLength = 0) => {
    const text = String(value == null ? '' : value).trim();
    return maxLength > 0 ? text.slice(0, maxLength) : text;
};

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const clampNumber = (value, minimum, maximum, fallback = null) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(maximum, Math.max(minimum, numeric));
};

const normalizeMoney = (value) => {
    const numeric = Number(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100000000) return null;
    return Number(numeric.toFixed(2));
};

const normalizeReference = (value) => toSafeText(value, 64)
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/[^A-Z0-9]/g, '');

const normalizePhone = (value) => toSafeText(value, 40).replace(/[^+0-9() .-]/g, '');

const normalizeTransactionAt = (value) => {
    const text = toSafeText(value, 40);
    if (!text) return '';
    const match = text.match(/^(20\d{2}-[01]\d-[0-3]\d)(?:[T\s]([0-2]\d):([0-5]\d))?/);
    if (!match?.[2]) return '';
    return `${match[1]}T${match[2]}:${match[3]}`;
};

const normalizeStatus = (value) => {
    const status = toSafeText(value, 30).toLowerCase();
    if (['successful', 'success', 'completed', 'complete', 'paid'].includes(status)) return 'successful';
    if (['pending', 'processing', 'in_progress'].includes(status)) return 'pending';
    if (['failed', 'declined', 'reversed', 'unsuccessful'].includes(status)) return 'failed';
    return 'unknown';
};

const normalizeVisionAiResponse = (value) => {
    const root = value && typeof value === 'object' ? value : {};
    const fields = root.fields && typeof root.fields === 'object' ? root.fields : root;
    const recipientName = toSafeText(fields.recipientName ?? fields.recipient_name, 120);
    const recipientNumber = normalizePhone(fields.recipientNumber ?? fields.recipient_number);
    const recipient = toSafeText(fields.recipient, 180)
        || [recipientName, recipientNumber].filter(Boolean).join(' · ');
    const warnings = Array.isArray(root.warnings)
        ? root.warnings.map((item) => toSafeText(item, 180)).filter(Boolean).slice(0, 8)
        : [];
    return {
        fields: {
            amount: normalizeMoney(fields.amount),
            reference: normalizeReference(fields.reference ?? fields.referenceNumber ?? fields.reference_number),
            transactionAt: normalizeTransactionAt(fields.transactionAt ?? fields.transaction_at ?? fields.dateTime ?? fields.date_time),
            recipientName,
            recipientNumber,
            recipient,
            status: normalizeStatus(fields.status)
        },
        confidence: clampNumber(root.confidence, 0, 100, null),
        warnings
    };
};

const resolveGcashVisionAiConfig = (env = process.env) => {
    const enabled = isTruthy(env.GCASH_VISION_AI_ENABLED);
    const endpoint = toSafeText(env.GCASH_VISION_AI_ENDPOINT, 500);
    const model = toSafeText(env.GCASH_VISION_AI_MODEL, 120);
    const provider = toSafeText(env.GCASH_VISION_AI_PROVIDER, 60) || 'OpenAI-compatible';
    const apiKey = toSafeText(env.GCASH_VISION_AI_API_KEY || env.OPENAI_API_KEY, 1000);
    const timeoutMs = Math.round(clampNumber(env.GCASH_VISION_AI_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS));
    const ocrConfidenceThreshold = clampNumber(
        env.GCASH_VISION_AI_OCR_CONFIDENCE_THRESHOLD,
        0,
        100,
        DEFAULT_OCR_CONFIDENCE_THRESHOLD
    );
    let endpointValid = false;
    if (endpoint) {
        try {
            const url = new URL(endpoint);
            endpointValid = ['http:', 'https:'].includes(url.protocol);
        } catch {
            endpointValid = false;
        }
    }
    return {
        enabled,
        configured: Boolean(enabled && endpointValid && model),
        endpoint,
        endpointValid,
        model,
        provider,
        apiKey,
        timeoutMs,
        ocrConfidenceThreshold
    };
};

const hasRequiredLocalFields = (analysis) => {
    const fields = analysis?.fields || {};
    return fields.amount != null
        && Boolean(fields.reference)
        && Boolean(fields.transactionAt)
        && Boolean(fields.recipient || fields.recipientNumber)
        && String(fields.status || 'unknown') !== 'unknown';
};

const getGcashVisionAiDecision = (analysis, { env = process.env } = {}) => {
    const config = resolveGcashVisionAiConfig(env);
    const safe = {
        enabled: config.enabled,
        attempted: false,
        used: false,
        provider: config.provider,
        model: config.model,
        confidence: null,
        cached: false
    };
    if (!config.enabled) {
        return { use: false, config, metadata: { ...safe, status: 'disabled', reason: 'Vision AI fallback is not enabled.' } };
    }
    if (!config.configured) {
        return {
            use: false,
            config,
            metadata: {
                ...safe,
                status: 'not_configured',
                reason: !config.endpoint || !config.model
                    ? 'Vision AI endpoint and model are not configured.'
                    : 'Vision AI endpoint must use HTTP or HTTPS.'
            }
        };
    }
    const confidence = Number(analysis?.confidence);
    const localComplete = analysis?.state === 'complete' && hasRequiredLocalFields(analysis);
    if (localComplete && Number.isFinite(confidence) && confidence >= config.ocrConfidenceThreshold) {
        return {
            use: false,
            config,
            metadata: { ...safe, status: 'skipped', reason: 'Local OCR was complete and sufficiently clear.' }
        };
    }
    return {
        use: true,
        config,
        metadata: { ...safe, attempted: true, status: 'ready', reason: 'Local OCR was incomplete or low-confidence.' }
    };
};

const readJsonContent = (content) => {
    const text = Array.isArray(content)
        ? content.map((item) => toSafeText(item?.text ?? item?.content, 10000)).filter(Boolean).join('\n')
        : toSafeText(content, 20000);
    const unwrapped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const start = unwrapped.indexOf('{');
    const end = unwrapped.lastIndexOf('}');
    if (start < 0 || end <= start) throw createError(502, 'Vision AI did not return structured JSON.');
    try {
        return JSON.parse(unwrapped.slice(start, end + 1));
    } catch {
        throw createError(502, 'Vision AI returned invalid structured JSON.');
    }
};

const pruneCache = () => {
    const now = Date.now();
    for (const [key, entry] of resultCache.entries()) {
        if (!entry || now - entry.createdAt > CACHE_TTL_MS) resultCache.delete(key);
    }
    while (resultCache.size > CACHE_LIMIT) resultCache.delete(resultCache.keys().next().value);
};

const buildCacheKey = (buffer, config) => crypto.createHash('sha256')
    .update(buffer)
    .update('\0')
    .update(config.endpoint)
    .update('\0')
    .update(config.model)
    .update('\0')
    .update(crypto.createHash('sha256').update(config.apiKey || '').digest('hex'))
    .digest('hex');

const analyzeGcashScreenshotWithVision = async (buffer, {
    mimeType = 'image/jpeg',
    env = process.env,
    fetchImpl = globalThis.fetch
} = {}) => {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw createError(400, 'A valid screenshot image is required for Vision AI.');
    const config = resolveGcashVisionAiConfig(env);
    if (!config.configured) throw createError(503, 'Vision AI fallback is not configured.');
    if (typeof fetchImpl !== 'function') throw createError(503, 'This Node.js runtime does not provide the fetch API required by Vision AI.');
    const cacheKey = buildCacheKey(buffer, config);
    pruneCache();
    const cached = resultCache.get(cacheKey);
    if (cached) return { ...cached.result, cached: true };
    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) return { ...(await inFlight), cached: true };
    if (inFlightRequests.size >= IN_FLIGHT_LIMIT) throw createError(503, 'Vision AI analyzer is busy.');

    const request = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
            const response = await fetchImpl(config.endpoint, {
                method: 'POST',
                headers,
                signal: controller.signal,
                body: JSON.stringify({
                    model: config.model,
                    temperature: 0,
                    max_tokens: 500,
                    response_format: { type: 'json_object' },
                    messages: [
                        {
                            role: 'system',
                            content: 'You extract visible fields from GCash payment receipt screenshots. Never infer or invent hidden values. Return JSON only.'
                        },
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: 'Read only what is visibly present. Return {"fields":{"amount":number|null,"reference":string|null,"transactionAt":"YYYY-MM-DDTHH:mm"|null,"recipientName":string|null,"recipientNumber":string|null,"status":"successful"|"pending"|"failed"|"unknown"},"confidence":number,"warnings":string[]}. Use null for anything unreadable.'
                                },
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: `data:${toSafeText(mimeType, 60) || 'image/jpeg'};base64,${buffer.toString('base64')}`,
                                        detail: 'high'
                                    }
                                }
                            ]
                        }
                    ]
                })
            });
            if (!response?.ok) {
                throw createError(502, `Vision AI request failed with status ${Number(response?.status) || 'unknown'}.`);
            }
            const payload = await response.json().catch(() => null);
            const content = payload?.choices?.[0]?.message?.content;
            const normalized = normalizeVisionAiResponse(readJsonContent(content));
            const result = {
                ...normalized,
                provider: config.provider,
                model: config.model,
                analyzedAt: new Date().toISOString()
            };
            resultCache.set(cacheKey, { createdAt: Date.now(), result });
            pruneCache();
            return result;
        } catch (error) {
            if (error?.name === 'AbortError') throw createError(504, 'Vision AI analysis timed out.');
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    })();
    inFlightRequests.set(cacheKey, request);
    try {
        return { ...(await request), cached: false };
    } finally {
        inFlightRequests.delete(cacheKey);
    }
};

module.exports = {
    analyzeGcashScreenshotWithVision,
    getGcashVisionAiDecision,
    normalizeVisionAiResponse,
    resolveGcashVisionAiConfig
};
