const express = require('express');
const { readJson, writeJson } = require('./data-store');
const crypto = require('crypto');
const createError = require('http-errors');
const { query } = require('./db');
const { isRelationalReady } = require('./db-relational');
const { loadIntegrationSettings } = require('./integration-settings');
const {
    normalizePlanProfileBindings,
    serializePlanProfileBindings
} = require('./plan-profile-utils');

const router = express.Router();
const STORE_KEYS = {
    plans: 'plans',
    customers: 'customers'
};
const MONTHLY_PRICE_SUFFIX = '/ month';

const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const toFiniteNumber = (value) => {
    if (typeof value === 'string' && value.trim() === '') return undefined;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
};
const normalizeBenefits = (value) => (Array.isArray(value)
    ? value.map((entry) => sanitizeString(entry)).filter((entry) => entry.length > 0)
    : []);
const slugify = (value) => sanitizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
const toIsoString = (value, fallback) => {
    if (value) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
            return date.toISOString();
        }
    }
    return fallback;
};
const ensureUniqueId = (base, usedIds) => {
    const normalizedBase = slugify(base) || `plan-${crypto.randomUUID().slice(0, 8)}`;
    let candidate = normalizedBase;
    let counter = 1;
    while (usedIds.has(candidate)) {
        candidate = `${normalizedBase}-${counter++}`;
    }
    usedIds.add(candidate);
    return candidate;
};
const resolveCategory = (rawCategory, plan) => {
    const normalized = sanitizeString(rawCategory).toLowerCase();
    if (normalized === 'prepaid' || normalized === 'postpaid') return normalized;
    const validity = toFiniteNumber(plan?.validity);
    if (typeof validity === 'number' && validity > 0) return 'prepaid';
    const suffix = sanitizeString(plan?.priceSuffix).toLowerCase();
    if (suffix.includes('/ day') || suffix.includes('/ week') || suffix.includes('/ hour')) return 'prepaid';
    return 'postpaid';
};
const normalizePlanPriceSuffix = () => MONTHLY_PRICE_SUFFIX;
const normalizeLookupValue = (value) => sanitizeString(value).toLowerCase();
const toHttpError = (error, fallbackMessage) => {
    if (error?.status || error?.statusCode) return error;
    return createError(500, fallbackMessage);
};

const mapPlanRow = (row) => ({
    id: row.id || row.planId || row.plan_id || '',
    category: row.category || '',
    label: row.label || '',
    name: row.name || '',
    description: row.description || '',
    profile: row.profile || '',
    profileBindings: normalizePlanProfileBindings(row.profileBindings || row.profile_bindings),
    price: row.price != null ? Number(row.price) : undefined,
    priceSuffix: normalizePlanPriceSuffix(row.priceSuffix || row.price_suffix),
    validity: undefined,
    createdAt: row.createdAt || row.created_at || undefined,
    updatedAt: row.updatedAt || row.updated_at || undefined
});

async function readPlansFile() {
    const data = await readJson(STORE_KEYS.plans, []);
    return Array.isArray(data) ? data : [];
}

async function writePlansFile(plans) {
    await writeJson(STORE_KEYS.plans, plans);
}

async function countPlanUsage(plan, branchId = null) {
    const planName = normalizeLookupValue(plan?.name);
    if (!planName) return 0;

    if (await isRelationalReady()) {
        const [rows] = await query(
            `SELECT COUNT(*) AS total
             FROM customers
             WHERE branch_id = ?
               AND LOWER(TRIM(plan_name)) = ?`,
            [branchId, planName]
        );
        return Number(rows?.[0]?.total || 0);
    }

    const customers = await readJson(STORE_KEYS.customers, []);
    if (!Array.isArray(customers)) return 0;
    return customers.filter((customer) => {
        if (branchId && Number(customer?.branchId) !== Number(branchId)) return false;
        return normalizeLookupValue(customer?.planName) === planName;
    }).length;
}

async function validatePlanProfileBindings(profileBindings, branchId = null) {
    if (!branchId) return;
    const settings = await loadIntegrationSettings(branchId);
    const routers = Array.isArray(settings?.mikrotikRouters) ? settings.mikrotikRouters : [];
    const configuredRouters = routers
        .map((router) => ({
            id: sanitizeString(router?.id),
            label: sanitizeString(router?.label || router?.address || router?.name || router?.id)
        }))
        .filter((router) => router.id);
    if (!configuredRouters.length) return;

    const normalizedBindings = normalizePlanProfileBindings(profileBindings);
    const missing = configuredRouters.filter((router) => !sanitizeString(normalizedBindings[router.id]));
    if (!missing.length) return;

    const labels = missing.map((router) => router.label || router.id).join(', ');
    throw createError(400, `Assign a MikroTik profile for each configured router: ${labels}.`);
}

