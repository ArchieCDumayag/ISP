const express = require('express');
const { requireAuth } = require('./auth');
const { readJson, writeJson } = require('./data-store');
const { query } = require('./db');
const { isRelationalReady } = require('./db-relational');
const { loadIntegrationSettings } = require('./integration-settings');

const router = express.Router();
const PROFILE_KEY = 'business-profile';
const PROFILE_CACHE_TTL_MS = 30 * 1000;
const profileCache = new Map();
const MIME_TYPE_TO_EXTENSION = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg'
};
const asText = (value) => String(value ?? '').trim();
const DEFAULT_PROFILE = {
    businessName: asText(process.env.BUSINESS_NAME || process.env.INITIAL_BRANCH_NAME || ''),
    tagline: '',
    supportEmail: asText(process.env.BUSINESS_SUPPORT_EMAIL || ''),
    contact: asText(process.env.BUSINESS_CONTACT || ''),
    address: asText(process.env.BUSINESS_ADDRESS || ''),
    logoUrl: '',
    paymentInstructions: {}
};
const LEGACY_DEFAULT_VALUES = new Set([
    'dante point to point pisonet',
    'dante fiber',
    'support@dantefiber.net',
    'support@dantefiber.com',
    '0976-160-1988',
    '(02) 8555-1234',
    '8555-1234',
    'zone 6'
]);

const resolveProfileField = (value, fallback = '') => {
    const cleaned = asText(value);
    const fallbackText = asText(fallback);
    if (!cleaned) return fallbackText;
    if (cleaned.toLowerCase() !== fallbackText.toLowerCase() && LEGACY_DEFAULT_VALUES.has(cleaned.toLowerCase())) {
        return fallbackText;
    }
    return cleaned;
};

const cloneProfile = (profile) => JSON.parse(JSON.stringify(profile || {}));

const getProfileCacheKey = (branchId = null) => String(branchId || 'default');

const getCachedProfile = (branchId = null) => {
    const cached = profileCache.get(getProfileCacheKey(branchId));
    if (!cached || cached.expiresAt <= Date.now()) return null;
    return cloneProfile(cached.profile);
};

const setCachedProfile = (branchId = null, profile) => {
    profileCache.set(getProfileCacheKey(branchId), {
        expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
        profile: cloneProfile(profile)
    });
};

const clearProfileCache = (branchId = null) => {
    profileCache.delete(getProfileCacheKey(branchId));
    if (branchId !== null && branchId !== undefined) {
        profileCache.delete(getProfileCacheKey(null));
    }
};

const getFileExtensionForMimeType = (mimeType) => {
    return MIME_TYPE_TO_EXTENSION[String(mimeType || '').toLowerCase()] || 'bin';
};

const sanitizeFileName = (value) => {
    return asText(value)
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
};

const getPublicGcashQrFileName = (profile = {}, mimeType = '') => {
    const extension = getFileExtensionForMimeType(mimeType);
    const provided = sanitizeFileName(profile.gcashQrCodeFileName);
    if (provided) {
        const lowerProvided = provided.toLowerCase();
        const expectedSuffix = `.${extension}`;
        return lowerProvided.endsWith(expectedSuffix) ? provided : `${provided}.${extension}`;
    }
    return `gcash-qr.${extension}`;
};

const parseEmbeddedImageData = (value, fallbackMimeType = '') => {
    const text = asText(value);
    if (!text) {
        return null;
    }
    const match = text.match(/^data:([^;,]+)?;base64,(.+)$/i);
    if (!match) {
        return null;
    }
    const mimeType = asText(match[1]) || asText(fallbackMimeType) || 'application/octet-stream';
    const base64 = String(match[2] || '').replace(/\s+/g, '');
    if (!base64) {
        return null;
    }
    try {
        return {
            mimeType,
            buffer: Buffer.from(base64, 'base64')
        };
    } catch {
        return null;
    }
};

