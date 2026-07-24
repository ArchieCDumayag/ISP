#!/usr/bin/env node
'use strict';

process.env.STORAGE_DRIVER = 'json';

const fs = require('fs/promises');
const path = require('path');
const XLSX = require('xlsx');

const {
  createCustomerRecord,
  readCustomers
} = require('../customers');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_WORKBOOK = 'C:\\Users\\LENOVO\\Downloads\\Cash Flow 2026.xlsx';
const SOURCE_SHEET = 'CLIENTS LIST';
const BRANCH_ID = 1;
const DEFAULT_ROUTER_ID = 'router-mrsws0a8-bj36jx';
const ACCOUNT_PREFIX = '100';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const sourceArgIndex = args.indexOf('--source');
const workbookPath = sourceArgIndex !== -1 && args[sourceArgIndex + 1]
  ? path.resolve(args[sourceArgIndex + 1])
  : DEFAULT_WORKBOOK;

const dataPath = path.join(ROOT, 'data', 'customers.json');
const plansPath = path.join(ROOT, 'data', 'plans.json');
const coveragePath = path.join(ROOT, 'data', 'coverage.json');
const backupDir = path.join(ROOT, 'data', 'backups');

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const key = (value) => clean(value).toLowerCase();
const onlyDigits = (value) => clean(value).replace(/\D+/g, '');

const readJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
};

const cellText = (sheet, row, col) => {
  const address = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = sheet[address];
  if (!cell) return '';
  return clean(cell.w ?? cell.v ?? '');
};

const cellRaw = (sheet, row, col) => {
  const address = XLSX.utils.encode_cell({ r: row, c: col });
  return sheet[address]?.v;
};

const pad2 = (value) => String(value).padStart(2, '0');

const dateOnlyFromParts = (year, month, day) => {
  const fullYear = year < 100 ? 2000 + year : year;
  if (!fullYear || !month || !day) return '';
  return `${fullYear}-${pad2(month)}-${pad2(day)}`;
};

const parseDateOnly = (raw, displayValue) => {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return dateOnlyFromParts(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed) return dateOnlyFromParts(parsed.y, parsed.m, parsed.d);
  }

  const text = clean(displayValue ?? raw);
  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    return dateOnlyFromParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    return dateOnlyFromParts(Number(slashMatch[3]), Number(slashMatch[1]), Number(slashMatch[2]));
  }

  const parsedTime = Date.parse(text);
  if (!Number.isNaN(parsedTime)) {
    const date = new Date(parsedTime);
    return dateOnlyFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  return '';
};

const normalizePhilippineMobile = (value) => {
  const original = clean(value);
  if (!original) return '';
  const compact = original.replace(/[^\d+]/g, '');
  let local = compact;
  if (local.startsWith('+63')) local = `0${local.slice(3)}`;
  if (local.startsWith('63')) local = `0${local.slice(2)}`;
  if (local.startsWith('9') && local.length === 10) local = `0${local}`;
  const digits = local.replace(/\D+/g, '');
  return /^09\d{9}$/.test(digits) ? digits : '';
};

const splitName = (sourceName) => {
  const value = clean(sourceName);
  if (!value) return { firstName: '', lastName: '', fullName: '' };
  if (!value.includes(',')) {
    return { firstName: value, lastName: '', fullName: value };
  }
  const [last, ...rest] = value.split(',');
  const firstName = clean(rest.join(','));
  const lastName = clean(last);
  return {
    firstName,
    lastName,
    fullName: clean(`${firstName} ${lastName}`)
  };
};

const accountNumberForSource = (sourceNumber, specialIndex) => {
  const digits = onlyDigits(sourceNumber);
  if (digits && Number(digits) >= 0 && Number(digits) <= 999999) {
    return `${ACCOUNT_PREFIX}${digits.padStart(6, '0')}`;
  }
  return `${ACCOUNT_PREFIX}${String(900000 + specialIndex).slice(-6)}`;
};

const statusForSource = (status) => {
  const normalized = key(status);
  if (normalized === 'dc' || normalized === 'disconnected' || normalized === 'disabled') return 'disabled';
  return 'active';
};

