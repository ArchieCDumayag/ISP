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

async function ensureCustomersOnuSerialColumnAndIndex() {
  const [columnRows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'customers'
       AND column_name = 'onu_serial_number'
     LIMIT 1`
  );
  if (!columnRows || !columnRows.length) {
    await query(
      'ALTER TABLE customers ADD COLUMN onu_serial_number VARCHAR(160) NULL AFTER pppoe_profile'
    );
    console.log('Added customers.onu_serial_number column.');
  }

  await query(
    `UPDATE customers
     SET onu_serial_number = NULLIF(
       UPPER(
         REPLACE(
           REPLACE(
             REPLACE(
               REPLACE(TRIM(onu_serial_number), ' ', ''),
               CHAR(9), ''
             ),
             CHAR(10), ''
           ),
           CHAR(13), ''
         )
       ),
       ''
     )
     WHERE onu_serial_number IS NOT NULL`
  );

  const [indexRows] = await query(
    `SELECT 1
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'customers'
       AND index_name = 'uniq_customers_branch_onu_serial'
     LIMIT 1`
  );
  if (!indexRows || !indexRows.length) {
    await query(
      'ALTER TABLE customers ADD UNIQUE KEY uniq_customers_branch_onu_serial (branch_id, onu_serial_number)'
    );
    console.log('Added customers uniq_customers_branch_onu_serial index.');
  }
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

async function ensureCustomersStartTypeColumn() {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'customers'
       AND column_name = 'customer_start_type'
     LIMIT 1`
  );
  if (rows && rows.length) return;
  await query(
    'ALTER TABLE customers ADD COLUMN customer_start_type VARCHAR(20) NULL AFTER plan_category'
  );
  console.log('Added customers.customer_start_type column.');
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

async function ensurePonPortNamesColumn() {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'pon_olts'
       AND column_name = 'pon_port_names_json'
     LIMIT 1`
  );
  if (rows && rows.length) return;
  await query(
    'ALTER TABLE pon_olts ADD COLUMN pon_port_names_json LONGTEXT NULL AFTER pon_code_prefix'
  );
  console.log('Added pon_olts.pon_port_names_json column.');
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

async function ensureTicketArchiveColumns() {
  const columns = [
    ['archived_at', 'ALTER TABLE tickets ADD COLUMN archived_at DATETIME NULL AFTER updated_at'],
    ['archived_by', 'ALTER TABLE tickets ADD COLUMN archived_by VARCHAR(120) NULL AFTER archived_at']
  ];
  for (const [name, ddl] of columns) {
    const [rows] = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'tickets'
         AND column_name = ?
       LIMIT 1`,
      [name]
    );
    if (rows && rows.length) continue;
    await query(ddl);
    console.log(`Added tickets.${name} column.`);
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

async function ensureTechnicianDispatchSchema() {
  const columns = [
    ['appointment_end', 'ALTER TABLE jobs ADD COLUMN appointment_end DATETIME NULL AFTER schedule'],
    ['sla_due_at', 'ALTER TABLE jobs ADD COLUMN sla_due_at DATETIME NULL AFTER appointment_end'],
    ['workflow_status', "ALTER TABLE jobs ADD COLUMN workflow_status VARCHAR(30) NOT NULL DEFAULT 'unassigned' AFTER status"],
    ['customer_account_number', 'ALTER TABLE jobs ADD COLUMN customer_account_number VARCHAR(20) NULL AFTER description'],
    ['customer_name', 'ALTER TABLE jobs ADD COLUMN customer_name VARCHAR(200) NULL AFTER customer_account_number'],
    ['customer_phone', 'ALTER TABLE jobs ADD COLUMN customer_phone VARCHAR(50) NULL AFTER customer_name'],
    ['service_address', 'ALTER TABLE jobs ADD COLUMN service_address VARCHAR(500) NULL AFTER customer_phone'],
    ['latitude', 'ALTER TABLE jobs ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER service_address'],
    ['longitude', 'ALTER TABLE jobs ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude'],
    ['plan_name', 'ALTER TABLE jobs ADD COLUMN plan_name VARCHAR(120) NULL AFTER longitude'],
    ['dispatch_payload_json', 'ALTER TABLE jobs ADD COLUMN dispatch_payload_json LONGTEXT NULL AFTER plan_name'],
    ['record_version', 'ALTER TABLE jobs ADD COLUMN record_version INT NOT NULL DEFAULT 1 AFTER dispatch_payload_json']
  ];

  for (const [name, ddl] of columns) {
    const [rows] = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'jobs'
         AND column_name = ?
       LIMIT 1`,
      [name]
    );
    if (rows && rows.length) continue;
    await query(ddl);
    console.log(`Added jobs.${name} column.`);
  }

  await query(
    `UPDATE jobs
     SET workflow_status = CASE
       WHEN LOWER(TRIM(COALESCE(workflow_status, ''))) IN (
         'unassigned', 'assigned', 'accepted', 'traveling', 'on_site', 'completed',
         'failed', 'rescheduled', 'needs_team', 'rejected', 'cancelled'
       ) THEN LOWER(TRIM(workflow_status))
       WHEN LOWER(TRIM(COALESCE(status, ''))) IN ('done', 'closed', 'resolved', 'completed') THEN 'completed'
       WHEN LOWER(TRIM(COALESCE(status, ''))) IN ('in-progress', 'in_progress') THEN 'accepted'
       WHEN TRIM(COALESCE(technician, '')) <> ''
         AND LOWER(TRIM(COALESCE(technician, ''))) NOT IN ('unassigned', 'pending assignment') THEN 'assigned'
       ELSE 'unassigned'
     END,
     record_version = CASE WHEN record_version IS NULL OR record_version < 1 THEN 1 ELSE record_version END`
  );

  const indexes = [
    ['idx_jobs_branch_workflow', 'ALTER TABLE jobs ADD KEY idx_jobs_branch_workflow (branch_id, workflow_status, schedule)'],
    ['idx_jobs_branch_technician', 'ALTER TABLE jobs ADD KEY idx_jobs_branch_technician (branch_id, technician, workflow_status)'],
    ['idx_jobs_customer_account', 'ALTER TABLE jobs ADD KEY idx_jobs_customer_account (customer_account_number)']
  ];
  for (const [name, ddl] of indexes) {
    const [rows] = await query(
      `SELECT 1
       FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND table_name = 'jobs'
         AND index_name = ?
       LIMIT 1`,
      [name]
    );
    if (rows && rows.length) continue;
    await query(ddl);
    console.log(`Added jobs ${name} index.`);
  }
}

async function ensureFinanceExpenseColumns() {
  const [payeeRows] = await query(
    `SELECT character_maximum_length AS max_length
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'finance_expenses'
       AND column_name = 'payee'
     LIMIT 1`
  );
  if (payeeRows?.length && Number(payeeRows[0].max_length || 0) < 160) {
    await query('ALTER TABLE finance_expenses MODIFY COLUMN payee VARCHAR(160) NULL');
    console.log('Expanded finance_expenses.payee to 160 characters.');
  }

  const columns = [
    ['vendor', 'ALTER TABLE finance_expenses ADD COLUMN vendor VARCHAR(160) NULL AFTER payee'],
    ['payment_method', "ALTER TABLE finance_expenses ADD COLUMN payment_method VARCHAR(30) NOT NULL DEFAULT 'other' AFTER amount"],
    ['reference_number', 'ALTER TABLE finance_expenses ADD COLUMN reference_number VARCHAR(120) NULL AFTER payment_method'],
    ['receipt_url', 'ALTER TABLE finance_expenses ADD COLUMN receipt_url VARCHAR(500) NULL AFTER reference_number'],
    ['receipt_name', 'ALTER TABLE finance_expenses ADD COLUMN receipt_name VARCHAR(180) NULL AFTER receipt_url'],
    ['status', "ALTER TABLE finance_expenses ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'paid' AFTER receipt_name"],
    ['approved_at', 'ALTER TABLE finance_expenses ADD COLUMN approved_at DATETIME NULL AFTER updated_at'],
    ['updated_by_user_id', 'ALTER TABLE finance_expenses ADD COLUMN updated_by_user_id VARCHAR(32) NULL AFTER created_by_name'],
    ['updated_by_username', 'ALTER TABLE finance_expenses ADD COLUMN updated_by_username VARCHAR(100) NULL AFTER updated_by_user_id'],
    ['updated_by_name', 'ALTER TABLE finance_expenses ADD COLUMN updated_by_name VARCHAR(120) NULL AFTER updated_by_username'],
    ['approved_by_user_id', 'ALTER TABLE finance_expenses ADD COLUMN approved_by_user_id VARCHAR(32) NULL AFTER updated_by_name'],
    ['approved_by_username', 'ALTER TABLE finance_expenses ADD COLUMN approved_by_username VARCHAR(100) NULL AFTER approved_by_user_id'],
    ['approved_by_name', 'ALTER TABLE finance_expenses ADD COLUMN approved_by_name VARCHAR(120) NULL AFTER approved_by_username']
  ];

  for (const [name, ddl] of columns) {
    const [rows] = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'finance_expenses'
         AND column_name = ?
       LIMIT 1`,
      [name]
    );
    if (rows && rows.length) continue;
    await query(ddl);
    console.log(`Added finance_expenses.${name} column.`);
  }

  await query(
    `UPDATE finance_expenses
     SET vendor = COALESCE(NULLIF(TRIM(vendor), ''), NULLIF(TRIM(payee), '')),
         payee = COALESCE(NULLIF(TRIM(payee), ''), NULLIF(TRIM(vendor), '')),
         payment_method = CASE
           WHEN LOWER(TRIM(COALESCE(payment_method, ''))) IN ('cash', 'gcash', 'bank_transfer', 'card', 'check', 'other')
             THEN LOWER(TRIM(payment_method))
           ELSE 'other'
         END,
         status = CASE
           WHEN LOWER(TRIM(COALESCE(status, ''))) IN ('draft', 'pending', 'approved', 'paid', 'rejected')
             THEN LOWER(TRIM(status))
           ELSE 'paid'
         END`
  );

  const [indexRows] = await query(
    `SELECT 1
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'finance_expenses'
       AND index_name = 'idx_fin_exp_branch_status'
     LIMIT 1`
  );
  if (!indexRows || !indexRows.length) {
    await query('ALTER TABLE finance_expenses ADD KEY idx_fin_exp_branch_status (branch_id, status, expense_date)');
    console.log('Added finance_expenses idx_fin_exp_branch_status index.');
  }
}

async function updateSchema() {
  if (!isMysqlEnabled()) {
    throw new Error('MySQL is not configured. Set MYSQL_* env or save config first.');
  }

  await runSchema();
  await ensureTechnicianDispatchSchema();
  await ensureFinanceExpenseColumns();
  await ensureIntegrationSettingsSecretJsonColumn();
  await ensureCustomersPrepaidExpirationColumn();
  await ensureCustomersActivationDateColumn();
  await ensureCustomersMikrotikIdColumn();
  await ensureCustomersOnuSerialColumnAndIndex();
  await ensureCustomersPlanIdColumn();
  await ensureCustomersStartTypeColumn();
  await ensureCustomersScheduledPlanColumns();
  await ensurePlansProfileBindingsColumn();
  await ensureCoverageAreasMikrotikIdColumn();
  await ensurePonPortNamesColumn();
  await ensurePaymentEntriesOrNumberColumn();
  await ensureTicketsTicketNumberColumn();
  await ensureTicketArchiveColumns();
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
