const CUSTOMER_NAME_SUFFIXES = new Map([
  ['jr', 'Jr.'],
  ['sr', 'Sr.']
]);

const ROMAN_NUMERAL_SUFFIX = /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i;
const INITIALS_TOKEN = /^(?:\p{L}\.){1,6}$/u;
const INTENTIONAL_MIXED_CASE = /^\p{Lu}[\p{Ll}\p{M}]+(?:\p{Lu}[\p{Ll}\p{M}]+)+$/u;
const NAME_SEPARATOR = /([-\u2010-\u2015'\u2019])/u;

const normalizeCustomerNameWhitespace = (value) => String(value == null ? '' : value)
  .normalize('NFKC')
  .trim()
  .replace(/\s+/gu, ' ');

const upperFirstLetter = (value) => {
  let replaced = false;
  return String(value || '').replace(/\p{L}/u, (letter) => {
    if (replaced) return letter;
    replaced = true;
    return letter.toLocaleUpperCase('en-US');
  });
};

const normalizeNameSegment = (segment) => {
  const source = String(segment || '');
  if (!/\p{L}/u.test(source)) return source;
  if (INTENTIONAL_MIXED_CASE.test(source)) return source;

  const lower = source.toLocaleLowerCase('en-US');
  const mcMatch = lower.match(/^mc(\p{L})(.*)$/u);
  if (mcMatch) {
    return `Mc${mcMatch[1].toLocaleUpperCase('en-US')}${mcMatch[2]}`;
  }
  return upperFirstLetter(lower);
};

const normalizeNameWord = (word) => {
  const source = String(word || '');
  const suffixKey = source.toLocaleLowerCase('en-US').replace(/\./g, '');
  if (CUSTOMER_NAME_SUFFIXES.has(suffixKey)) return CUSTOMER_NAME_SUFFIXES.get(suffixKey);
  if (ROMAN_NUMERAL_SUFFIX.test(source)) return source.toLocaleUpperCase('en-US');
  if (INITIALS_TOKEN.test(source)) return source.toLocaleUpperCase('en-US');
  if (INTENTIONAL_MIXED_CASE.test(source)) return source;

  return source
    .split(NAME_SEPARATOR)
    .map((part) => (NAME_SEPARATOR.test(part) ? part : normalizeNameSegment(part)))
    .join('');
};

const normalizeCustomerName = (value, maxLength = 0) => {
  const normalized = normalizeCustomerNameWhitespace(value)
    .split(' ')
    .map(normalizeNameWord)
    .join(' ');
  return maxLength > 0 ? normalized.slice(0, maxLength) : normalized;
};

const normalizeCustomerNameRecord = (record = {}) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  const normalized = { ...record };
  const firstName = normalizeCustomerName(record.firstName ?? record.first_name, 100);
  const middleName = normalizeCustomerName(record.middleName ?? record.middle_name, 100);
  const lastName = normalizeCustomerName(record.lastName ?? record.last_name, 100);
  const composedName = [firstName, middleName, lastName].filter(Boolean).join(' ');
  const explicitName = normalizeCustomerName(record.name ?? record.fullName ?? record.customerName, 240);

  if ('firstName' in record || 'first_name' in record || firstName) normalized.firstName = firstName;
  if ('middleName' in record || 'middle_name' in record || middleName) normalized.middleName = middleName;
  if ('lastName' in record || 'last_name' in record || lastName) normalized.lastName = lastName;
  if ('name' in record || explicitName || composedName) normalized.name = explicitName || composedName;
  if ('fullName' in record) normalized.fullName = normalizeCustomerName(record.fullName || composedName, 240);
  if ('customerName' in record) normalized.customerName = normalizeCustomerName(record.customerName || composedName, 240);
  return normalized;
};

module.exports = {
  normalizeCustomerName,
  normalizeCustomerNameRecord,
  normalizeCustomerNameWhitespace
};