const planCategoryForSource = (sourceType, fallback = 'postpaid') => {
  const normalized = key(sourceType);
  if (normalized.includes('prepaid')) return 'prepaid';
  if (normalized.includes('postpaid')) return 'postpaid';
  return key(fallback) === 'prepaid' ? 'prepaid' : 'postpaid';
};

const findHeaderRow = (sheet) => {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const labels = Array.from({ length: 14 }, (_, col) => key(cellText(sheet, row, col)));
    if (labels.includes('number') && labels.includes('name') && labels.includes('pppoe')) {
      return row;
    }
  }
  throw new Error(`Could not find the header row in "${SOURCE_SHEET}".`);
};

const buildPlanMap = (plans) => {
  const map = new Map();
  for (const plan of Array.isArray(plans) ? plans : []) {
    const price = Number(plan?.price);
    if (!Number.isFinite(price)) continue;
    map.set(String(Math.round(price)), {
      id: clean(plan.id),
      name: clean(plan.name || plan.label),
      amount: price,
      category: clean(plan.category) || 'postpaid',
      profile: clean(Object.values(plan.profileBindings || {})[0] || plan.profile)
    });
  }
  return map;
};

const loadSourceRows = async () => {
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const sheet = workbook.Sheets[SOURCE_SHEET];
  if (!sheet) {
    throw new Error(`Workbook does not contain a "${SOURCE_SHEET}" sheet.`);
  }

  const plans = await readJson(plansPath, []);
  const coverage = await readJson(coveragePath, []);
  const planByPrice = buildPlanMap(plans);
  const knownAreas = new Set((Array.isArray(coverage) ? coverage : []).map((area) => key(area?.name)).filter(Boolean));
  const routerId = clean((Array.isArray(coverage) ? coverage : []).find((area) => clean(area?.mikrotikId))?.mikrotikId) || DEFAULT_ROUTER_ID;

  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const headerRow = findHeaderRow(sheet);
  const sourceRows = [];
  let specialAccountIndex = 1;

  for (let row = headerRow + 1; row <= range.e.r; row += 1) {
    const sourceNumber = cellText(sheet, row, 0);
    const sourceName = cellText(sheet, row, 7);
    if (!sourceName) continue;

    const planPrice = onlyDigits(cellText(sheet, row, 4));
    const plan = planByPrice.get(planPrice);
    const activationDate = parseDateOnly(cellRaw(sheet, row, 1), cellText(sheet, row, 1));
    const pppoeUsername = cellText(sheet, row, 8);
    const contactValue = cellText(sheet, row, 10);
    const emailValue = cellText(sheet, row, 11);
    const contactMobile = normalizePhilippineMobile(contactValue);
    const emailMobile = normalizePhilippineMobile(emailValue);
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue) ? emailValue : '';
    const sourceType = cellText(sheet, row, 2);
    const sourceStatus = cellText(sheet, row, 3);
    const sourcePlanCategory = planCategoryForSource(sourceType, plan?.category);
    const area = cellText(sheet, row, 5);
    const zone = cellText(sheet, row, 6);
    const facebookUsername = cellText(sheet, row, 9);
    const referredBy = cellText(sheet, row, 12);
    const payment = cellText(sheet, row, 13);
    const { firstName, lastName, fullName } = splitName(sourceName);
    const accountNumber = accountNumberForSource(sourceNumber, specialAccountIndex);
    if (!onlyDigits(sourceNumber)) specialAccountIndex += 1;

    sourceRows.push({
      excelRow: row + 1,
      sourceNumber,
      sourceName,
      firstName,
      lastName,
      fullName,
      accountNumber,
      activationDate,
      sourceType,
      sourcePlanCategory,
      sourceStatus,
      status: statusForSource(sourceStatus),
      planPrice,
      plan,
      area,
      zone,
      areaKnown: knownAreas.has(key(area)),
      pppoeUsername,
      facebookUsername,
      contactValue,
      emailValue,
      mobile: contactMobile || emailMobile,
      secondaryMobile: contactMobile && emailMobile && contactMobile !== emailMobile ? emailMobile : '',
      email,
      referredBy,
      payment,
      routerId
    });
  }

  return sourceRows;
};