const mergeGcashIntoProfile = (profile, settings) => {
    const baseProfile = profile && typeof profile === 'object' ? profile : { ...DEFAULT_PROFILE };
    const gcash = settings?.gcash && typeof settings.gcash === 'object' ? settings.gcash : {};
    const accountName = asText(gcash.accountName);
    const accountNumber = asText(gcash.accountNumber);
    const qrCodeImageData = asText(gcash.qrCodeImageData);
    const qrCodeMimeType = asText(gcash.qrCodeMimeType);
    const qrCodeFileName = asText(gcash.qrCodeFileName);

    const paymentInstructions = {
        ...(baseProfile.paymentInstructions && typeof baseProfile.paymentInstructions === 'object'
            ? baseProfile.paymentInstructions
            : {})
    };

    if (accountNumber) {
        paymentInstructions.gcash = accountNumber;
        paymentInstructions.gcashNumber = accountNumber;
    }
    if (accountName) {
        paymentInstructions.gcashAccountName = accountName;
    }
    if (accountName && accountNumber) {
        paymentInstructions.gcashAccount = `${accountName} (${accountNumber})`;
    } else if (accountName) {
        paymentInstructions.gcashAccount = accountName;
    } else if (accountNumber) {
        paymentInstructions.gcashAccount = accountNumber;
    }
    if (qrCodeImageData) {
        paymentInstructions.gcashQrCodeImageData = qrCodeImageData;
    }
    if (qrCodeMimeType) {
        paymentInstructions.gcashQrCodeMimeType = qrCodeMimeType;
    }
    if (qrCodeFileName) {
        paymentInstructions.gcashQrCodeFileName = qrCodeFileName;
    }

    return {
        ...baseProfile,
        paymentInstructions,
        gcash: paymentInstructions.gcash || '',
        gcashNumber: paymentInstructions.gcashNumber || '',
        gcashAccount: paymentInstructions.gcashAccount || '',
        gcashAccountName: paymentInstructions.gcashAccountName || '',
        gcashQrCodeImageData: paymentInstructions.gcashQrCodeImageData || '',
        gcashQrCodeMimeType: paymentInstructions.gcashQrCodeMimeType || '',
        gcashQrCodeFileName: paymentInstructions.gcashQrCodeFileName || ''
    };
};

async function enrichProfileWithGcash(profile, branchId = null) {
    try {
        const settings = await loadIntegrationSettings(branchId);
        return mergeGcashIntoProfile(profile, settings);
    } catch {
        return mergeGcashIntoProfile(profile, {});
    }
}

async function readProfile(branchId = null) {
    const cached = getCachedProfile(branchId);
    if (cached) return cached;

    let profile = { ...DEFAULT_PROFILE };
    if (await isRelationalReady()) {
        if (!branchId) {
            const [rows] = await query('SELECT id FROM branches ORDER BY id LIMIT 1');
            branchId = rows && rows.length ? rows[0].id : null;
        }
        if (branchId) {
            const [rows] = await query(
                'SELECT business_name, tagline, support_email, contact, address, logo_base64 FROM business_profiles WHERE branch_id = ? LIMIT 1',
                [branchId]
            );
            if (rows && rows.length) {
                const row = rows[0];
                profile = {
                    ...DEFAULT_PROFILE,
                    businessName: resolveProfileField(row.business_name, DEFAULT_PROFILE.businessName),
                    tagline: resolveProfileField(row.tagline, DEFAULT_PROFILE.tagline),
                    supportEmail: resolveProfileField(row.support_email, DEFAULT_PROFILE.supportEmail),
                    contact: resolveProfileField(row.contact, DEFAULT_PROFILE.contact),
                    address: resolveProfileField(row.address, DEFAULT_PROFILE.address),
                    logoUrl: resolveProfileField(row.logo_base64, DEFAULT_PROFILE.logoUrl)
                };
            }
        }
        const enriched = await enrichProfileWithGcash(profile, branchId);
        setCachedProfile(branchId, enriched);
        return enriched;
    }
    const stored = await readJson(PROFILE_KEY, null);
    const parsed = stored && typeof stored === 'object' ? stored : {};
    profile = {
        ...DEFAULT_PROFILE,
        businessName: resolveProfileField(parsed.businessName, DEFAULT_PROFILE.businessName),
        tagline: resolveProfileField(parsed.tagline, DEFAULT_PROFILE.tagline),
        supportEmail: resolveProfileField(parsed.supportEmail, DEFAULT_PROFILE.supportEmail),
        contact: resolveProfileField(parsed.contact, DEFAULT_PROFILE.contact),
        address: resolveProfileField(parsed.address, DEFAULT_PROFILE.address),
        logoUrl: resolveProfileField(parsed.logoUrl, DEFAULT_PROFILE.logoUrl),
        paymentInstructions: parsed.paymentInstructions || DEFAULT_PROFILE.paymentInstructions
    };
    const enriched = await enrichProfileWithGcash(profile, branchId);
    setCachedProfile(branchId, enriched);
    return enriched;
}

