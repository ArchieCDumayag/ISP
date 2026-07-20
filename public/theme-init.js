// Immediate theme application - prevents flash of unstyled content
(function() {
    // Force app-wide date/time rendering to Philippines timezone.
    const APP_TIMEZONE = 'Asia/Manila';
    const APP_LOCALE = 'en-PH';
    const buildDateTimeArgs = (locales, options) => {
        const nextLocales = locales == null ? APP_LOCALE : locales;
        const nextOptions = options && typeof options === 'object' ? { ...options } : {};
        if (!nextOptions.timeZone) {
            nextOptions.timeZone = APP_TIMEZONE;
        }
        return [nextLocales, nextOptions];
    };

    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
        const NativeDateTimeFormat = Intl.DateTimeFormat;
        const PatchedDateTimeFormat = function(locales, options) {
            const [nextLocales, nextOptions] = buildDateTimeArgs(locales, options);
            return new NativeDateTimeFormat(nextLocales, nextOptions);
        };
        PatchedDateTimeFormat.prototype = NativeDateTimeFormat.prototype;
        Object.setPrototypeOf(PatchedDateTimeFormat, NativeDateTimeFormat);
        if (typeof NativeDateTimeFormat.supportedLocalesOf === 'function') {
            PatchedDateTimeFormat.supportedLocalesOf = NativeDateTimeFormat.supportedLocalesOf.bind(NativeDateTimeFormat);
        }
        Intl.DateTimeFormat = PatchedDateTimeFormat;
    }

    ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach((methodName) => {
        const nativeMethod = Date.prototype[methodName];
        if (typeof nativeMethod !== 'function') return;
        Object.defineProperty(Date.prototype, methodName, {
            configurable: true,
            writable: true,
            value: function(locales, options) {
                const [nextLocales, nextOptions] = buildDateTimeArgs(locales, options);
                return nativeMethod.call(this, nextLocales, nextOptions);
            }
        });
    });

    window.__APP_TIMEZONE__ = APP_TIMEZONE;
    window.__APP_LOCALE__ = APP_LOCALE;

    const getStoredJson = (keys) => {
        for (const key of keys) {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch {
                // ignore storage issues
            }
        }
        return null;
    };

    const OLD_BRAND_PATTERN = /Dante Point To Point Pisonet|Micro - Network|Dante P2P Fiber|Dante ISP Billing|Dante Fiber|New Billing System/gi;

    const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    window.buildBusinessTitle = (baseTitle, businessName, fallbackTitle = '') => {
        const name = String(businessName || '').trim();
        let title = String(baseTitle || fallbackTitle || '').trim();
        if (!name) return title;
        title = title.replace(OLD_BRAND_PATTERN, name).trim();
        const repeatedNamePattern = new RegExp(`(?:\\s*-\\s*${escapeRegExp(name)})+$`, 'i');
        title = title.replace(repeatedNamePattern, '').trim();
        title = title.split(/\s*-\s*/)[0]?.trim() || title;
        if (!title || title.toLowerCase() === name.toLowerCase()) return name;
        return `${title} - ${name}`;
    };

    const applyStoredBusinessTitle = () => {
        const BUSINESS_PROFILE_STORAGE_KEYS = ['billing-business-profile', 'dante-business-profile'];
        const getStoredBusinessName = () => {
            const parsed = getStoredJson(BUSINESS_PROFILE_STORAGE_KEYS);
            return String(parsed?.businessName || '').trim();
        };

        const businessName = getStoredBusinessName();
        if (!businessName) return;

        const currentTitle = String(document.title || '').trim();
        if (!currentTitle) {
            document.title = businessName;
            return;
        }

        document.title = window.buildBusinessTitle(currentTitle, businessName, currentTitle);
    };

    applyStoredBusinessTitle();

    const computeBusinessInitials = (value) => {
        const words = String(value || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        if (!words.length) return 'BI';
        const initials = words
            .slice(0, 2)
            .map((word) => (word.match(/[A-Za-z0-9]/)?.[0] || '').toUpperCase())
            .join('');
        return (initials.length === 1 ? `${initials}${initials}` : initials).slice(0, 2) || 'BI';
    };

    const buildInitialsFavicon = (businessName) => {
        const initials = computeBusinessInitials(businessName);
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
                <rect width="100" height="100" rx="22" fill="#1C64F2"/>
                <text x="50" y="61" font-size="${initials.length > 1 ? 42 : 56}" text-anchor="middle" fill="white" font-family="Arial,Helvetica,sans-serif" font-weight="700">${initials}</text>
            </svg>
        `.replace(/\s+/g, ' ').trim();
        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    };

    const setFavicon = (href, type = 'image/svg+xml') => {
        if (!href || !document.head) return;
        document.head.querySelectorAll('link[rel~="icon"]').forEach((link) => link.remove());
        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = type;
        link.href = href;
        document.head.appendChild(link);
    };

    const resolveFaviconSource = (profile = {}) => {
        const businessName = String(profile.businessName || 'Billing').trim();
        const logoUrl = String(profile.logoUrl || '').trim();
        if (logoUrl && logoUrl !== '/img/business-logo.svg') {
            return {
                href: logoUrl,
                type: logoUrl.startsWith('data:image/svg') || /\.svg(?:$|\?)/i.test(logoUrl)
                    ? 'image/svg+xml'
                    : 'image/png'
            };
        }
        return {
            href: buildInitialsFavicon(businessName),
            type: 'image/svg+xml'
        };
    };

    window.applyBusinessFavicon = (profile = {}) => {
        const source = resolveFaviconSource(profile);
        setFavicon(source.href, source.type);
    };

    const applyStoredBusinessFavicon = () => {
        let profile = { businessName: 'Billing', logoUrl: '' };
        const parsed = getStoredJson(['billing-business-profile', 'dante-business-profile']);
        if (parsed) {
            profile = { ...profile, ...parsed };
        }
        window.applyBusinessFavicon(profile);
    };

    applyStoredBusinessFavicon();

    const THEME_STORAGE_KEY = 'billing-theme';
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem('dante-theme');
    const theme = storedTheme === 'dark' ? 'dark' : 'light';

    const root = document.documentElement;
    const isDark = theme === 'dark';
    root.classList.toggle('theme-dark', isDark);
    root.dataset.theme = theme;
    root.dataset.bsTheme = theme;
    root.style.colorScheme = isDark ? 'dark' : 'light';

    const applyBodyTheme = () => {
        if (!document.body) return;
        document.body.classList.toggle('theme-dark', isDark);
        document.body.dataset.theme = theme;
        document.body.dataset.bsTheme = theme;
        document.body.style.colorScheme = isDark ? 'dark' : 'light';
    };

    applyBodyTheme();
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', applyBodyTheme, { once: true });
    }
})();
