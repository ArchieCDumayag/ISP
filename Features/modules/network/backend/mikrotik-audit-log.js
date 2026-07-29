const { appendActivityLog } = require('../../admin/backend/activity-log');

const safeText = (value, max = 120) => String(value == null ? '' : value).trim().slice(0, max);

const describeCommand = ({
    path = '/ppp secret',
    operation = 'update',
    selector = '',
    payload = {}
} = {}) => {
    const payloadPairs = Object.entries(payload || {})
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${safeText(value, 80)}`);
    return [
        safeText(path, 80),
        safeText(operation, 40),
        selector ? `where ${safeText(selector, 120)}` : '',
        payloadPairs.length ? `set ${payloadPairs.join(' ')}` : ''
    ].filter(Boolean).join(' ');
};

const auditMikrotikPppoeCommand = async ({
    branchId = null,
    user = null,
    source = 'system',
    routerId = '',
    routerLabel = '',
    username = '',
    secretId = '',
    operation = 'update',
    selector = '',
    payload = {},
    reason = ''
} = {}) => {
    const command = describeCommand({
        path: '/ppp secret',
        operation,
        selector,
        payload
    });
    const disabledValue = payload && Object.prototype.hasOwnProperty.call(payload, 'disabled')
        ? safeText(payload.disabled, 20)
        : '';
    const actionText = disabledValue
        ? `MikroTik PPPoE command: disabled=${disabledValue}`
        : `MikroTik PPPoE command: ${safeText(operation, 40) || 'update'}`;
    const target = safeText(username || secretId || selector || 'unknown', 120);
    const router = safeText(routerLabel || routerId || 'unknown-router', 120);
    const meta = [
        `source=${safeText(source, 80)}`,
        `router=${router}`,
        `target=${target}`,
        reason ? `reason=${safeText(reason, 120)}` : '',
        `cmd=${safeText(command, 200)}`
    ].filter(Boolean).join(' | ');

    try {
        await appendActivityLog({
            branchId,
            username: source,
            message: `${actionText} for ${target}`,
            meta
        });
    } catch (error) {
        console.warn('Failed to write MikroTik PPPoE audit log:', error?.message || error);
    }
};

module.exports = {
    auditMikrotikPppoeCommand,
    describeCommand
};
