const fs = require('fs');
const path = require('path');

const { getPool, resetPool } = require('../core/data/db');
const { DATA_DIR } = require('../core/runtime/paths');
const { runMonthlyBillingOnce, enforcePppoeGracePeriod } = require('../Features/modules/billing/backend/billing-scheduler');

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateOnly(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateOnly(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clampDay(year, monthIndex, day) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(day, lastDay);
}

function addMonthsClamped(date, months) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = date.getMonth() + months;
  const day = date.getDate();
  return new Date(year, month, clampDay(year, month, day));
}

function addDays(date, days) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || !Number.isFinite(days)) return null;
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function deriveDueOffset(customer = {}) {
  const direct = Number(customer.due_offset ?? customer.dueOffset);
  if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);

  const billDate = parseDateOnly(customer.bill_date || customer.billDate);
  const dueDate = parseDateOnly(customer.due_date || customer.dueDate);
  if (!billDate || !dueDate) return null;

  const diffDays = Math.round((dueDate.getTime() - billDate.getTime()) / 86400000);
  if (!Number.isFinite(diffDays) || diffDays < 0) return null;
  return diffDays;
}

function groupByAccount(rows) {
  const grouped = new Map();
  (rows || []).forEach((row) => {
    const accountNumber = String(row.account_number || '').trim();
    if (!accountNumber) return;
    if (!grouped.has(accountNumber)) grouped.set(accountNumber, []);
    grouped.get(accountNumber).push(row);
  });
  return grouped;
}

function ensureBackupDir() {
  const dir = path.join(DATA_DIR, 'cleanup-backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function parseArgs(argv) {
  const result = {};
  argv.forEach((arg) => {
    if (typeof arg !== 'string' || !arg.startsWith('--')) return;
    const [key, ...rest] = arg.slice(2).split('=');
    result[key] = rest.join('=');
  });
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = await getPool();
  if (!pool) {
    throw new Error('MySQL is not configured.');
  }

  const [dbNowRows] = await pool.query('SELECT CURRENT_DATE() AS dbDate, NOW() AS dbNow');
  const dbDate = String(dbNowRows?.[0]?.dbDate || '').trim();
  const cutoffDate = String(args.cutoff || dbDate).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) {
    throw new Error(`Invalid cutoff date: ${cutoffDate || '(empty)'}`);
  }

  const [futureRows] = await pool.query(
    `SELECT
        id,
        branch_id,
        account_number,
        amount,
        date,
        kind,
        direction,
        description,
        recorded_at
     FROM payment_entries
     WHERE description = 'Monthly Recurring Charge'
       AND date > ?
     ORDER BY branch_id ASC, account_number ASC, date ASC, recorded_at ASC`,
    [cutoffDate]
  );

  if (!futureRows.length) {
    console.log(JSON.stringify({
      ok: true,
      cutoffDate,
      dbNow: dbNowRows?.[0]?.dbNow || null,
      deletedCount: 0,
      updatedCustomers: 0,
      backupFile: null
    }, null, 2));
    return;
  }

  const affectedByAccount = groupByAccount(futureRows);
  const accountNumbers = [...affectedByAccount.keys()];
  const [customerRows] = await pool.query(
    `SELECT branch_id, account_number, bill_date, due_date, due_offset
     FROM customers
     WHERE account_number IN (?)`,
    [accountNumbers]
  );
  const customerByAccount = new Map(
    (customerRows || []).map((row) => [String(row.account_number), row])
  );

  const customerUpdates = [];
  affectedByAccount.forEach((entries, accountNumber) => {
    const customer = customerByAccount.get(accountNumber);
    if (!customer) return;

    const sortedEntries = entries
      .slice()
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const restoreBillDate = parseDateOnly(sortedEntries[0]?.date);
    if (!restoreBillDate) return;

    const dueOffset = deriveDueOffset(customer);
    const restoreDueDate = dueOffset != null
      ? addDays(restoreBillDate, dueOffset)
      : parseDateOnly(customer.due_date);

    const currentBillDate = parseDateOnly(customer.bill_date);
    if (currentBillDate && currentBillDate.getTime() <= restoreBillDate.getTime()) {
      return;
    }

    customerUpdates.push({
      branchId: customer.branch_id,
      accountNumber,
      billDate: formatDateOnly(restoreBillDate),
      dueDate: restoreDueDate ? formatDateOnly(restoreDueDate) : null,
      deletedEntryIds: sortedEntries.map((entry) => entry.id)
    });
  });

  const backupDir = ensureBackupDir();
  const backupFile = path.join(
    backupDir,
    `future-mrc-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(
    backupFile,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      cutoffDate,
      dbNow: dbNowRows?.[0]?.dbNow || null,
      futureRows,
      customers: customerRows || [],
      customerUpdates
    }, null, 2),
    'utf8'
  );

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const entryIds = futureRows.map((row) => row.id);
    await connection.query(
      'DELETE FROM payment_entries WHERE id IN (?)',
      [entryIds]
    );

    for (const update of customerUpdates) {
      await connection.query(
        `UPDATE customers
         SET bill_date = ?, due_date = ?
         WHERE branch_id = ? AND account_number = ?`,
        [
          update.billDate,
          update.dueDate,
          update.branchId,
          update.accountNumber
        ]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const syncResult = await runMonthlyBillingOnce();
  const graceResult = await enforcePppoeGracePeriod();

  console.log(JSON.stringify({
    ok: true,
    cutoffDate,
    dbNow: dbNowRows?.[0]?.dbNow || null,
    deletedCount: futureRows.length,
    deletedAccounts: accountNumbers.length,
    updatedCustomers: customerUpdates.length,
    backupFile,
    syncResult,
    graceResult
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await resetPool().catch(() => {});
  });