async function loadPlans(branchId = null) {
    if (await isRelationalReady()) {
        const sql = `
            SELECT
                plan_id AS id,
                category,
                label,
                name,
                description,
                profile,
                profile_bindings AS profileBindings,
                price,
                price_suffix AS priceSuffix,
                validity,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM plans
            ${branchId ? 'WHERE branch_id = ?' : ''}`;
        const [rows] = await query(sql, branchId ? [branchId] : []);
        return (rows || []).map(mapPlanRow);
    }

    const rawPlans = await readPlansFile();
    const usedIds = new Set();
    let mutated = false;
    const now = new Date().toISOString();

    const normalized = rawPlans.map((rawPlan) => {
        const safePlan = rawPlan && typeof rawPlan === 'object' ? rawPlan : {};

        const label = sanitizeString(safePlan.label) || sanitizeString(safePlan.name);
        const name = sanitizeString(safePlan.name) || label;
        const description = sanitizeString(safePlan.description);
        const legacySpeed = toFiniteNumber(safePlan.speed);
        const legacySpeedUnit = sanitizeString(safePlan.speedUnit);
        const profile = sanitizeString(safePlan.profile)
            || (typeof legacySpeed === 'number' ? `${legacySpeed}${legacySpeedUnit ? ` ${legacySpeedUnit}` : ' Mbps'}` : '');
        const profileBindings = normalizePlanProfileBindings(safePlan.profileBindings || safePlan.profile_bindings);
        const price = toFiniteNumber(safePlan.price);
        const legacyPriceSuffix = sanitizeString(safePlan.priceSuffix);
        const legacyValidity = toFiniteNumber(safePlan.validity);
        const priceSuffix = normalizePlanPriceSuffix(legacyPriceSuffix);
        const validity = undefined;
        const benefits = normalizeBenefits(safePlan.benefits);
        const category = resolveCategory(safePlan.category, { validity: legacyValidity, priceSuffix: legacyPriceSuffix });

        const baseId = sanitizeString(safePlan.id) || `${category}-${slugify(label || name)}`;
        const id = ensureUniqueId(baseId, usedIds);

        const createdAt = toIsoString(safePlan.createdAt, now);
        const updatedAt = toIsoString(safePlan.updatedAt, createdAt);

        const plan = {
            id,
            category,
            label,
            name,
            description,
            profile,
            profileBindings,
            price,
            priceSuffix,
            validity,
            benefits: benefits.length ? benefits : undefined,
            createdAt,
            updatedAt,
        };

        if (!plan.description) delete plan.description;
        if (!plan.profile) delete plan.profile;
        if (!Object.keys(plan.profileBindings || {}).length) delete plan.profileBindings;
        if (typeof plan.price === 'undefined') delete plan.price;
        if (!plan.priceSuffix) delete plan.priceSuffix;
        if (typeof plan.validity === 'undefined') delete plan.validity;
        if (!plan.benefits) delete plan.benefits;

        const originalSerialized = JSON.stringify(safePlan);
        const normalizedSerialized = JSON.stringify(plan);
        if (originalSerialized !== normalizedSerialized) mutated = true;

        return plan;
    });

    if (mutated) {
        await writePlansFile(normalized);
    }

    return normalized;
}

const categorizePlans = (plans) => plans.reduce((acc, plan) => {
    const category = plan.category === 'postpaid' ? 'postpaid' : 'prepaid';
    acc[category].push(plan);
    return acc;
}, { prepaid: [], postpaid: [] });

router.get('/', async (req, res, next) => {
    try {
        const plans = await loadPlans(req.user?.branchId || null);
        res.json({ plans: categorizePlans(plans) });
    } catch (error) {
        next(toHttpError(error, 'Failed to read plan data.'));
    }
});

