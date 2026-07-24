(() => {
    const PUBLIC_PLANS_ENDPOINT = '/api/public/plans';
    const TICKET_CATEGORIES_ENDPOINT = '/api/tickets/categories';
    const TICKET_SUBMIT_ENDPOINT = '/api/tickets/submit';
    const DEFAULT_CATEGORIES = [
        'Blinking LOS',
        'No Power Modem',
        'Reset Modem',
        'Slow Connection',
        'Wire Problem',
        'Wi-Fi Connected, No Internet'
    ];

    const currencyFormatter = new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    const postpaidPlansShowcase = document.getElementById('postpaidPlansShowcase');
    const prepaidPlansShowcase = document.getElementById('prepaidPlansShowcase');
    const reportForm = document.getElementById('publicReportForm');
    const reportStatus = document.getElementById('reportStatus');
    const reportSubmitBtn = document.getElementById('reportSubmitBtn');
    const reportCategorySelect = document.getElementById('reportCategory');
    const heroPlanCount = document.getElementById('heroPlanCount');
    const heroSlider = document.querySelector('.hero-slider');
    const heroSlides = Array.from(document.querySelectorAll('.hero-slide'));
    const heroSliderDots = Array.from(document.querySelectorAll('.hero-slider__dot'));
    const heroSliderPrev = document.getElementById('heroSliderPrev');
    const heroSliderNext = document.getElementById('heroSliderNext');
    const companyHeader = document.getElementById('publicCompanyHeader');
    const HERO_SLIDE_INTERVAL_MS = 5500;

    const companyNameEls = document.querySelectorAll('[data-company-hero-name]');
    const companyTaglineEls = document.querySelectorAll('[data-company-hero-tagline]');
    const companyAddressEls = document.querySelectorAll('[data-company-address]');
    const companyContactEls = document.querySelectorAll('[data-company-contact]');
    const companyEmailEls = document.querySelectorAll('[data-company-email]');

    const setText = (nodes, value, fallback = 'Not yet set') => {
        const safeValue = String(value || '').trim() || fallback;
        nodes.forEach((node) => {
            node.textContent = safeValue;
        });
    };

    const showReportStatus = (message, type) => {
        if (!reportStatus) return;
        const safeMessage = String(message || '').trim();
        reportStatus.textContent = safeMessage;
        reportStatus.className = 'status-message';
        if (!safeMessage) return;
        reportStatus.classList.add('is-visible');
        reportStatus.classList.add(type === 'success' ? 'status-message--success' : 'status-message--error');
    };

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const formatPrice = (price) => {
        const numeric = Number(price);
        if (!Number.isFinite(numeric)) return 'Contact for pricing';
        return currencyFormatter.format(numeric);
    };

    const toPlanGroupArray = (payload, key) => {
        const entries = payload?.plans?.[key];
        return Array.isArray(entries) ? entries : [];
    };

    const renderEmptyPlans = (container, message) => {
        if (!container) return;
        if (heroPlanCount) heroPlanCount.textContent = '0';
        container.innerHTML = `
            <div class="empty-state">
                <p class="empty-state__copy">${escapeHtml(message || 'No postpaid plans available right now.')}</p>
            </div>
        `;
    };

    const parseSpeedMetric = (plan) => {
        const candidates = [
            String(plan?.profile || '').trim(),
            String(plan?.label || plan?.name || '').trim()
        ].filter(Boolean);

        for (const entry of candidates) {
            const match = entry.match(/(\d+(?:\.\d+)?)\s*(mbps|gbps)/i);
            if (match) {
                return {
                    value: match[1],
                    unit: match[2].toLowerCase() === 'gbps' ? 'Gbps' : 'Mbps'
                };
            }
        }

        return {
            value: '',
            unit: ''
        };
    };

    const renderPlanCard = (plan, index, category) => {
        const animateDelay = ['delay-1', 'delay-2', 'delay-3'][index % 3];
        const isPrepaid = category === 'prepaid';
        const planValue = String(plan?.name || plan?.label || '').trim();
        const title = String(plan?.label || plan?.name || (isPrepaid ? 'Prepaid Plan' : 'Postpaid Plan')).trim();
        const applyHref = planValue
            ? `/apply-now.html?plan=${encodeURIComponent(planValue)}`
            : '/apply-now.html';
        const speedMetric = parseSpeedMetric(plan);
        const priceSuffix = '/ month';
        const detailLabel = isPrepaid ? 'Billing Cycle:' : 'Required Upfront Fee:';
        const detailCopy = isPrepaid ? 'Monthly prepaid' : 'One Month Advance Payment';
        const detailCopyClass = isPrepaid ? 'showcase-plan-card__fee-copy showcase-plan-card__fee-copy--plain' : 'showcase-plan-card__fee-copy';
        const speedMarkup = speedMetric.value
            ? `
                <div class="showcase-plan-card__speed">
                    <span class="showcase-plan-card__speed-value">${escapeHtml(speedMetric.value)}</span>
                    <span class="showcase-plan-card__speed-unit">${escapeHtml(speedMetric.unit)}</span>
                </div>
            `
            : `
                <div class="showcase-plan-card__speed showcase-plan-card__speed--fallback">
                    <span class="showcase-plan-card__speed-fallback">${escapeHtml(title)}</span>
                </div>
            `;

        if (heroPlanCount) heroPlanCount.textContent = '';

        return `
            <article class="showcase-plan-card" data-animate="${animateDelay}" data-card-index="${escapeHtml(index)}">
                <div class="showcase-plan-card__head">
                    <h3 class="showcase-plan-card__label">${escapeHtml(title.toUpperCase())}</h3>
                    <span class="showcase-plan-card__rule" aria-hidden="true"></span>
                </div>
                ${speedMarkup}
                <div class="showcase-plan-card__fee">
                    <span class="showcase-plan-card__fee-label">${escapeHtml(detailLabel)}</span>
                    <span class="${detailCopyClass}">${escapeHtml(detailCopy)}</span>
                </div>
                <div class="showcase-plan-card__price-row">
                    <span class="showcase-plan-card__price">${escapeHtml(formatPrice(plan?.price))}</span>
                    <span class="showcase-plan-card__frequency">${escapeHtml(priceSuffix)}</span>
                </div>
                <a class="showcase-plan-card__button" href="${applyHref}">Apply Now</a>
                <a class="showcase-plan-card__foot-link" href="#public-footer-support">Contact support</a>
            </article>
        `;
    };

    const renderPlanCarousel = (plans, category) => {
        const label = category === 'prepaid' ? 'prepaid' : 'postpaid';

        return `
            <div class="plan-carousel" data-plan-carousel data-plan-count="${escapeHtml(plans.length)}">
                <button class="plan-carousel__nav plan-carousel__nav--prev" type="button" aria-label="Previous ${escapeHtml(label)} plans" data-carousel-prev>
                    <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                </button>
                <div class="plan-carousel__viewport" data-carousel-viewport>
                    <div class="showcase-plan-grid plan-carousel__track" data-carousel-track>
                        ${plans.map((plan, index) => renderPlanCard(plan, index, category)).join('')}
                    </div>
                </div>
                <button class="plan-carousel__nav plan-carousel__nav--next" type="button" aria-label="Next ${escapeHtml(label)} plans" data-carousel-next>
                    <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                </button>
            </div>
        `;
    };

    const setupPlanCarousels = () => {
        const carousels = document.querySelectorAll('[data-plan-carousel]');
        carousels.forEach((carousel) => {
            if (carousel.dataset.ready === 'true') return;
            carousel.dataset.ready = 'true';

            const viewport = carousel.querySelector('[data-carousel-viewport]');
            const track = carousel.querySelector('[data-carousel-track]');
            const prevButton = carousel.querySelector('[data-carousel-prev]');
            const nextButton = carousel.querySelector('[data-carousel-next]');
            const planCount = Number(carousel.dataset.planCount || '0');
            const isLooping = planCount > 1;

            if (!viewport || !track || !prevButton || !nextButton) return;

            let isAnimating = false;

            const getGap = () => {
                const styles = window.getComputedStyle(track);
                const gap = parseFloat(styles.columnGap || styles.gap || '0');
                return Number.isFinite(gap) ? gap : 0;
            };

            const getCardWidth = () => {
                const firstCard = track.querySelector('.showcase-plan-card');
                if (!firstCard) return viewport.clientWidth;
                return firstCard.getBoundingClientRect().width + getGap();
            };

            const updateButtons = () => {
                const isStatic = !isLooping;
                prevButton.disabled = isStatic;
                nextButton.disabled = isStatic;
                carousel.classList.toggle('is-static', isStatic);
            };

            const resetTrackPosition = () => {
                track.style.transition = 'none';
                track.style.transform = 'translate3d(0, 0, 0)';
            };

            const animateNext = () => {
                if (!isLooping || isAnimating) return;
                const firstCard = track.firstElementChild;
                if (!firstCard) return;

                isAnimating = true;
                const amount = getCardWidth();
                track.style.transition = 'transform 360ms ease';
                track.style.transform = `translate3d(-${amount}px, 0, 0)`;

                window.setTimeout(() => {
                    track.appendChild(firstCard);
                    resetTrackPosition();
                    void track.offsetWidth;
                    isAnimating = false;
                }, 360);
            };

            const animatePrev = () => {
                if (!isLooping || isAnimating) return;
                const lastCard = track.lastElementChild;
                if (!lastCard) return;

                isAnimating = true;
                const amount = getCardWidth();
                track.insertBefore(lastCard, track.firstElementChild);
                track.style.transition = 'none';
                track.style.transform = `translate3d(-${amount}px, 0, 0)`;
                void track.offsetWidth;

                track.style.transition = 'transform 360ms ease';
                track.style.transform = 'translate3d(0, 0, 0)';

                window.setTimeout(() => {
                    resetTrackPosition();
                    void track.offsetWidth;
                    isAnimating = false;
                }, 360);
            };

            prevButton.addEventListener('click', animatePrev);
            nextButton.addEventListener('click', animateNext);
            window.addEventListener('resize', resetTrackPosition);

            updateButtons();
        });
    };

    const renderPlans = (payload) => {
        if (!postpaidPlansShowcase && !prepaidPlansShowcase) return;
        const postpaid = toPlanGroupArray(payload, 'postpaid');
        const prepaid = toPlanGroupArray(payload, 'prepaid');

        if (!postpaid.length) {
            renderEmptyPlans(postpaidPlansShowcase, 'No postpaid plans are published yet.');
        } else if (postpaidPlansShowcase) {
            postpaidPlansShowcase.innerHTML = renderPlanCarousel(postpaid, 'postpaid');
        }

        if (!prepaid.length) {
            renderEmptyPlans(prepaidPlansShowcase, 'No prepaid plans are published yet.');
        } else if (prepaidPlansShowcase) {
            prepaidPlansShowcase.innerHTML = renderPlanCarousel(prepaid, 'prepaid');
        }

        setupPlanCarousels();
    };

    const loadPlans = async () => {
        if (!postpaidPlansShowcase && !prepaidPlansShowcase) return;
        try {
            const response = await fetch(PUBLIC_PLANS_ENDPOINT, {
                credentials: 'include',
                cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.ok === false) {
                throw new Error(payload?.error || 'Failed to load plans.');
            }
            renderPlans(payload);
        } catch (error) {
            renderEmptyPlans(postpaidPlansShowcase, error.message || 'Failed to load public plans.');
            renderEmptyPlans(prepaidPlansShowcase, error.message || 'Failed to load public plans.');
        }
    };

    const buildCategoryOption = (value) => {
        const label = String(value || '').trim();
        return label ? `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>` : '';
    };

    const loadReportCategories = async () => {
        if (!reportCategorySelect) return;
        let categories = DEFAULT_CATEGORIES;
        try {
            const response = await fetch(TICKET_CATEGORIES_ENDPOINT, {
                credentials: 'include',
                cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (response.ok && payload?.ok !== false && Array.isArray(payload?.categories) && payload.categories.length) {
                categories = payload.categories
                    .map((entry) => String(entry?.label || entry?.value || '').trim())
                    .filter(Boolean);
            }
        } catch {
            categories = DEFAULT_CATEGORIES;
        }

        reportCategorySelect.innerHTML = `
            <option value="">Select a report type</option>
            ${categories.map((entry) => buildCategoryOption(entry)).join('')}
        `;
    };

    const applyProfile = (profile) => {
        setText(companyNameEls, profile?.businessName, 'Your Internet Service Provider');
        setText(companyTaglineEls, profile?.tagline, 'Public subscriber information');
        setText(companyAddressEls, profile?.address, 'Address not yet set');
        setText(companyContactEls, profile?.contact, 'Contact not yet set');
        setText(companyEmailEls, profile?.supportEmail, 'Email not yet set');
    };

    const setSubmitState = (isBusy) => {
        if (!reportSubmitBtn) return;
        reportSubmitBtn.disabled = Boolean(isBusy);
        reportSubmitBtn.textContent = isBusy ? 'Submitting report...' : 'Submit 24/7 Report';
    };

    const syncCompanyHeaderOffset = () => {
        if (!companyHeader || !document.body?.classList.contains('public-body--company')) return;
        const headerHeight = Math.ceil(companyHeader.getBoundingClientRect().height);
        if (headerHeight > 0) {
            document.body.style.setProperty('--company-header-height', `${headerHeight}px`);
        }
    };

    const setupCompanyHeader = () => {
        if (!companyHeader) return;
        syncCompanyHeaderOffset();
        window.addEventListener('resize', syncCompanyHeaderOffset);

        if ('ResizeObserver' in window) {
            const resizeObserver = new ResizeObserver(() => {
                syncCompanyHeaderOffset();
            });
            resizeObserver.observe(companyHeader);
        }
    };

    const setupHeroSlider = () => {
        if (!heroSlider || heroSlides.length <= 1) return;

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let currentIndex = Math.max(0, heroSlides.findIndex((slide) => slide.classList.contains('is-active')));
        if (currentIndex < 0) currentIndex = 0;
        let autoplayId = null;

        const syncSliderState = () => {
            heroSlides.forEach((slide, index) => {
                const isActive = index === currentIndex;
                slide.classList.toggle('is-active', isActive);
                slide.setAttribute('aria-hidden', isActive ? 'false' : 'true');
            });

            heroSliderDots.forEach((dot, index) => {
                const isActive = index === currentIndex;
                dot.classList.toggle('is-active', isActive);
                dot.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });
        };

        const goToSlide = (nextIndex) => {
            if (!heroSlides.length) return;
            currentIndex = (nextIndex + heroSlides.length) % heroSlides.length;
            syncSliderState();
        };

        const stopAutoplay = () => {
            if (autoplayId) {
                window.clearInterval(autoplayId);
                autoplayId = null;
            }
        };

        const startAutoplay = () => {
            if (prefersReducedMotion) return;
            stopAutoplay();
            autoplayId = window.setInterval(() => {
                goToSlide(currentIndex + 1);
            }, HERO_SLIDE_INTERVAL_MS);
        };

        heroSliderPrev?.addEventListener('click', () => {
            goToSlide(currentIndex - 1);
            startAutoplay();
        });

        heroSliderNext?.addEventListener('click', () => {
            goToSlide(currentIndex + 1);
            startAutoplay();
        });

        heroSliderDots.forEach((dot, index) => {
            dot.addEventListener('click', () => {
                goToSlide(index);
                startAutoplay();
            });
        });

        heroSlider.addEventListener('mouseenter', stopAutoplay);
        heroSlider.addEventListener('mouseleave', startAutoplay);
        heroSlider.addEventListener('focusin', stopAutoplay);
        heroSlider.addEventListener('focusout', () => {
            if (!heroSlider.contains(document.activeElement)) {
                startAutoplay();
            }
        });

        syncSliderState();
        startAutoplay();
    };

    const submitReport = async (event) => {
        event.preventDefault();
        if (!reportForm) return;

        const formData = new FormData(reportForm);
        const payload = {
            customerName: String(formData.get('customerName') || '').trim(),
            accountNumber: String(formData.get('accountNumber') || '').trim(),
            contact: String(formData.get('contact') || '').trim(),
            category: String(formData.get('category') || '').trim(),
            description: String(formData.get('description') || '').trim()
        };

        showReportStatus('', 'error');

        if (!payload.category) {
            showReportStatus('Select a report type before submitting.', 'error');
            return;
        }
        if (!payload.customerName && !payload.accountNumber) {
            showReportStatus('Provide at least a customer name or account number.', 'error');
            return;
        }

        setSubmitState(true);
        try {
            const response = await fetch(TICKET_SUBMIT_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result?.ok === false) {
                throw new Error(result?.error || 'Failed to submit your report.');
            }

            const ticketNumber = String(result?.ticket?.ticketNumber || '').trim();
            showReportStatus(
                ticketNumber
                    ? `Report submitted successfully. Reference number: ${ticketNumber}.`
                    : 'Report submitted successfully. Our team will review it shortly.',
                'success'
            );
            reportForm.reset();
        } catch (error) {
            showReportStatus(error.message || 'Failed to submit your report.', 'error');
        } finally {
            setSubmitState(false);
        }
    };

    document.addEventListener('DOMContentLoaded', async () => {
        const profile = await (window.loadPublicBusinessProfile
            ? window.loadPublicBusinessProfile()
            : Promise.resolve(null));
        applyProfile(profile || window.publicBusinessProfile || {});
        setupCompanyHeader();
        setupHeroSlider();
        loadPlans();
        loadReportCategories();
        reportForm?.addEventListener('submit', submitReport);
    });
})();
