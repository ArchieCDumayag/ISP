const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { decryptJson, encryptJson } = require('../core/data/db-secrets');
const { DATA_DIR } = require('../core/runtime/paths');

const MYSQL_CONFIG_PATH = path.join(DATA_DIR, 'mysql-config.json');

const normalized = (value) => String(value || '').trim().toLowerCase();

const readMysqlConfig = () => {
  if (!fs.existsSync(MYSQL_CONFIG_PATH)) {
    throw new Error(`MySQL config not found at ${MYSQL_CONFIG_PATH}`);
  }
  const parsed = JSON.parse(fs.readFileSync(MYSQL_CONFIG_PATH, 'utf8'));
  const config = {
    host: String(parsed.host || '').trim(),
    port: Number(parsed.port) || 3306,
    user: String(parsed.user || '').trim(),
    password: parsed.password == null ? '' : String(parsed.password),
    database: String(parsed.database || '').trim(),
    dateStrings: true
  };
  if (!config.host || !config.user || !config.database) {
    throw new Error('MySQL config is incomplete.');
  }
  return config;
};

const parseArgs = (argv = []) => {
  const args = {
    apply: false,
    branchId: null
  };
  argv.forEach((arg) => {
    if (arg === '--apply') {
      args.apply = true;
      return;
    }
    if (arg.startsWith('--branch=')) {
      const value = Number(arg.slice('--branch='.length));
      if (Number.isInteger(value) && value > 0) {
        args.branchId = value;
      }
    }
  });
  return args;
};

const buildCustomerDisplayName = (customer = {}) =>
  String(customer?.name || `${customer?.firstName || ''} ${customer?.lastName || ''}`)
    .trim();

const findCandidateForEntry = (entry, context) => {
  const explicitAccount = String(
    entry?.customerAccount || entry?.accountNumber || entry?.customerId || ''
  ).trim();
  if (explicitAccount) {
    const customer = context.customerByAccount.get(explicitAccount) || null;
    if (!customer) {
      return { confidence: 'none', reason: 'missing-explicit-account', customer: null };
    }
    return { confidence: 'exact', reason: 'explicit-account', customer };
  }

  const pairedCustomer = String(entry?.pairedCustomer || '').trim();
  const password = String(entry?.password || '').trim();
  const accountSuffixMatch = password.match(/(\d{6,12})$/);
  if (!pairedCustomer || !accountSuffixMatch) {
    return { confidence: 'none', reason: 'insufficient-metadata', customer: null };
  }

  const accountNumber = accountSuffixMatch[1];
  const customer = context.customerByAccount.get(accountNumber) || null;
  if (!customer) {
    return { confidence: 'none', reason: 'password-account-missing', customer: null };
  }

  const customerName = buildCustomerDisplayName(customer);
  if (normalized(customerName) !== normalized(pairedCustomer)) {
    return { confidence: 'none', reason: 'paired-customer-mismatch', customer: null };
  }

  return { confidence: 'exact', reason: 'paired-customer-and-password-account', customer };
};

const loadBranchCustomers = async (connection, branchId) => {
  const [rows] = await connection.query(
    `SELECT
        branch_id AS branchId,
        account_number AS accountNumber,
        name,
        first_name AS firstName,
        last_name AS lastName,
        pppoe_username AS pppoeUsername,
        pppoe_password AS pppoePassword,
        pppoe_profile AS pppoeProfile
     FROM customers
     WHERE branch_id = ?`,
    [branchId]
  );
  return Array.isArray(rows) ? rows : [];
};

const loadCoreIntegrationRow = async (connection, branchId) => {
  const [rows] = await connection.query(
    `SELECT secret_json AS secretJson
     FROM integration_settings
     WHERE branch_id = ? AND provider = 'core'
     LIMIT 1`,
    [branchId]
  );
  return rows && rows.length ? rows[0] : null;
};

const persistCustomerRepair = async (connection, branchId, repair) => {
  await connection.query(
    `UPDATE customers
     SET
        pppoe_mode = ?,
        pppoe_username = ?,
        pppoe_password = ?,
        pppoe_profile = ?
     WHERE branch_id = ? AND account_number = ?`,
    [
      'manual',
      repair.username,
      repair.password,
      repair.profile || null,
      branchId,
      repair.accountNumber
    ]
  );
};

const persistIntegrationSettings = async (connection, branchId, settings) => {
  const encrypted = encryptJson(settings);
  await connection.query(
    `UPDATE integration_settings
     SET secret_json = ?
     WHERE branch_id = ? AND provider = 'core'`,
    [JSON.stringify(encrypted), branchId]
  );
};