const prepareImport = async () => {
  const sourceRows = await loadSourceRows();
  const existingCustomers = await readJson(dataPath, []);
  const existingAccounts = new Set((Array.isArray(existingCustomers) ? existingCustomers : [])
    .map((customer) => clean(customer?.accountNumber))
    .filter(Boolean));
  const existingPppoe = new Set((Array.isArray(existingCustomers) ? existingCustomers : [])
    .map((customer) => key(customer?.pppoeUsername))
    .filter(Boolean));

  const seenExact = new Set();
  const seenPppoe = new Set(existingPppoe);
  const seenAccount = new Set(existingAccounts);
  const records = [];
  const skipped = [];
  const warnings = [];

  for (const row of sourceRows) {
    if (!row.plan) {
      skipped.push({ excelRow: row.excelRow, accountNumber: row.accountNumber, reason: `No matching plan for ${row.planPrice || '(blank)'}` });
      continue;
    }

    const exactKey = row.pppoeUsername
      ? [key(row.sourceName), key(row.pppoeUsername), key(row.area)].join('|')
      : [key(row.sourceName), key(row.area), key(row.mobile)].join('|');
    if (seenExact.has(exactKey)) {
      skipped.push({ excelRow: row.excelRow, accountNumber: row.accountNumber, reason: 'Duplicate source customer row' });
      continue;
    }
    seenExact.add(exactKey);

    if (seenAccount.has(row.accountNumber)) {
      skipped.push({ excelRow: row.excelRow, accountNumber: row.accountNumber, reason: 'Account already exists' });
      continue;
    }
    seenAccount.add(row.accountNumber);

    let pppoeUsername = row.pppoeUsername;
    const pppoeKey = key(pppoeUsername);
    const remarks = [
      'Imported from Cash Flow 2026.xlsx',
      `Excel row: ${row.excelRow}`,
      row.sourceNumber ? `Source number: ${row.sourceNumber}` : '',
      row.sourceType ? `Source type: ${row.sourceType}` : '',
      row.sourceStatus ? `Source status: ${row.sourceStatus}` : '',
      row.facebookUsername ? `Facebook: ${row.facebookUsername}` : '',
      row.referredBy ? `Referred by: ${row.referredBy}` : '',
      row.payment ? `Payment note: ${row.payment}` : '',
      row.secondaryMobile ? `Secondary mobile: ${row.secondaryMobile}` : '',
      row.emailValue && !row.email && !normalizePhilippineMobile(row.emailValue) ? `Email column note: ${row.emailValue}` : '',
      row.contactValue && !normalizePhilippineMobile(row.contactValue) && row.contactValue !== row.pppoeUsername ? `Contact column note: ${row.contactValue}` : ''
    ].filter(Boolean);

    if (pppoeKey && seenPppoe.has(pppoeKey)) {
      warnings.push({ excelRow: row.excelRow, accountNumber: row.accountNumber, reason: 'Repeated PPPoE username cleared', pppoeUsername });
      remarks.push(`Original repeated PPPoE: ${pppoeUsername}`);
      pppoeUsername = '';
    } else if (pppoeKey) {
      seenPppoe.add(pppoeKey);
    }

    if (!row.areaKnown) {
      warnings.push({ excelRow: row.excelRow, accountNumber: row.accountNumber, reason: `Area not in coverage list: ${row.area}` });
    }

    records.push({
      excelRow: row.excelRow,
      sourceNumber: row.sourceNumber,
      accountNumber: row.accountNumber,
      payload: {
        accountNumber: row.accountNumber,
        firstName: row.firstName,
        lastName: row.lastName,
        name: row.fullName,
        loginUsername: row.accountNumber,
        loginPassword: row.accountNumber,
        mobileRaw: row.mobile || undefined,
        email: row.email || undefined,
        area: row.area || undefined,
        barangay: row.area || undefined,
        street: row.zone || undefined,
        activationDate: row.activationDate || undefined,
        planId: row.plan.id,
        planName: row.plan.name,
        planCategory: row.sourcePlanCategory,
        planBilling: 'Monthly',
        status: row.status,
        mikrotikId: row.routerId,
        pppoeMode: pppoeUsername ? 'manual' : '',
        pppoeUsername: pppoeUsername || undefined,
        pppoeProfile: row.plan.profile || undefined,
        remarks: remarks.join('; ')
      }
    });
  }

  return {
    sourceCount: sourceRows.length,
    importCount: records.length,
    skipped,
    warnings,
    records
  };
};

