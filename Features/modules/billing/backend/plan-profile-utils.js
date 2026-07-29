const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizePlanProfileBindings = (value) => {
    let source = value;
    if (typeof source === 'string') {
        const trimmed = source.trim();
        if (!trimmed) return {};
        try {
            source = JSON.parse(trimmed);
        } catch (_error) {
            return {};
        }
    }

    if (Array.isArray(source)) {
        return source.reduce((acc, entry) => {
            if (!entry || typeof entry !== 'object') return acc;
            const routerId = sanitizeString(
                entry.routerId || entry.id || entry.router || entry.key || entry.name
            );
            const profile = sanitizeString(entry.profile || entry.value);
            if (routerId && profile) {
                acc[routerId] = profile;
            }
            return acc;
        }, {});
    }

    if (!source || typeof source !== 'object') return {};

    return Object.entries(source).reduce((acc, [routerId, profile]) => {
        const normalizedRouterId = sanitizeString(routerId);
        const normalizedProfile = sanitizeString(profile);
        if (normalizedRouterId && normalizedProfile) {
            acc[normalizedRouterId] = normalizedProfile;
        }
        return acc;
    }, {});
};

const serializePlanProfileBindings = (value) => {
    const normalized = normalizePlanProfileBindings(value);
    return Object.keys(normalized).length ? JSON.stringify(normalized) : null;
};

const listPlanProfiles = (plan = {}) => {
    const profiles = new Set();
    const defaultProfile = sanitizeString(plan?.profile);
    if (defaultProfile) {
        profiles.add(defaultProfile);
    }
    Object.values(normalizePlanProfileBindings(plan?.profileBindings)).forEach((profile) => {
        const normalized = sanitizeString(profile);
        if (normalized) {
            profiles.add(normalized);
        }
    });
    return Array.from(profiles);
};

const resolvePlanProfileForRouter = (plan = {}, routerId = '', fallbackRouterId = '') => {
    const bindings = normalizePlanProfileBindings(plan?.profileBindings);
    const normalizedRouterId = sanitizeString(routerId);
    if (normalizedRouterId) {
        return bindings[normalizedRouterId] || '';
    }

    const normalizedFallbackRouterId = sanitizeString(fallbackRouterId);
    if (normalizedFallbackRouterId) {
        return bindings[normalizedFallbackRouterId] || '';
    }

    return sanitizeString(plan?.profile);
};

module.exports = {
    listPlanProfiles,
    normalizePlanProfileBindings,
    resolvePlanProfileForRouter,
    serializePlanProfileBindings
};
