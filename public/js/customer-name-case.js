(() => {
    'use strict';

    const NAME_FIELD_SELECTOR = [
        'input[name="firstName"]',
        'input[name="middleName"]',
        'input[name="lastName"]',
        'input[data-customer-name]'
    ].join(', ');
    const SUFFIXES = new Map([
        ['jr', 'Jr.'],
        ['sr', 'Sr.']
    ]);
    const ROMAN_NUMERAL_SUFFIX = /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i;
    const INITIALS_TOKEN = /^(?:\p{L}\.){1,6}$/u;
    const INTENTIONAL_MIXED_CASE = /^\p{Lu}[\p{Ll}\p{M}]+(?:\p{Lu}[\p{Ll}\p{M}]+)+$/u;
    const NAME_SEPARATOR = /([-\u2010-\u2015'\u2019])/u;

    const upperFirstLetter = (value) => {
        let replaced = false;
        return String(value || '').replace(/\p{L}/u, (letter) => {
            if (replaced) return letter;
            replaced = true;
            return letter.toLocaleUpperCase('en-US');
        });
    };

    const normalizeSegment = (segment) => {
        const source = String(segment || '');
        if (!/\p{L}/u.test(source)) return source;
        if (INTENTIONAL_MIXED_CASE.test(source)) return source;
        const lower = source.toLocaleLowerCase('en-US');
        const mcMatch = lower.match(/^mc(\p{L})(.*)$/u);
        if (mcMatch) return `Mc${mcMatch[1].toLocaleUpperCase('en-US')}${mcMatch[2]}`;
        return upperFirstLetter(lower);
    };

    const normalizeWord = (word) => {
        const source = String(word || '');
        const suffixKey = source.toLocaleLowerCase('en-US').replace(/\./g, '');
        if (SUFFIXES.has(suffixKey)) return SUFFIXES.get(suffixKey);
        if (ROMAN_NUMERAL_SUFFIX.test(source)) return source.toLocaleUpperCase('en-US');
        if (INITIALS_TOKEN.test(source)) return source.toLocaleUpperCase('en-US');
        if (INTENTIONAL_MIXED_CASE.test(source)) return source;
        return source
            .split(NAME_SEPARATOR)
            .map((part) => (NAME_SEPARATOR.test(part) ? part : normalizeSegment(part)))
            .join('');
    };

    const normalize = (value) => String(value == null ? '' : value)
        .normalize('NFKC')
        .trim()
        .replace(/\s+/gu, ' ')
        .split(' ')
        .map(normalizeWord)
        .join(' ');

    const isNameField = (target) => Boolean(
        target
        && typeof target.matches === 'function'
        && target.matches(NAME_FIELD_SELECTOR)
    );

    const prepareField = (field) => {
        if (!isNameField(field)) return;
        field.setAttribute('autocapitalize', 'words');
    };

    const normalizeField = (field) => {
        if (!isNameField(field) || field.disabled || field.readOnly) return;
        const nextValue = normalize(field.value);
        if (nextValue !== field.value) field.value = nextValue;
    };

    const prepareAllFields = (root = document) => {
        root.querySelectorAll?.(NAME_FIELD_SELECTOR).forEach(prepareField);
    };

    document.addEventListener('focusin', (event) => prepareField(event.target), true);
    document.addEventListener('focusout', (event) => normalizeField(event.target), true);
    document.addEventListener('submit', (event) => {
        event.target?.querySelectorAll?.(NAME_FIELD_SELECTOR).forEach(normalizeField);
    }, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => prepareAllFields(), { once: true });
    } else {
        prepareAllFields();
    }

    window.CustomerNameCase = Object.freeze({
        normalize,
        normalizeField,
        selector: NAME_FIELD_SELECTOR
    });
})();
