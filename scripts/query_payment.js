const mysql = require('mysql2/promise');
const path = require('path');
const cfg = require(path.join(__dirname, '..', 'data', 'mysql-config.json'));
const ref = process.argv[2] || '21780017160232';

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database
    });
    const sql = `SELECT id, branch_id, account_number, reference, date, recorded_at, CONVERT_TZ(recorded_at, '+00:00', '+08:00') AS recorded_manila, recorded_by_username, recorded_by_name FROM payment_entries WHERE reference = ? OR reference LIKE ? LIMIT 10`;
    const [rows] = await conn.execute(sql, [ref, `%${ref}%`]);
    console.log(JSON.stringify(rows, null, 2));
    await conn.end();
  } catch (err) {
    console.error('ERROR', err.message || err);
    process.exit(1);
  }
})();
