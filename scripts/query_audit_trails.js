const mysql = require('mysql2/promise');
const path = require('path');
const { DATA_DIR } = require('../core/runtime/paths');
const cfg = require(path.join(DATA_DIR, 'mysql-config.json'));
const ref = process.argv[2] || '21780017160232';
const acct = process.argv[3] || '315068642';

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database
    });

    console.log('\n=== Payment Entry (exact) ===');
    const [pe] = await conn.execute(
      `SELECT id, account_number, reference, date, recorded_at, CONVERT_TZ(recorded_at, '+00:00', '+08:00') AS recorded_manila, recorded_by_username FROM payment_entries WHERE reference = ?`,
      [ref]
    );
    console.log(JSON.stringify(pe, null, 2));

    console.log('\n=== Activity Logs (last 50) ===');
    const [al] = await conn.execute(
      `SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 50`
    );
    const matching = al.filter(row => {
      const payload = row.payload ? JSON.stringify(row.payload) : '';
      return payload.includes(ref) || payload.includes(acct);
    });
    console.log('Matching rows:', JSON.stringify(matching, null, 2));

    await conn.end();
  } catch (err) {
    console.error('ERROR', err.message || err);
    process.exit(1);
  }
})();
