#!/usr/bin/env node
'use strict';

process.env.STORAGE_DRIVER = 'json';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_WORKBOOK = 'C:\\Users\\LENOVO\\Downloads\\Cash Flow 2026.xlsx';
const CLIENT_SHEET = 'CLIENTS LIST';
const ACCOUNT_PREFIX = '100';
const BRANCH_ID = 1;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const sourceArgIndex = args.indexOf('--source');
const workbookPath = sourceArgIndex !== -1 && args[sourceArgIndex + 1]
  ? path.resolve(args[sourceArgIndex + 1])
  : DEFAULT_WORKBOOK;

const dataDir = path.join(ROOT, 'data');
const paymentsPath = path.join(dataDir, 'payments.json');
const customersPath = path.join(dataDir, 'customers.json');
const backupDir = path.join(dataDir, 'backups');

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const onlyDigits = (value) => clean(value).replace(/\D+/g, '');
const currencyNumber = (raw, displayValue) => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Number(raw.toFixed(2));
  const text = clean(displayValue ?? raw);
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text) || text.includes('-');
  const normalized = text.replace(/[₱,\s]/g, '').replace(/[()]/g, '').replace(/[^0-9.-]/g, '');
  const value = Number(normalized);
  if (!Number.isFinite(value)) return 0;
  return Number((negative ? -Math.abs(value) : value).toFixed(2));
};

const normalizeNameKey = (value) => clean(value)
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const compactKey = (value) => normalizeNameKey(value).replace(/\s+/g, '');

const readJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
};