const repairBranch = async (connection, branchId, { apply = false } = {}) => {
  const customers = await loadBranchCustomers(connection, branchId);
  const integrationRow = await loadCoreIntegrationRow(connection, branchId);
  if (!integrationRow) {
    return {
      branchId,
      customerCount: customers.length,
      storedPppoeCount: 0,
      exactCandidates: [],
      repaired: []
    };
  }

  const settings = decryptJson(integrationRow.secretJson) || {};
  const accounts = Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [];

  const customerByAccount = new Map();
  const knownCustomerPppoeUsernames = new Set();
  customers.forEach((customer) => {
    const accountNumber = String(customer?.accountNumber || '').trim();
    if (accountNumber) {
      customerByAccount.set(accountNumber, customer);
    }
    const pppoeUsername = normalized(customer?.pppoeUsername);
    if (pppoeUsername) {
      knownCustomerPppoeUsernames.add(pppoeUsername);
    }
  });

  const context = { customerByAccount };
  const candidates = [];
  accounts.forEach((entry, index) => {
    const username = String(entry?.username || '').trim();
    if (!username) return;
    if (knownCustomerPppoeUsernames.has(normalized(username))) return;

    const candidate = findCandidateForEntry(entry, context);
    if (candidate.confidence !== 'exact' || !candidate.customer) return;

    const accountNumber = String(candidate.customer.accountNumber || '').trim();
    if (!accountNumber) return;

    const existingCustomerUsername = String(candidate.customer.pppoeUsername || '').trim();
    if (existingCustomerUsername && normalized(existingCustomerUsername) !== normalized(username)) {
      return;
    }

    candidates.push({
      index,
      branchId,
      accountNumber,
      customerName: buildCustomerDisplayName(candidate.customer),
      username,
      password: String(entry?.password || '').trim(),
      profile: String(entry?.profile || '').trim(),
      routerId: String(entry?.routerId || '').trim(),
      reason: candidate.reason
    });
  });

  const groupedByAccount = new Map();
  candidates.forEach((candidate) => {
    const list = groupedByAccount.get(candidate.accountNumber) || [];
    list.push(candidate);
    groupedByAccount.set(candidate.accountNumber, list);
  });

  const exactCandidates = [];
  groupedByAccount.forEach((entries) => {
    const uniqueUsernames = new Set(entries.map((entry) => normalized(entry.username)));
    if (uniqueUsernames.size !== 1) return;
    exactCandidates.push(entries[0]);
  });

  const repaired = [];
  if (apply && exactCandidates.length) {
    await connection.beginTransaction();
    try {
      exactCandidates.forEach((candidate) => {
        const entry = accounts[candidate.index];
        if (!entry || typeof entry !== 'object') return;
        entry.customerAccount = candidate.accountNumber;
        entry.pairedCustomer = candidate.customerName;
      });

      for (const candidate of exactCandidates) {
        await persistCustomerRepair(connection, branchId, candidate);
        repaired.push({
          accountNumber: candidate.accountNumber,
          customerName: candidate.customerName,
          username: candidate.username,
          profile: candidate.profile,
          routerId: candidate.routerId
        });
      }

      await persistIntegrationSettings(connection, branchId, {
        ...settings,
        pppoe: {
          ...(settings?.pppoe || {}),
          accounts
        }
      });

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }

  return {
    branchId,
    customerCount: customers.length,
    storedPppoeCount: accounts.length,
    exactCandidates: exactCandidates.map((candidate) => ({
      accountNumber: candidate.accountNumber,
      customerName: candidate.customerName,
      username: candidate.username,
      profile: candidate.profile,
      routerId: candidate.routerId,
      reason: candidate.reason
    })),
    repaired
  };
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = readMysqlConfig();
  const connection = await mysql.createConnection(config);
  try {
    const branchIds = [];
    if (args.branchId) {
      branchIds.push(args.branchId);
    } else {
      const [rows] = await connection.query('SELECT id FROM branches ORDER BY id ASC');
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const id = Number(row?.id);
        if (Number.isInteger(id) && id > 0) branchIds.push(id);
      });
    }

    const results = [];
    for (const branchId of branchIds) {
      results.push(await repairBranch(connection, branchId, { apply: args.apply }));
    }

    const summary = {
      mode: args.apply ? 'apply' : 'dry-run',
      branchCount: results.length,
      exactCandidateCount: results.reduce((sum, item) => sum + item.exactCandidates.length, 0),
      repairedCount: results.reduce((sum, item) => sum + item.repaired.length, 0),
      results
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