const toPublicGcashPayload = (profile = {}) => {
    return {
        accountName: asText(profile.gcashAccountName),
        accountNumber: asText(profile.gcashNumber || profile.gcash)
    };
};

router.get('/', async (req, res, next) => {
    try {
        res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
        res.json(await readProfile(req.user?.branchId || null));
    } catch (err) {
        next(err);
    }
});

router.get('/gcash', async (req, res, next) => {
    try {
        const profile = await readProfile(req.user?.branchId || null);
        res.set('Cache-Control', 'public, max-age=300');
        res.json({ ok: true, gcash: toPublicGcashPayload(profile) });
    } catch (err) {
        next(err);
    }
});

router.get('/gcash/qr', async (req, res, next) => {
    try {
        const profile = await readProfile(req.user?.branchId || null);
        const qrCode = parseEmbeddedImageData(profile.gcashQrCodeImageData, profile.gcashQrCodeMimeType);
        if (!qrCode) {
            return res.status(404).json({ ok: false, error: 'GCash QR code not configured.' });
        }
        const fileName = getPublicGcashQrFileName(profile, qrCode.mimeType);
        res.set('Cache-Control', 'public, max-age=300');
        res.set('Content-Disposition', `attachment; filename="${fileName}"`);
        res.set('X-Download-Filename', fileName);
        res.type(qrCode.mimeType);
        res.send(qrCode.buffer);
    } catch (err) {
        next(err);
    }
});

router.post('/', requireAuth, async (req, res, next) => {
    try {
        const incoming = req.body || {};
        const branchId = req.user?.branchId || null;

        const nextProfile = {
            ...DEFAULT_PROFILE,
            businessName: incoming.businessName || DEFAULT_PROFILE.businessName,
            tagline: incoming.tagline || DEFAULT_PROFILE.tagline,
            supportEmail: incoming.supportEmail || DEFAULT_PROFILE.supportEmail,
            contact: incoming.contact || DEFAULT_PROFILE.contact,
            address: incoming.address || DEFAULT_PROFILE.address,
            logoUrl: incoming.logoUrl || DEFAULT_PROFILE.logoUrl
        };
        if (await isRelationalReady()) {
            if (!branchId) {
                return res.status(400).json({ ok: false, error: 'Branch not set for user.' });
            }
            await query(
                `INSERT INTO business_profiles (
                    branch_id, business_name, tagline, support_email, contact, address, logo_base64, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    business_name = VALUES(business_name),
                    tagline = VALUES(tagline),
                    support_email = VALUES(support_email),
                    contact = VALUES(contact),
                    address = VALUES(address),
                    logo_base64 = VALUES(logo_base64),
                    updated_at = VALUES(updated_at)`,
                [
                    branchId,
                    nextProfile.businessName,
                    nextProfile.tagline,
                    nextProfile.supportEmail,
                    nextProfile.contact,
                    nextProfile.address,
                    nextProfile.logoUrl,
                    new Date().toISOString().slice(0, 19).replace('T', ' ')
                ]
            );
        } else {
            await writeJson(PROFILE_KEY, nextProfile);
        }
        const enriched = await enrichProfileWithGcash(nextProfile, branchId);
        clearProfileCache(branchId);
        res.json(enriched);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
module.exports.readProfile = readProfile;