const backupCustomers = async () => {
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `customers-before-cash-flow-import-${stamp}.json`);
  await fs.copyFile(dataPath, backupPath);
  return backupPath;
};

const summarize = (plan) => {
  const warningCounts = plan.warnings.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] || 0) + 1;
    return acc;
  }, {});
  const skippedCounts = plan.skipped.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] || 0) + 1;
    return acc;
  }, {});
  return {
    sourceClientRows: plan.sourceCount,
    readyToImport: plan.importCount,
    skipped: plan.skipped.length,
    skippedCounts,
    warnings: warningCounts,
    sampleAccounts: plan.records.slice(0, 5).map((record) => ({
      excelRow: record.excelRow,
      accountNumber: record.accountNumber,
      plan: record.payload.planName,
      status: record.payload.status,
      area: record.payload.area,
      hasPppoe: Boolean(record.payload.pppoeUsername)
    }))
  };
};

const verifyImport = async (records) => {
  const importedAccounts = new Set(records.map((record) => record.accountNumber));
  const customers = await readCustomers(BRANCH_ID);
  const imported = customers.filter((customer) => importedAccounts.has(clean(customer.accountNumber)));
  const missingAccounts = records
    .filter((record) => !imported.some((customer) => clean(customer.accountNumber) === record.accountNumber))
    .map((record) => record.accountNumber);

  const duplicateAccounts = new Map();
  const duplicatePppoe = new Map();
  for (const customer of customers) {
    const account = clean(customer.accountNumber);
    if (account) duplicateAccounts.set(account, (duplicateAccounts.get(account) || 0) + 1);
    const pppoe = key(customer.pppoeUsername);
    if (pppoe) duplicatePppoe.set(pppoe, (duplicatePppoe.get(pppoe) || 0) + 1);
  }

  return {
    totalCustomers: customers.length,
    importedCustomers: imported.length,
    missingAccounts,
    duplicateAccounts: [...duplicateAccounts].filter(([, count]) => count > 1).length,
    duplicatePppoe: [...duplicatePppoe].filter(([, count]) => count > 1).length
  };
};

const main = async () => {
  const plan = await prepareImport();
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', workbookPath, ...summarize(plan) }, null, 2));
    return;
  }

  const backupPath = await backupCustomers();
  const created = [];
  try {
    for (const record of plan.records) {
      const customer = await createCustomerRecord(record.payload, {
        branchId: BRANCH_ID,
        refreshSource: '',
        allowPastBillingDates: false
      });
      if (clean(customer.accountNumber) !== record.accountNumber) {
        throw new Error(`Account mismatch for Excel row ${record.excelRow}: expected ${record.accountNumber}, got ${customer.accountNumber}`);
      }
      created.push(record.accountNumber);
    }
  } catch (error) {
    await fs.copyFile(backupPath, dataPath);
    throw new Error(`Import failed after ${created.length} customer(s); restored backup. ${error.message}`);
  }

  const verification = await verifyImport(plan.records);
  if (verification.missingAccounts.length || verification.duplicateAccounts || verification.duplicatePppoe) {
    await fs.copyFile(backupPath, dataPath);
    throw new Error(`Import verification failed; restored backup. ${JSON.stringify(verification)}`);
  }

  console.log(JSON.stringify({
    mode: 'apply',
    workbookPath,
    backupPath,
    created: created.length,
    ...summarize(plan),
    verification
  }, null, 2));
};

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
