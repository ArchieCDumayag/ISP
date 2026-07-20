const normalizePortNumber = (value) => {
    if (value === '' || value == null) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
    return parsed;
};

const parseUrlLikeAddress = (value) => {
    if (!value.includes('://')) return null;
    try {
        const parsed = new URL(value);
        const address = String(parsed.hostname || '').trim();
        if (!address) return null;
        return {
            address,
            port: normalizePortNumber(parsed.port),
            hadEmbeddedPort: parsed.port !== ''
        };
    } catch {
        return null;
    }
};

const parseBracketedIpv6Address = (value) => {
    const match = String(value || '').trim().match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (!match) return null;
    return {
        address: String(match[1] || '').trim(),
        port: normalizePortNumber(match[2]),
        hadEmbeddedPort: Boolean(match[2])
    };
};

const parseHostPortAddress = (value) => {
    const match = String(value || '').trim().match(/^([^:\/\s]+):(\d+)$/);
    if (!match) return null;
    return {
        address: String(match[1] || '').trim(),
        port: normalizePortNumber(match[2]),
        hadEmbeddedPort: true
    };
};

const parseMikrotikAddress = (value) => {
    const cleaned = String(value || '').trim();
    if (!cleaned) {
        return { address: '', port: undefined, hadEmbeddedPort: false };
    }
    return (
        parseUrlLikeAddress(cleaned) ||
        parseBracketedIpv6Address(cleaned) ||
        parseHostPortAddress(cleaned) ||
        { address: cleaned, port: undefined, hadEmbeddedPort: false }
    );
};

const normalizeMikrotikEndpoint = (rawAddress, rawPort) => {
    const parsed = parseMikrotikAddress(rawAddress);
    const explicitPort = normalizePortNumber(rawPort);
    return {
        address: parsed.address,
        port: parsed.port != null ? parsed.port : explicitPort,
        rawAddress: String(rawAddress || '').trim(),
        hadEmbeddedPort: parsed.hadEmbeddedPort
    };
};

module.exports = {
    normalizeMikrotikEndpoint,
    normalizePortNumber,
    parseMikrotikAddress
};
