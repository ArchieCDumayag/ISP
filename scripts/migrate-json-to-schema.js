require('../core/config/env-loader');

const fs = require('fs');
const path = require('path');
const { query, isMysqlEnabled } = require('../core/data/db');
const { clearRelationalCache } = require('../core/data/db-relational');
const { backfillManualJobNumbers, ensureJobsJobNumberColumn } = require('../Features/modules/technician/backend/job-numbering');

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

async function runSchema() {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const statements = sql
    .split(';')
    .map((stmt) => stmt.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await query(stmt);
  }
}

async function dropLegacyTicketsPriorityColumn() {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'tickets'
       AND column_name = 'priority'
     LIMIT 1`
  );
  if (!rows || !rows.length) return;
  await query('ALTER TABLE tickets DROP COLUMN priority');
  console.log('Removed legacy tickets.priority column.');
}

async function ensureCustomersPrepaidExpirationColumn() {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'customers'
       AND column_name = 'prepaid_expiration_at'
     LIMIT 1`
  );
  if (rows && rows.length) return;
  await query(
    'ALTER TABLE customers ADD COLUMN prepaid_expiration_at DATETIME NULL AFTER due_date'
  );
  console.log('Added customers.prepaid_expiration_at column.');
}

async function ensureCustomersActivationDateColumn() {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'customers'
       AND column_name = 'activation_date'
     LIMIT 1`
  );
  if (rows && rows.length) return;
  await query(
    'ALTER TABLE customers ADD COLUMN activation_date DATE NULL AFTER since'
  );
  console.log('Added customers.activation_date column.');
}

async function ensureCustomersMikrotikIdColumn() {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'customers'
       AND column_name = 'mikrotik_id'
     LIMIT 1`
  );
  if (rows && rows.length) return;
  await query(
    'ALTER TABLE customers ADD COLUMN mikrotik_id VARCHAR(120) NULL AFTER pppoe_mode'
  );
  console.log('Added customers.mikrotik_id column.');
}

async function ensureCustomersPlanIdColumn() {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'customers'
       AND column_name = 'plan_id'
     LIMIT 1`
  );
  if (!rows || !rows.length) {
    await query(
      'ALTER TABLE customers ADD COLUMN plan_id VARCHAR(80) NULL AFTER activation_date'
    );
    console.log('Added customers.plan_id column.');
  }

  const [indexRows] = await query(
    `SELECT 1
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'customers'
       AND index_name = 'idx_customers_branch_plan'
     LIMIT 1`
  );
  if (!indexRows || !indexRows.length) {
    await query('ALTER TABLE customers ADD KEY idx_customers_branch_plan (branch_id, plan_id)');
    console.log('Added customers idx_customers_branch_plan index.');
  }
}

async function ensureCustomersScheduledPlanColumns() {
  const scheduledColumns = [
    {
      name: 'scheduled_plan_id',
      ddl: 'ALTER TABLE customers ADD COLUMN scheduled_plan_id VARCHAR(80) NULL AFTER plan_category'
    },
    {
      name: 'scheduled_plan_name',
      ddl: 'ALTER TABLE customers ADD COLUMN scheduled_plan_name VARCHAR(120) NULL AFTER scheduled_plan_id'
    },
    {
      name: 'scheduled_plan_amount',
      ddl: 'ALTER TABLE customers ADD COLUMN scheduled_plan_amount DECIMAL(12, 2) NULL AFTER scheduled_plan_name'
    },
    {
      name: 'scheduled_plan_billing',
      ddl: 'ALTER TABLE customers ADD COLUMN scheduled_plan_billing VARCHAR(30) NULL AFTER scheduled_plan_amount'
    },
    {
      name: 'scheduled_plan_category',
      ddl: 'ALTER TABLE customers ADD COLUMN scheduled_plan_category VARCHAR(20) NULL AFTER scheduled_plan_billing'
    },
    {
      name: 'scheduled_plan_apply_at',
      ddl: 'ALTER TABLE customers ADD COLUMN scheduled_plan_apply_at DATETIME NULL AFTER scheduled_plan_category'
    },
    {
      name: 'scheduled_pppoe_profile',
      ddl: 'ALTER TABLE customers ADD COLUMN scheduled_pppoe_profile VARCHAR(120) NULL AFTER scheduled_plan_apply_at'
    }
  ];

  for (const column of scheduledColumns) {
    const [rows] = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'customers'
         AND column_name = ?
       LIMIT 1`,
      [column.name]
    );
    if (rows && rows.length) continue;
    await query(column.ddl);
    console.log(`Added customers.${column.name} column.`);
  }

  const [indexRows] = await query(
    `SELECT 1
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'customers'
       AND index_name = 'idx_customers_branch_scheduled_plan'
     LIMIT 1`
  );
  if (!indexRows || !indexRows.length) {
    await query('ALTER TABLE customers ADD KEY idx_customers_branch_scheduled_plan (branch_id, scheduled_plan_apply_at)');
    console.log('Added customers idx_customers_branch_scheduled_plan index.');
  }
}

async function ensurePlansProfileBindingsColumn() {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'plans'
       AND column_name = 'profile_bindings'
     LIMIT 1`
  );
  if (rows && rows.length) return;
  await query(
    'ALTER TABLE plans ADD COLUMN profile_bindings LONGTEXT NULL AFTER profile'
  );
  console.log('Added plans.profile_bindings column.');
}

async function ensureCoverageAreasMikrotikIdColumn() {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'coverage_areas'
       AND column_name = 'mikrotik_id'
     LIMIT 1`
  );
  if (rows && rows.length) return;
  await query(
    'ALTER TABLE coverage_areas ADD COLUMN mikrotik_id VARCHAR(120) NULL AFTER area_code'
  );
  console.log('Added coverage_areas.mikrotik_id column.');
}

