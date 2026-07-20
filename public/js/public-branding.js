(() => {
    const DEFAULT_PROFILE = {
        businessName: 'Your Internet Service Provider',
        tagline: 'Public subscriber information',
        supportEmail: '',
        contact: '',
        address: '',
        logoUrl: '/img/business-logo.svg'
    };

    const normalizeText = (value, fallback = '') => {
        const text = String(value ?? '').trim();
        return text || fallback;
    };

    const normalizeProfile = (profile) => ({
        businessName: normalizeText(profile?.businessName, DEFAULT_PROFILE.businessName),
        tagline: normalizeText(profile?.tagline, DEFAULT_PROFILE.tagline),
        supportEmail: normalizeText(profile?.supportEmail),
        contact: normalizeText(profile?.contact),
        address: normalizeText(profile?.address),
        logoUrl: normalizeText(profile?.logoUrl, DEFAULT_PROFILE.logoUrl)
    });

    const applyText = (selector, value) => {
        document.querySelectorAll(selector).forEach((node) => {
            node.textContent = value;
        });
    };

    const applyLink = (selector, href, label) => {
        document.querySelectorAll(selector).forEach((node) => {
            const tagName = String(node.tagName || '').toLowerCase();
            const safeLabel = String(label || '').trim();
            const safeHref = String(href || '').trim();
            const explicitLabel = String(node.dataset.linkLabel || '').trim();
            const allowEmpty = node.hasAttribute('data-allow-empty');
            const resolvedLabel = explicitLabel || safeLabel || (allowEmpty ? '' : node.dataset.fallbackLabel || 'Not available');
            if (tagName === 'a') {
                node.textContent = resolvedLabel;
                if (safeHref) {
                    node.setAttribute('href', safeHref);
                    node.removeAttribute('aria-disabled');
                    node.classList.remove('is-disabled');
                } else {
                    node.removeAttribute('href');
                    node.setAttribute('aria-disabled', 'true');
                    node.classList.add('is-disabled');
                }
                node.classList.toggle('is-empty', allowEmpty && !safeHref && !resolvedLabel);
                return;
            }
            node.textContent = resolvedLabel;
            node.classList.toggle('is-empty', allowEmpty && !safeHref && !resolvedLabel);
        });
    };

    const applyImages = (selector, src, alt) => {
        document.querySelectorAll(selector).forEach((node) => {
            node.setAttribute('src', src || DEFAULT_PROFILE.logoUrl);
            node.setAttribute('alt', alt || '');
        });
    };

    const applyTitle = (profile) => {
        const template = document.body?.dataset?.titleTemplate;
        if (!template) return;
        document.title = template.replace(/\{businessName\}/g, profile.businessName);
    };

    const applyCopyright = (profile) => {
        const currentYear = new Date().getFullYear();
        const copyrightText = `\u00A9 ${currentYear} ${profile.businessName}. All Rights Reserved.`;
        applyText('[data-business-copyright]', copyrightText);
    };

    const setupPublicNavDropdowns = () => {
        document.querySelectorAll('.public-nav__dropdown').forEach((dropdown) => {
            dropdown.querySelectorAll('.public-nav__dropdown-link').forEach((link) => {
                link.addEventListener('click', () => {
                    dropdown.removeAttribute('open');
                });
            });
        });
    };

    const applyProfile = (profile) => {
        const safeProfile = normalizeProfile(profile);
        window.publicBusinessProfile = safeProfile;

        applyText('[data-business-name]', safeProfile.businessName);
        applyText('[data-business-tagline]', safeProfile.tagline);
        applyText('[data-business-email]', safeProfile.supportEmail || 'Not yet set');
        applyText('[data-business-contact]', safeProfile.contact || 'Not yet set');
        applyText('[data-business-address]', safeProfile.address || 'Not yet set');
        applyImages('[data-business-logo]', safeProfile.logoUrl, safeProfile.businessName);
        applyLink('[data-business-email-link]', safeProfile.supportEmail ? `mailto:${safeProfile.supportEmail}` : '', safeProfile.supportEmail);
        applyLink('[data-business-contact-link]', safeProfile.contact ? `tel:${safeProfile.contact.replace(/[^0-9+]/g, '')}` : '', safeProfile.contact || 'Call not available');
        if (typeof window.applyBusinessFavicon === 'function') {
            window.applyBusinessFavicon(safeProfile);
        }
        applyTitle(safeProfile);
        applyCopyright(safeProfile);

        window.dispatchEvent(new CustomEvent('public-business-profile-ready', {
            detail: safeProfile
        }));
        return safeProfile;
    };

    let profilePromise = null;
    window.loadPublicBusinessProfile = () => {
        if (profilePromise) return profilePromise;
        profilePromise = fetch('/api/business-profile', {
            credentials: 'include',
            cache: 'no-store'
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
            })
            .then((profile) => applyProfile(profile))
            .catch(() => applyProfile(DEFAULT_PROFILE));
        return profilePromise;
    };

    document.addEventListener('DOMContentLoaded', () => {
        setupPublicNavDropdowns();
        window.loadPublicBusinessProfile();
    });
})();