router.post('/', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        if (!branchId) {
            return next(createError(400, 'Branch assignment missing for this admin account.'));
        }
        const plans = await loadPlans(branchId);
        const usedIds = new Set(plans.map((plan) => plan.id).filter(Boolean));

        const name = sanitizeString(req.body.name);
        if (!name) return next(createError(400, 'Plan name is required.'));
        const label = sanitizeString(req.body.label) || name;

        const category = resolveCategory(req.body.category, req.body);
        const description = sanitizeString(req.body.description);
        const profileBindings = normalizePlanProfileBindings(req.body.profileBindings);
        await validatePlanProfileBindings(profileBindings, branchId);
        const price = toFiniteNumber(req.body.price);
        const priceSuffix = normalizePlanPriceSuffix(req.body.priceSuffix);
        const validity = undefined;
        const benefits = normalizeBenefits(req.body.benefits);

        const preferredId = sanitizeString(req.body.id) || `${category}-${slugify(name)}`;
        const id = ensureUniqueId(preferredId, usedIds);
        const timestamp = new Date().toISOString();

        const plan = {
            id,
            category,
            label,
            name,
            description,
            profileBindings,
            price,
            priceSuffix,
            validity,
            benefits: benefits.length ? benefits : undefined,
            createdAt: timestamp,
            updatedAt: timestamp,
        };

        if (!plan.description) delete plan.description;
        if (!plan.profile) delete plan.profile;
        if (!Object.keys(plan.profileBindings || {}).length) delete plan.profileBindings;
        if (typeof plan.price === 'undefined') delete plan.price;
        if (!plan.priceSuffix) delete plan.priceSuffix;
        if (typeof plan.validity === 'undefined') delete plan.validity;
        if (!plan.benefits) delete plan.benefits;

        if (await isRelationalReady()) {
            await query(
                `INSERT INTO plans (
                    branch_id, plan_id, name, label, category, description, profile, profile_bindings,
                    price, price_suffix, validity, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    branchId,
                    id,
                    name || null,
                    plan.label || null,
                    category || null,
                    description || null,
                    null,
                    serializePlanProfileBindings(profileBindings),
                    typeof price === 'number' ? price : null,
                    priceSuffix || null,
                    null,
                    timestamp.replace('T', ' ').slice(0, 19),
                    timestamp.replace('T', ' ').slice(0, 19)
                ]
            );
        } else {
            plans.push(plan);
            await writePlansFile(plans);
        }

        const refreshedPlans = await loadPlans(branchId);
        const responsePlan = refreshedPlans.find((entry) => entry.id === id)
            || refreshedPlans.find((entry) => entry.createdAt === timestamp && entry.name === name)
            || { ...plan };

        res.status(201).json({ message: 'Plan created.', plan: responsePlan });
    } catch (error) {
        next(toHttpError(error, 'Failed to create plan.'));
    }
});

router.put('/:id', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        if (!branchId) return next(createError(400, 'Branch assignment missing for this admin account.'));

        const planId = sanitizeString(req.params.id).toLowerCase();
        if (!planId) return next(createError(400, 'Plan id is required.'));

        const plans = await loadPlans(branchId);
        const index = plans.findIndex((plan) => plan.id === planId);
        if (index === -1) return next(createError(404, 'Plan not found.'));

        const current = plans[index];
        const usedIds = new Set(plans.filter((_, i) => i !== index).map((plan) => plan.id).filter(Boolean));

        const name = sanitizeString(req.body.name ?? current.name);
        if (!name) return next(createError(400, 'Plan name is required.'));
        const label = sanitizeString(req.body.label ?? current.label) || name;

        const category = resolveCategory(req.body.category ?? current.category, req.body);
        const description = sanitizeString(req.body.description ?? current.description);
        const profileBindings = normalizePlanProfileBindings(
            Object.prototype.hasOwnProperty.call(req.body || {}, 'profileBindings')
                ? req.body.profileBindings
                : current.profileBindings
        );
        await validatePlanProfileBindings(profileBindings, branchId);
        const price = toFiniteNumber(req.body.price ?? current.price);
        const priceSuffix = normalizePlanPriceSuffix(req.body.priceSuffix ?? current.priceSuffix);
        const validity = undefined;
        const benefitsSource = req.body.benefits ?? current.benefits;
        const benefits = normalizeBenefits(benefitsSource);

        // If name changed, update id as well
        const newBaseId = `${category}-${slugify(name)}`;
        const id = ensureUniqueId(newBaseId, usedIds);
        const timestamp = new Date().toISOString();

        const updatedPlan = {
            id,
            category,
            label,
            name,
            description,
            profileBindings,
            price,
            priceSuffix,
            validity,
            benefits: benefits.length ? benefits : undefined,
            createdAt: current.createdAt,
            updatedAt: timestamp,
        };

        if (!updatedPlan.description) delete updatedPlan.description;
        if (!updatedPlan.profile) delete updatedPlan.profile;
        if (!Object.keys(updatedPlan.profileBindings || {}).length) delete updatedPlan.profileBindings;
        if (typeof updatedPlan.price === 'undefined') delete updatedPlan.price;
        if (!updatedPlan.priceSuffix) delete updatedPlan.priceSuffix;
        if (typeof updatedPlan.validity === 'undefined') delete updatedPlan.validity;
        if (!updatedPlan.benefits) delete updatedPlan.benefits;

        if (await isRelationalReady()) {
            await query(
                `UPDATE plans
                 SET plan_id = ?, name = ?, label = ?, category = ?, description = ?, profile = ?,
                     profile_bindings = ?, price = ?, price_suffix = ?, validity = ?, updated_at = ?
                 WHERE branch_id = ? AND plan_id = ?`,
                [
                    id,
                    name || null,
                    label || null,
                    category || null,
                    description || null,
                    null,
                    serializePlanProfileBindings(profileBindings),
                    typeof price === 'number' ? price : null,
                    priceSuffix || null,
                    null,
                    timestamp.replace('T', ' ').slice(0, 19),
                    branchId,
                    planId
                ]
            );

            if (current.name && current.name !== name) {
                await query(
                    `UPDATE customers SET plan_name = ? WHERE branch_id = ? AND plan_name = ?`,
                    [name, branchId, current.name]
                );
            }
        } else {
            // Update all references in stored customers if id changed
            if (id !== planId) {
                try {
                    const customers = await readJson(STORE_KEYS.customers, []);
                    let changed = false;
                    for (const customer of customers) {
                        if ((customer.planId && customer.planId === planId) || (customer.planName && customer.planName === current.name)) {
                            customer.planId = id;
                            customer.planName = name;
                            changed = true;
                        }
                    }
                    if (changed) {
                        await writeJson(STORE_KEYS.customers, customers);
                    }
                } catch (e) {
                    // If customers data is missing or invalid, skip updating references
                }
            }

            plans[index] = updatedPlan;
            await writePlansFile(plans);
        }

        const refreshedPlans = await loadPlans(branchId);
        const responsePlan = refreshedPlans.find((entry) => entry.id === id) || updatedPlan;

        res.json({ message: 'Plan updated.', plan: responsePlan });
    } catch (error) {
        next(toHttpError(error, 'Failed to update plan.'));
    }
});

router.delete('/:id', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        if (!branchId) return next(createError(400, 'Branch assignment missing for this admin account.'));

        const planId = sanitizeString(req.params.id).toLowerCase();
        if (!planId) return next(createError(400, 'Plan id is required.'));

        if (await isRelationalReady()) {
            const plans = await loadPlans(branchId);
            const index = plans.findIndex((plan) => plan.id === planId);
            if (index === -1) return next(createError(404, 'Plan not found.'));
            const usageCount = await countPlanUsage(plans[index], branchId);
            if (usageCount > 0) {
                return next(createError(409, `Cannot delete plan. ${usageCount} customer${usageCount === 1 ? '' : 's'} still use this plan.`));
            }
            await query('DELETE FROM plans WHERE branch_id = ? AND plan_id = ?', [branchId, planId]);
            res.json({ message: 'Plan removed.', plan: plans[index] });
        } else {
            const plans = await loadPlans(branchId);
            const index = plans.findIndex((plan) => plan.id === planId);
            if (index === -1) return next(createError(404, 'Plan not found.'));
            const usageCount = await countPlanUsage(plans[index], branchId);
            if (usageCount > 0) {
                return next(createError(409, `Cannot delete plan. ${usageCount} customer${usageCount === 1 ? '' : 's'} still use this plan.`));
            }

            const [removedPlan] = plans.splice(index, 1);
            await writePlansFile(plans);
            res.json({ message: 'Plan removed.', plan: removedPlan });
        }
    } catch (error) {
        next(toHttpError(error, 'Failed to delete plan.'));
    }
});

router.loadPlans = loadPlans;
router.categorizePlans = categorizePlans;

module.exports = router;