async function backfillCustomerPlanSnapshots() {
  const [result] = await query(
    `UPDATE customers c
     JOIN plans p
       ON p.branch_id = c.branch_id
      AND TRIM(COALESCE(p.name, '')) = TRIM(COALESCE(c.plan_name, ''))
     SET
       c.plan_id = CASE
         WHEN c.plan_id IS NULL OR TRIM(c.plan_id) = '' THEN p.plan_id
         ELSE c.plan_id
       END,
       c.plan_amount = COALESCE(c.plan_amount, p.price),
       c.plan_category = CASE
         WHEN c.plan_category IS NULL OR TRIM(c.plan_category) = '' THEN p.category
         ELSE c.plan_category
       END,
       c.plan_billing = CASE
         WHEN c.plan_billing IS NULL OR TRIM(c.plan_billing) = ''
           THEN 'Monthly'
         ELSE c.plan_billing
       END,
       c.plan_name = CASE
         WHEN c.plan_name IS NULL OR TRIM(c.plan_name) = '' THEN p.name
         ELSE c.plan_name
       END
     WHERE
       c.plan_id IS NULL
       OR TRIM(COALESCE(c.plan_id, '')) = ''
       OR c.plan_amount IS NULL
       OR c.plan_category IS NULL
       OR TRIM(COALESCE(c.plan_category, '')) = ''
       OR c.plan_billing IS NULL
       OR TRIM(COALESCE(c.plan_billing, '')) = ''`
  );
  const affectedRows = Number(result?.affectedRows || 0);
  if (affectedRows > 0) {
    console.log(`Backfilled ${affectedRows} customer plan snapshots.`);
  }
}

async function ensureIntegrationSettingsSecretJsonColumn() {
  const [rows] = await query(
    `SELECT data_type
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'integration_settings'
       AND column_name = 'secret_json'
     LIMIT 1`
  );
  if (!rows || !rows.length) return;
  const dataType = String(rows[0].data_type || '').toLowerCase();
  if (['longtext', 'mediumtext', 'json'].includes(dataType)) return;
  await query('ALTER TABLE integration_settings MODIFY COLUMN secret_json LONGTEXT NOT NULL');
  console.log('Upgraded integration_settings.secret_json to LONGTEXT.');
}

async function ensurePaymentEntriesOrNumberColumn() {
  const [columnRows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'payment_entries'
       AND column_name = 'or_number'
     LIMIT 1`
  );
  if (!columnRows || !columnRows.length) {
    await query('ALTER TABLE payment_entries ADD COLUMN or_number VARCHAR(20) NULL AFTER reference');
    console.log('Added payment_entries.or_number column.');
  }

  const [indexRows] = await query(
    `SELECT 1
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'payment_entries'
       AND index_name = 'idx_payments_or_number'
     LIMIT 1`
  );
  if (!indexRows || !indexRows.length) {
    await query('ALTER TABLE payment_entries ADD KEY idx_payments_or_number (or_number)');
    console.log('Added payment_entries idx_payments_or_number index.');
  }
}

async function ensureTicketsTicketNumberColumn() {
  const [columnRows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'tickets'
       AND column_name = 'ticket_number'
     LIMIT 1`
  );
  if (!columnRows || !columnRows.length) {
    await query('ALTER TABLE tickets ADD COLUMN ticket_number VARCHAR(50) NULL AFTER history_job_created_at');
    console.log('Added tickets.ticket_number column.');
  }

  const [indexRows] = await query(
    `SELECT 1
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'tickets'
       AND index_name = 'idx_tickets_number'
     LIMIT 1`
  );
  if (!indexRows || !indexRows.length) {
    await query('ALTER TABLE tickets ADD KEY idx_tickets_number (ticket_number)');
    console.log('Added tickets idx_tickets_number index.');
  }
}

async function ensureJobsJobNumbering() {
  const addedColumn = await ensureJobsJobNumberColumn();
  if (addedColumn) {
    console.log('Added jobs.job_number column.');
  }
  const backfilledCount = await backfillManualJobNumbers();
  if (backfilledCount > 0) {
    console.log(`Backfilled ${backfilledCount} job number records.`);
  }
}

async function updateSchema() {
  if (!isMysqlEnabled()) {
    throw new Error('MySQL is not configured. Set MYSQL_* env or save config first.');
  }

  await runSchema();
  await ensureIntegrationSettingsSecretJsonColumn();
  await ensureCustomersPrepaidExpirationColumn();
  await ensureCustomersActivationDateColumn();
  await ensureCustomersMikrotikIdColumn();
  await ensureCustomersPlanIdColumn();
  await ensureCustomersScheduledPlanColumns();
  await ensurePlansProfileBindingsColumn();
  await ensureCoverageAreasMikrotikIdColumn();
  await ensurePaymentEntriesOrNumberColumn();
  await ensureTicketsTicketNumberColumn();
  await backfillCustomerPlanSnapshots();
  await ensureJobsJobNumbering();
  await dropLegacyTicketsPriorityColumn();
  clearRelationalCache();
  console.log('Schema update complete.');
}

updateSchema()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Schema update failed:', err?.message || err);
    process.exit(1);
  });