const writeJson = async (filePath, value) => {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-import-${process.pid}-${Date.now()}`
  );
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
};

const cell = (sheet, row, col) => sheet[XLSX.utils.encode_cell({ r: row, c: col })];
const cellText = (sheet, row, col) => {
  const item = cell(sheet, row, col);
  return item ? clean(item.w ?? item.v ?? '') : '';
};
const cellRaw = (sheet, row, col) => cell(sheet, row, col)?.v;

const pad2 = (value) => String(value).padStart(2, '0');
const dateOnlyFromParts = (year, month, day) => {
  const fullYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
  if (!fullYear || !month || !day) return '';
  return `${fullYear}-${pad2(month)}-${pad2(day)}`;
};

const parseDateOnly = (raw, displayValue, fallbackYear = 2026) => {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return dateOnlyFromParts(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed) return dateOnlyFromParts(parsed.y, parsed.m, parsed.d);
  }

  const text = clean(displayValue ?? raw);
  if (!text || /^total$/i.test(text)) return '';

  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) return dateOnlyFromParts(isoMatch[1], isoMatch[2], isoMatch[3]);

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) return dateOnlyFromParts(slashMatch[3], slashMatch[1], slashMatch[2]);

  const monthDayMatch = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s+(\d{2,4}))?$/);
  if (monthDayMatch) {
    const month = new Date(`${monthDayMatch[1]} 1, ${fallbackYear}`).getMonth() + 1;
    if (month) return dateOnlyFromParts(monthDayMatch[3] || fallbackYear, month, monthDayMatch[2]);
  }

  const parsedTime = Date.parse(text);
  if (!Number.isNaN(parsedTime)) {
    const parsed = new Date(parsedTime);
    return dateOnlyFromParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }

  return '';
};

const recordedAtForDate = (dateOnly) => dateOnly ? `${dateOnly}T04:00:00.000Z` : new Date().toISOString();

const accountNumberForSource = (sourceNumber, specialIndex) => {
  const digits = onlyDigits(sourceNumber);
  if (digits && Number(digits) >= 0 && Number(digits) <= 999999) {
    return `${ACCOUNT_PREFIX}${digits.padStart(6, '0')}`;
  }
  return `${ACCOUNT_PREFIX}${String(900000 + specialIndex).slice(-6)}`;
};

const addAlias = (aliases, alias, accountNumber, area = '') => {
  const key = normalizeNameKey(alias);
  if (!key || !accountNumber) return;
  const keys = new Set([key, compactKey(alias)]);
  if (area) {
    keys.add(`${key}|${normalizeNameKey(area)}`);
    keys.add(`${compactKey(alias)}|${normalizeNameKey(area)}`);
  }
  for (const aliasKey of keys) {
    if (!aliasKey) continue;
    if (!aliases.has(aliasKey)) aliases.set(aliasKey, new Set());
    aliases.get(aliasKey).add(accountNumber);
  }
};

const buildCustomerLookup = (customers, workbook) => {
  const existingAccounts = new Set(customers.map((customer) => clean(customer?.accountNumber)).filter(Boolean));
  const accountByAlias = new Map();
  const customerByAccount = new Map(customers.map((customer) => [clean(customer?.accountNumber), customer]));

  for (const customer of customers) {
    const accountNumber = clean(customer?.accountNumber);
    if (!accountNumber) continue;
    const firstName = clean(customer?.firstName);
    const lastName = clean(customer?.lastName);
    const area = clean(customer?.area || customer?.barangay);
    addAlias(accountByAlias, customer?.name, accountNumber, area);
    addAlias(accountByAlias, `${firstName} ${lastName}`, accountNumber, area);
    addAlias(accountByAlias, `${lastName}, ${firstName}`, accountNumber, area);
    addAlias(accountByAlias, `${lastName} ${firstName}`, accountNumber, area);
  }

  const clientSheet = workbook.Sheets[CLIENT_SHEET];
  if (clientSheet) {
    const range = XLSX.utils.decode_range(clientSheet['!ref'] || 'A1:A1');
    let specialIndex = 1;
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      const sourceNumber = cellText(clientSheet, row, 0);
      const sourceName = cellText(clientSheet, row, 7);
      if (!sourceName || normalizeNameKey(sourceName) === 'name') continue;
      const accountNumber = accountNumberForSource(sourceNumber, specialIndex);
      if (!onlyDigits(sourceNumber)) specialIndex += 1;
      if (!existingAccounts.has(accountNumber)) continue;
      addAlias(accountByAlias, sourceName, accountNumber, cellText(clientSheet, row, 5));
    }
  }

  const resolveAccount = (rawName, area = '') => {
    const nameKey = normalizeNameKey(rawName);
    const areaKey = normalizeNameKey(area);
    const candidates = [
      areaKey ? `${nameKey}|${areaKey}` : '',
      areaKey ? `${compactKey(rawName)}|${areaKey}` : '',
      nameKey,
      compactKey(rawName)
    ].filter(Boolean);

    for (const candidate of candidates) {
      const matches = accountByAlias.get(candidate);
      if (!matches || matches.size !== 1) continue;
      const [accountNumber] = [...matches];
      return { accountNumber, customer: customerByAccount.get(accountNumber), ambiguous: false };
    }

    const found = candidates
      .map((candidate) => accountByAlias.get(candidate))
      .find((matches) => matches && matches.size > 1);
    if (found) {
      return { accountNumber: '', customer: null, ambiguous: true, matches: [...found] };
    }

    return { accountNumber: '', customer: null, ambiguous: false };
  };

  return { resolveAccount };
};

const paymentNameCandidates = (rawName) => {
  const original = clean(rawName);
  const normalized = normalizeNameKey(original);
  if (!normalized) return [];

  const noise = new Set([
    'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april',
    'may', 'jun', 'june', 'jul', 'july', 'aug', 'august', 'sep', 'sept',
    'september', 'oct', 'october', 'nov', 'november', 'dec', 'december',
    'adv', 'advance', 'install', 'installation', 'new', 'payment', 'pay',
    'paid', 'pd', 'balance', 'bal'
  ]);

  const candidates = [original];
  const tokens = normalized.split(' ').filter(Boolean);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (/^\d+$/.test(last) || noise.has(last)) {
      tokens.pop();
      continue;
    }
    break;
  }
  const trimmed = tokens.join(' ');
  if (trimmed && trimmed !== normalized) candidates.push(trimmed);

  return [...new Set(candidates)];
};

const resolvePaymentAccount = (lookup, rawName, area = '') => {
  const candidates = paymentNameCandidates(rawName);
  const matches = [];
  let sawAmbiguous = false;

  for (const candidate of candidates) {
    const resolved = lookup.resolveAccount(candidate, area);
    if (resolved.ambiguous) {
      sawAmbiguous = true;
      continue;
    }
    if (resolved.accountNumber) matches.push({ ...resolved, matchedName: candidate });
  }

  const accountNumbers = new Set(matches.map((match) => match.accountNumber));
  if (accountNumbers.size === 1) return matches[0];
  if (accountNumbers.size > 1 || sawAmbiguous) {
    return { accountNumber: '', customer: null, ambiguous: true, matches: [...accountNumbers] };
  }
  return { accountNumber: '', customer: null, ambiguous: false };
};

const findCashHeader = (sheet) => {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  for (let row = range.s.r; row <= Math.min(range.e.r, 20); row += 1) {
    if (
      normalizeNameKey(cellText(sheet, row, 3)) === 'date' &&
      normalizeNameKey(cellText(sheet, row, 6)) === 'particulars' &&
      normalizeNameKey(cellText(sheet, row, 7)) === 'amount'
    ) {
      return row;
    }
  }
  return -1;
};

const findGcashHeader = (sheet) => {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  for (let row = range.s.r; row <= Math.min(range.e.r, 20); row += 1) {
    if (
      normalizeNameKey(cellText(sheet, row, 6)) === 'date' &&
      normalizeNameKey(cellText(sheet, row, 8)) === 'reference number' &&
      normalizeNameKey(cellText(sheet, row, 9)) === 'particulars' &&
      normalizeNameKey(cellText(sheet, row, 11)) === '3j payment'
    ) {
      return row;
    }
  }
  return -1;
};

const sheetSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const idHash = (value) => crypto.createHash('sha1').update(value).digest('hex').slice(0, 8);

const makeEntry = ({ accountNumber, customer, sheetName, excelRow, method, date, amount, rawName, area, category, originalReference, collector }) => {
  const methodSlug = method.toLowerCase();
  const sourceKey = `${sheetName}|${excelRow}|${accountNumber}|${amount.toFixed(2)}`;
  const reference = `CF2026-${methodSlug === 'gcash' ? 'GC' : 'CA'}-${sheetSlug(sheetName).slice(-7).toUpperCase()}-${String(excelRow).padStart(4, '0')}`;
  const descriptionParts = [
    `Imported ${method} payment from ${sheetName}`,
    `Excel row ${excelRow}`,
    category ? `Category: ${category}` : '',
    area ? `Area: ${area}` : '',
    collector ? `Collector: ${collector}` : '',
    originalReference ? `Workbook ref: ${originalReference}` : '',
    rawName && rawName !== clean(customer?.name) ? `Workbook name: ${rawName}` : ''
  ].filter(Boolean);

  return {
    id: `cf2026-${methodSlug}-${sheetSlug(sheetName)}-r${excelRow}-${idHash(sourceKey)}`,
    amount,
    date,
    kind: 'payment',
    type: 'payment',
    direction: 'credit',
    reference: reference.slice(0, 32),
    orNumber: '',
    description: descriptionParts.join('; '),
    recordedAt: recordedAtForDate(date),
    recordedBy: {
      id: 'excel-import',
      username: 'excel-import',
      name: 'Excel Import',
      role: 'System'
    },
    payer: clean(customer?.name) || rawName,
    status: 'paid',
    paymentMethod: method,
    fingerprint: `${accountNumber}|${reference.slice(0, 32)}|payment|${amount.toFixed(2)}`
  };
};

const parsePaymentLogs = (workbook, lookup) => {
  const records = [];
  const skipped = [];
  const bySheet = {};

  for (const sheetName of workbook.SheetNames) {
    const method = /^CASH\s+/i.test(sheetName) ? 'Cash' : (/^GCASH\s+/i.test(sheetName) ? 'GCash' : '');
    if (!method) continue;

    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const headerRow = method === 'Cash' ? findCashHeader(sheet) : findGcashHeader(sheet);
    if (headerRow < 0) {
      skipped.push({ sheetName, reason: 'Payment header not found' });
      continue;
    }

    let lastDate = '';
    bySheet[sheetName] = { parsed: 0, matched: 0, skipped: 0, totalAmount: 0 };

    for (let row = headerRow + 2; row <= range.e.r; row += 1) {
      const dateCol = method === 'Cash' ? 3 : 6;
      const rawDateText = cellText(sheet, row, dateCol);
      const parsedDate = parseDateOnly(cellRaw(sheet, row, dateCol), rawDateText);
      if (parsedDate) lastDate = parsedDate;

      const rawName = method === 'Cash' ? cellText(sheet, row, 6) : cellText(sheet, row, 9);
      const amount = method === 'Cash'
        ? currencyNumber(cellRaw(sheet, row, 7), cellText(sheet, row, 7))
        : currencyNumber(cellRaw(sheet, row, 11), cellText(sheet, row, 11));

      if (!rawName || /^total$/i.test(rawName) || !amount || amount <= 0) continue;

      bySheet[sheetName].parsed += 1;
      const area = method === 'Cash' ? cellText(sheet, row, 5) : '';
      const category = method === 'Cash' ? cellText(sheet, row, 4) : '';
      const collector = method === 'GCash' ? cellText(sheet, row, 7) : '';
      const originalReference = method === 'GCash' ? cellText(sheet, row, 8) : '';
      const resolved = resolvePaymentAccount(lookup, rawName, area);

      if (!resolved.accountNumber) {
        bySheet[sheetName].skipped += 1;
        skipped.push({
          sheetName,
          excelRow: row + 1,
          amount,
          reason: resolved.ambiguous ? 'Ambiguous customer name' : 'Customer not found',
          nameKey: normalizeNameKey(rawName),
          area
        });
        continue;
      }

      const entry = makeEntry({
        accountNumber: resolved.accountNumber,
        customer: resolved.customer,
        sheetName,
        excelRow: row + 1,
        method,
        date: lastDate,
        amount,
        rawName,
        area,
        category,
        originalReference,
        collector
      });
      records.push({
        accountNumber: resolved.accountNumber,
        sheetName,
        excelRow: row + 1,
        entry
      });
      bySheet[sheetName].matched += 1;
      bySheet[sheetName].totalAmount = Number((bySheet[sheetName].totalAmount + amount).toFixed(2));
    }
  }

  return { records, skipped, bySheet };
};

const backupPayments = async () => {
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `payments-before-cash-flow-import-${stamp}.json`);
  await fs.copyFile(paymentsPath, backupPath);
  return backupPath;
};

const prepareImport = async () => {
  const [customers, existingPayments] = await Promise.all([
    readJson(customersPath, []),
    readJson(paymentsPath, {})
  ]);
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const lookup = buildCustomerLookup(Array.isArray(customers) ? customers : [], workbook);
  const parsed = parsePaymentLogs(workbook, lookup);

  const existingIds = new Set();
  const existingFingerprints = new Set();
  for (const accountData of Object.values(existingPayments && typeof existingPayments === 'object' ? existingPayments : {})) {
    for (const entry of Array.isArray(accountData?.history) ? accountData.history : []) {
      if (entry?.id) existingIds.add(clean(entry.id));
      if (entry?.fingerprint) existingFingerprints.add(clean(entry.fingerprint));
    }
  }

  const seenFingerprints = new Set(existingFingerprints);
  const ready = [];
  const skipped = [...parsed.skipped];
  for (const record of parsed.records) {
    if (existingIds.has(record.entry.id) || seenFingerprints.has(record.entry.fingerprint)) {
      skipped.push({
        sheetName: record.sheetName,
        excelRow: record.excelRow,
        amount: record.entry.amount,
        reason: 'Already imported',
        accountNumber: record.accountNumber
      });
      continue;
    }
    seenFingerprints.add(record.entry.fingerprint);
    ready.push(record);
  }

  return {
    customers: Array.isArray(customers) ? customers : [],
    existingPayments: existingPayments && typeof existingPayments === 'object' ? existingPayments : {},
    ready,
    skipped,
    bySheet: parsed.bySheet
  };
};

const summarize = (plan, paymentsAfter = null) => {
  const amount = plan.ready.reduce((sum, record) => sum + Number(record.entry.amount || 0), 0);
  const skippedCounts = plan.skipped.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] || 0) + 1;
    return acc;
  }, {});
  const methodCounts = plan.ready.reduce((acc, record) => {
    const method = record.entry.paymentMethod || 'Unknown';
    acc[method] = (acc[method] || 0) + 1;
    return acc;
  }, {});
  const uniqueAccounts = new Set(plan.ready.map((record) => record.accountNumber));
  const sheetCounts = Object.fromEntries(Object.entries(plan.bySheet).map(([name, stats]) => [
    name,
    {
      matched: stats.matched,
      skipped: stats.skipped,
      amount: Number(stats.totalAmount.toFixed(2))
    }
  ]));

  return {
    readyToImport: plan.ready.length,
    uniqueAccounts: uniqueAccounts.size,
    totalAmount: Number(amount.toFixed(2)),
    methodCounts,
    skipped: plan.skipped.length,
    skippedCounts,
    skippedSamples: plan.skipped.slice(0, 20).map((item) => ({
      sheetName: item.sheetName,
      excelRow: item.excelRow,
      amount: item.amount,
      reason: item.reason,
      nameKey: item.nameKey,
      area: item.area
    })),
    sheetCounts,
    totalPaymentEntriesAfter: paymentsAfter
      ? Object.values(paymentsAfter).reduce((sum, accountData) => sum + (Array.isArray(accountData?.history) ? accountData.history.length : 0), 0)
      : undefined
  };
};

const applyImport = async (plan) => {
  const nextPayments = JSON.parse(JSON.stringify(plan.existingPayments || {}));
  for (const record of plan.ready) {
    if (!nextPayments[record.accountNumber]) nextPayments[record.accountNumber] = { history: [] };
    if (!Array.isArray(nextPayments[record.accountNumber].history)) {
      nextPayments[record.accountNumber].history = [];
    }
    nextPayments[record.accountNumber].history.push(record.entry);
  }

  for (const accountData of Object.values(nextPayments)) {
    if (!Array.isArray(accountData?.history)) continue;
    accountData.history.sort((left, right) => {
      const leftTime = new Date(left.recordedAt || left.date || '').getTime();
      const rightTime = new Date(right.recordedAt || right.date || '').getTime();
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });
  }

  return nextPayments;
};

const verify = (payments, plan) => {
  const wantedIds = new Set(plan.ready.map((record) => record.entry.id));
  const foundIds = new Set();
  const duplicateIds = new Set();
  const duplicateFingerprints = new Set();
  const seenIds = new Set();
  const seenFingerprints = new Set();
  let totalEntries = 0;

  for (const accountData of Object.values(payments)) {
    for (const entry of Array.isArray(accountData?.history) ? accountData.history : []) {
      totalEntries += 1;
      if (wantedIds.has(entry.id)) foundIds.add(entry.id);
      if (entry.id) {
        if (seenIds.has(entry.id)) duplicateIds.add(entry.id);
        seenIds.add(entry.id);
      }
      if (entry.fingerprint) {
        if (seenFingerprints.has(entry.fingerprint)) duplicateFingerprints.add(entry.fingerprint);
        seenFingerprints.add(entry.fingerprint);
      }
    }
  }

  return {
    totalEntries,
    importedFound: foundIds.size,
    missingImported: wantedIds.size - foundIds.size,
    duplicateIds: duplicateIds.size,
    duplicateFingerprints: duplicateFingerprints.size
  };
};

const main = async () => {
  const plan = await prepareImport();
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', workbookPath, ...summarize(plan) }, null, 2));
    return;
  }

  const backupPath = await backupPayments();
  const nextPayments = await applyImport(plan);
  const result = verify(nextPayments, plan);
  if (result.missingImported || result.duplicateIds || result.duplicateFingerprints) {
    throw new Error(`Payment import verification failed before write: ${JSON.stringify(result)}`);
  }

  await writeJson(paymentsPath, nextPayments);
  const saved = await readJson(paymentsPath, {});
  const savedResult = verify(saved, plan);
  if (savedResult.missingImported || savedResult.duplicateIds || savedResult.duplicateFingerprints) {
    await fs.copyFile(backupPath, paymentsPath);
    throw new Error(`Payment import verification failed after write; restored backup. ${JSON.stringify(savedResult)}`);
  }

  console.log(JSON.stringify({
    mode: 'apply',
    workbookPath,
    backupPath,
    ...summarize(plan, saved),
    verification: savedResult
  }, null, 2));
};

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
