const HIDDEN_ACTIVITY_USER_IDS = new Set(['1']);
const HIDDEN_ACTIVITY_USERNAMES = new Set(['archiecd']);

const normalizeHiddenActivityValue = (value) => String(value || '').trim().toLowerCase();

const isHiddenActivityUser = ({ userId, username } = {}) => (
    HIDDEN_ACTIVITY_USER_IDS.has(normalizeHiddenActivityValue(userId))
    || HIDDEN_ACTIVITY_USERNAMES.has(normalizeHiddenActivityValue(username))
);

const containsHiddenActivityIdentity = (...values) => {
    const terms = Array.from(HIDDEN_ACTIVITY_USERNAMES);
    return values.some((value) => {
        const normalized = normalizeHiddenActivityValue(value);
        return normalized && terms.some((term) => normalized.includes(term));
    });
};

const shouldHideActivityLogEntry = (entry = {}) => (
    isHiddenActivityUser(entry)
    || containsHiddenActivityIdentity(entry.message, entry.meta)
);

module.exports = {
    HIDDEN_ACTIVITY_USER_IDS,
    HIDDEN_ACTIVITY_USERNAMES,
    normalizeHiddenActivityValue,
    isHiddenActivityUser,
    containsHiddenActivityIdentity,
    shouldHideActivityLogEntry
};
