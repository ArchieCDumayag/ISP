const fs = require('fs');
const path = require('path');

const { assertRelationalReady } = require('../db-relational');
const { getPool, resetPool } = require('../db');

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'cleanup-backups');
const APPLY_FLAG = process.argv.includes('--apply');

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseMysqlDateTime(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

function formatMysqlDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function shiftUtcStoredDateTimeToManila(rawDateTime) {
  const parsed = parseMysqlDateTime(rawDateTime);
  if (!parsed) return null;
  return formatMysqlDateTime(new Date(parsed.getTime() + MANILA_OFFSET_MS));
}

async function main() {
  await assertRelationalReady();
  const pool = await getPool();
  if (!pool) {
    throw new Error('MySQL connection is not available.');
  }

  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT id, branch_id AS branchId, account_number AS accountNumber, date, recorded_at AS recordedAt,
              description, kind, recorded_by_user_id AS recordedByUserId, payer
         FROM payment_entries
        WHERE kind = 'charge'
          AND description = 'Monthly Recurring Charge'
          AND recorded_by_user_id = 'system'
          AND recorded_at IS NOT NULL
          AND date IS NOT NULL
          AND DATE(recorded_at) <> date
          AND DATE(DATE_ADD(recorded_at, INTERVAL 8 HOUR)) = date
        ORDER BY recorded_at ASC, id ASC`
    );

    const preview = (rows || []).map((row) => ({
      id: row.id,
      accountNumber: row.accountNumber,
      branchId: row.branchId,
      date: row.date,
      recordedAtBefore: row.recordedAt,
      recordedAtAfter: shiftUtcStoredDateTimeToManila(row.recordedAt)
    }));

    if (!preview.length) {
      console.log(JSON.stringify({
        mode: APPLY_FLAG ? 'apply' : 'dry-run',
        affected: 0,
        message: 'No system monthly charge timestamps need Manila normalization.'
      }, null, 2));
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `system-charge-timestamps-before-manila-${timestamp}.json`);

    if (!APPLY_FLAG) {
      console.log(JSON.stringify({
        mode: 'dry-run',
        affected: preview.length,
        sample: preview.slice(0, 10)
      }, null, 2));
      return;
    }

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify(preview, null, 2), 'utf8');

    await connection.beginTransaction();
    for (const row of preview) {
      await connection.query(
        'UPDATE payment_entries SET recorded_at = ? WHERE id = ?',
        [row.recordedAtAfter, row.id]
      );
    }
    await connection.commit();

    console.log(JSON.stringify({
      mode: 'apply',
      affected: preview.length,
      backupPath,
      sample: preview.slice(0, 10)
    }, null, 2));
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // best effort rollback
    }
    throw error;
  } finally {
    connection.release();
    await resetPool().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
