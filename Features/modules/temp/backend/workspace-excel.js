const XLSX = require('xlsx');
const { EXPORT_KIND, WorkspaceValidationError } = require('./workspace-store');

const EXCEL_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_IMPORT_ROWS = 100000;
const SHEET_NAMES = Object.freeze({
  metadata: 'Metadata',
  customers: 'Customers',
  payments: 'Transactions',
  collector: 'Collector'
});
const COLLECTOR_HEADERS = Object.freeze([
  'Account',
  'Customer',
  'Service address',
  'Plan',
  'Plan type',
  'Billing',
  'Balance',
  'Due'
]);

const CUSTOMER_FIELDS = Object.freeze([
  'accountNumber',
  'firstName',
  'lastName',
  'contactNumber',
  'email',
  'address',
  'planName',
  'planType',
  'monthlyRate',
  'billingScheduleMode',
  'billingScheduleConfigured',
  'billingDay',
  'activationDate',
  'nextBillingDate',
  'billingCycleInitialized',
  'proratePending',
  'openingBalance',
  'status',
  'notes',
  'createdAt',
  'updatedAt'
]);

const PAYMENT_FIELDS = Object.freeze([
  'id',
  'receiptNumber',
  'accountNumber',
  'kind',
  'amount',
  'date',
  'paymentMethod',
  'reference',
  'description',
  'recordedBy',
  'systemGenerated',
  'cycleKey',
  'createdAt',
  'updatedAt'
]);

const CUSTOMER_NUMBER_FIELDS = new Set(['monthlyRate', 'billingDay', 'openingBalance']);
const CUSTOMER_BOOLEAN_FIELDS = new Set([
  'billingScheduleConfigured',
  'billingCycleInitialized',
  'proratePending'
]);
const PAYMENT_NUMBER_FIELDS = new Set(['amount']);
const PAYMENT_BOOLEAN_FIELDS = new Set(['systemGenerated']);

const invalidWorkbook = (message = 'Select a valid Temp workspace Excel export file.') => (
  new WorkspaceValidationError(message)
);

const assertExportPayload = (payload) => {
  if (!payload || payload.kind !== EXPORT_KIND || !payload.data || typeof payload.data !== 'object') {
    throw invalidWorkbook('Select a valid Temp workspace export file.');
  }
  if (!Array.isArray(payload.data.customers) || !Array.isArray(payload.data.payments)) {
    throw invalidWorkbook('The Temp export is missing customer or transaction records.');
  }
};

const recordForSheet = (record, fields) => Object.fromEntries(
  fields.map((field) => [field, record?.[field] ?? ''])
);

const applySheetLayout = (sheet, fields, widths = {}) => {
  sheet['!autofilter'] = { ref: sheet['!ref'] || `A1:${XLSX.utils.encode_col(fields.length - 1)}1` };
  sheet['!cols'] = fields.map((field) => ({ wch: widths[field] || Math.max(12, Math.min(36, field.length + 3)) }));
};

function buildWorkspaceExcelBuffer(payload) {
  assertExportPayload(payload);
  const data = payload.data;
  const metadataRows = [
    { Field: 'kind', Value: payload.kind },
    { Field: 'version', Value: payload.version },
    { Field: 'exportedAt', Value: payload.exportedAt },
    { Field: 'schemaVersion', Value: data.schemaVersion },
    { Field: 'locationName', Value: data.locationName },
    { Field: 'updatedAt', Value: data.updatedAt || '' },
    { Field: 'customerSequence', Value: data.sequences?.customer ?? 0 },
    { Field: 'paymentSequence', Value: data.sequences?.payment ?? 0 },
    { Field: 'customerCount', Value: data.customers.length },
    { Field: 'transactionCount', Value: data.payments.length }
  ];
  const customerRows = data.customers.map((customer) => recordForSheet(customer, CUSTOMER_FIELDS));
  const paymentRows = data.payments.map((payment) => recordForSheet(payment, PAYMENT_FIELDS));

  const workbook = XLSX.utils.book_new();
  const metadataSheet = XLSX.utils.json_to_sheet(metadataRows, { header: ['Field', 'Value'] });
  metadataSheet['!cols'] = [{ wch: 24 }, { wch: 64 }];

  const customerSheet = XLSX.utils.json_to_sheet(customerRows, { header: CUSTOMER_FIELDS });
  applySheetLayout(customerSheet, CUSTOMER_FIELDS, {
    accountNumber: 18,
    firstName: 20,
    lastName: 20,
    contactNumber: 18,
    email: 28,
    address: 24,
    planName: 18,
    notes: 42,
    createdAt: 26,
    updatedAt: 26
  });

  const paymentSheet = XLSX.utils.json_to_sheet(paymentRows, { header: PAYMENT_FIELDS });
  applySheetLayout(paymentSheet, PAYMENT_FIELDS, {
    id: 34,
    receiptNumber: 18,
    accountNumber: 18,
    paymentMethod: 20,
    reference: 24,
    description: 42,
    recordedBy: 22,
    cycleKey: 34,
    createdAt: 26,
    updatedAt: 26
  });

  XLSX.utils.book_append_sheet(workbook, metadataSheet, SHEET_NAMES.metadata);
  XLSX.utils.book_append_sheet(workbook, customerSheet, SHEET_NAMES.customers);
  XLSX.utils.book_append_sheet(workbook, paymentSheet, SHEET_NAMES.payments);
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', compression: true });
}

const moneyValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};

const resolveCollectorReportDate = (payload, requestedDate) => {
  const candidate = String(requestedDate || payload.exportedAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw invalidWorkbook('A valid Collector report date is required.');
  }
  const [year, month, day] = candidate.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) throw invalidWorkbook('A valid Collector report date is required.');
  return candidate;
};

const transactionImpact = (payment) => (
  String(payment?.kind || '').toLowerCase() === 'charge'
    ? moneyValue(payment?.amount)
    : -moneyValue(payment?.amount)
);

const collectorBillingLabel = (customer) => (
  customer?.billingScheduleMode === 'date'
    ? `Date ${customer.nextBillingDate || ''}`.trim()
    : `Day ${Math.min(31, Math.max(1, Number.parseInt(customer?.billingDay, 10) || 1))}`
);

function buildCollectorRows(payload, options = {}) {
  assertExportPayload(payload);
  const reportDate = resolveCollectorReportDate(payload, options.reportDate);
  const paymentsByAccount = new Map();
  const generatedCycleKeys = new Set();
  payload.data.payments.forEach((payment) => {
    if (String(payment?.date || '') > reportDate) return;
    const accountNumber = String(payment?.accountNumber || '');
    paymentsByAccount.set(
      accountNumber,
      moneyValue((paymentsByAccount.get(accountNumber) || 0) + transactionImpact(payment))
    );
    if (payment?.systemGenerated === true && payment?.cycleKey) {
      generatedCycleKeys.add(String(payment.cycleKey));
    }
  });

  const rows = payload.data.customers.map((customer) => {
    const accountNumber = String(customer?.accountNumber || '');
    const monthlyRate = Math.max(0, moneyValue(customer?.monthlyRate));
    const balance = moneyValue(moneyValue(customer?.openingBalance) + (paymentsByAccount.get(accountNumber) || 0));
    const nextBillingDate = String(customer?.nextBillingDate || '');
    const billingDateReached = (
      customer?.status === 'active'
      && /^\d{4}-\d{2}-\d{2}$/.test(nextBillingDate)
      && nextBillingDate <= reportDate
    );
    const cycleAlreadyGenerated = generatedCycleKeys.has(`${accountNumber}:${nextBillingDate}`);
    const amountToGenerate = billingDateReached && !cycleAlreadyGenerated ? monthlyRate : 0;
    const planName = String(customer?.planName || '').trim();
    const planType = String(customer?.planType || 'postpaid').trim().toLowerCase();
    return {
      Account: accountNumber,
      Customer: `${String(customer?.firstName || '').trim()} ${String(customer?.lastName || '').trim()}`.trim(),
      'Service address': String(customer?.address || '').trim(),
      Plan: planName ? `${planName} (${monthlyRate})` : String(monthlyRate),
      'Plan type': planType.charAt(0).toUpperCase() + planType.slice(1),
      Billing: collectorBillingLabel(customer),
      Balance: balance,
      Due: moneyValue(balance + amountToGenerate)
    };
  });
  rows.sort((left, right) => (
    left['Service address'].localeCompare(right['Service address'])
    || left.Customer.localeCompare(right.Customer)
    || left.Account.localeCompare(right.Account)
  ));
  return { reportDate, rows };
}

function buildCollectorExcelBuffer(payload, options = {}) {
  const report = buildCollectorRows(payload, options);
  const sheet = XLSX.utils.json_to_sheet(report.rows, { header: COLLECTOR_HEADERS });
  sheet['!autofilter'] = { ref: sheet['!ref'] || 'A1:H1' };
  sheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  sheet['!cols'] = [
    { wch: 18 },
    { wch: 28 },
    { wch: 24 },
    { wch: 24 },
    { wch: 14 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 }
  ];
  for (let row = 2; row <= report.rows.length + 1; row += 1) {
    ['G', 'H'].forEach((column) => {
      const cell = sheet[`${column}${row}`];
      if (cell) cell.z = '#,##0.00';
    });
  }

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: 'Temp Collector Report',
    Subject: `Current balances and billing-date due as of ${report.reportDate}`
  };
  XLSX.utils.book_append_sheet(workbook, sheet, SHEET_NAMES.collector);
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', compression: true });
}

const metadataFromSheet = (sheet) => {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  const metadata = {};
  rows.forEach((row) => {
    const field = String(row.Field ?? '').trim();
    if (field) metadata[field] = row.Value;
  });
  return metadata;
};

const assertExactColumns = (header, fields, sheetName) => {
  const actual = header.map((value) => String(value ?? '').trim());
  if (actual.length !== fields.length || fields.some((field, index) => actual[index] !== field)) {
    throw invalidWorkbook(`${sheetName} columns do not match the Temp export format.`);
  }
};

const stringValue = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return String(value).trim();
};

const numberValue = (value, field, sheetName) => {
  if (value === '' || value === null || value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw invalidWorkbook(`${sheetName} contains an invalid ${field} value.`);
  return parsed;
};

const booleanValue = (value, field, sheetName) => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || /^true$/i.test(String(value))) return true;
  if (value === 0 || value === '0' || value === '' || /^false$/i.test(String(value))) return false;
  throw invalidWorkbook(`${sheetName} contains an invalid ${field} value.`);
};

const recordsFromSheet = (sheet, fields, sheetName, numberFields, booleanFields) => {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: false });
  if (!matrix.length) throw invalidWorkbook(`${sheetName} is missing its column headings.`);
  assertExactColumns(matrix[0], fields, sheetName);
  const rows = matrix.slice(1);
  if (rows.length > MAX_IMPORT_ROWS) throw invalidWorkbook(`${sheetName} exceeds the ${MAX_IMPORT_ROWS} row limit.`);
  return rows.map((row) => Object.fromEntries(fields.map((field, index) => {
    const value = row[index];
    if (numberFields.has(field)) return [field, numberValue(value, field, sheetName)];
    if (booleanFields.has(field)) return [field, booleanValue(value, field, sheetName)];
    return [field, stringValue(value)];
  })));
};

const metadataNumber = (metadata, field) => {
  const value = Number(metadata[field]);
  if (!Number.isInteger(value) || value < 0) throw invalidWorkbook(`Metadata contains an invalid ${field} value.`);
  return value;
};

function parseWorkspaceExcelBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw invalidWorkbook();
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true });
  } catch (_error) {
    throw invalidWorkbook();
  }

  const metadataSheet = workbook.Sheets[SHEET_NAMES.metadata];
  const customerSheet = workbook.Sheets[SHEET_NAMES.customers];
  const paymentSheet = workbook.Sheets[SHEET_NAMES.payments];
  if (!metadataSheet || !customerSheet || !paymentSheet) {
    throw invalidWorkbook('The Excel file must contain Metadata, Customers, and Transactions sheets.');
  }

  const metadata = metadataFromSheet(metadataSheet);
  if (metadata.kind !== EXPORT_KIND) throw invalidWorkbook();
  const customers = recordsFromSheet(
    customerSheet,
    CUSTOMER_FIELDS,
    SHEET_NAMES.customers,
    CUSTOMER_NUMBER_FIELDS,
    CUSTOMER_BOOLEAN_FIELDS
  );
  const payments = recordsFromSheet(
    paymentSheet,
    PAYMENT_FIELDS,
    SHEET_NAMES.payments,
    PAYMENT_NUMBER_FIELDS,
    PAYMENT_BOOLEAN_FIELDS
  );
  if (metadataNumber(metadata, 'customerCount') !== customers.length) {
    throw invalidWorkbook('Customer row count does not match the Temp export metadata.');
  }
  if (metadataNumber(metadata, 'transactionCount') !== payments.length) {
    throw invalidWorkbook('Transaction row count does not match the Temp export metadata.');
  }

  return {
    kind: EXPORT_KIND,
    version: metadataNumber(metadata, 'version'),
    exportedAt: stringValue(metadata.exportedAt),
    data: {
      schemaVersion: metadataNumber(metadata, 'schemaVersion'),
      locationName: stringValue(metadata.locationName),
      customers,
      payments,
      sequences: {
        customer: metadataNumber(metadata, 'customerSequence'),
        payment: metadataNumber(metadata, 'paymentSequence')
      },
      updatedAt: stringValue(metadata.updatedAt) || null
    }
  };
}

module.exports = {
  EXPORT_KIND,
  EXCEL_MIME_TYPE,
  SHEET_NAMES,
  COLLECTOR_HEADERS,
  CUSTOMER_FIELDS,
  PAYMENT_FIELDS,
  buildWorkspaceExcelBuffer,
  buildCollectorRows,
  buildCollectorExcelBuffer,
  parseWorkspaceExcelBuffer
};
