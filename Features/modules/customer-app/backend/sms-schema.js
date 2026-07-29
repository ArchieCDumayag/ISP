const { query } = require('../../../../core/data/db');
const { isJsonStorageMode } = require('../../../../core/config/storage-mode');

let smsSchemaReady = null;

const hasColumn = async (tableName, columnName) => {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return Boolean(rows && rows.length);
};

const getVarcharLength = async (tableName, columnName) => {
  const [rows] = await query(
    `SELECT character_maximum_length AS length
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  const length = Number(rows?.[0]?.length || 0);
  return Number.isFinite(length) && length > 0 ? length : 0;
};

const hasIndex = async (tableName, indexName) => {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND index_name = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return Boolean(rows && rows.length);
};

const hasForeignKey = async (tableName, constraintName) => {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND constraint_name = ?
       AND constraint_type = 'FOREIGN KEY'
     LIMIT 1`,
    [tableName, constraintName]
  );
  return Boolean(rows && rows.length);
};

const ensureSmsSchema = async () => {
  if (isJsonStorageMode()) return false;
  if (smsSchemaReady) return smsSchemaReady;
  smsSchemaReady = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS sms_templates (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        name VARCHAR(150) NOT NULL,
        content TEXT NOT NULL,
        channels VARCHAR(80) NULL,
        is_active TINYINT NOT NULL DEFAULT 1,
        created_by_user_id VARCHAR(32) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_sms_templates_branch_name (branch_id, name),
        KEY idx_sms_templates_branch (branch_id),
        KEY idx_sms_templates_active (is_active),
        CONSTRAINT fk_sms_templates_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
        CONSTRAINT fk_sms_templates_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS sms_schedules (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        title VARCHAR(180) NOT NULL,
        recipient_type VARCHAR(20) NOT NULL DEFAULT 'subscriber',
        recipient_value TEXT NULL,
        recipient_identifier VARCHAR(200) NULL,
        message_text TEXT NOT NULL,
        delivery_methods VARCHAR(80) NOT NULL DEFAULT 'semaphore,mail',
        template_id BIGINT NULL,
        schedule_mode VARCHAR(30) NOT NULL DEFAULT 'custom',
        schedule_time DATETIME NULL,
        schedule_due_time VARCHAR(8) NULL,
        schedule_delay_days INT NOT NULL DEFAULT 0,
        repeat_mode VARCHAR(20) NOT NULL DEFAULT 'once',
        repeat_count INT NOT NULL DEFAULT 0,
        run_count INT NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_by_user_id VARCHAR(32) NULL,
        last_executed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_sms_schedules_branch (branch_id),
        KEY idx_sms_schedules_status (status),
        KEY idx_sms_schedules_time (schedule_time),
        KEY idx_sms_schedules_template (template_id),
        CONSTRAINT fk_sms_schedules_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
        CONSTRAINT fk_sms_schedules_template FOREIGN KEY (template_id) REFERENCES sms_templates(id) ON DELETE SET NULL,
        CONSTRAINT fk_sms_schedules_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS sms_automations (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        name VARCHAR(180) NOT NULL,
        trigger_event VARCHAR(80) NOT NULL,
        timing VARCHAR(80) NOT NULL DEFAULT 'immediate',
        channels VARCHAR(80) NOT NULL DEFAULT 'sms,email',
        template_id BIGINT NULL,
        message_text TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_by_user_id VARCHAR(32) NULL,
        last_triggered_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_sms_automations_branch_name (branch_id, name),
        KEY idx_sms_automations_branch (branch_id),
        KEY idx_sms_automations_trigger (trigger_event),
        KEY idx_sms_automations_status (status),
        KEY idx_sms_automations_template (template_id),
        CONSTRAINT fk_sms_automations_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
        CONSTRAINT fk_sms_automations_template FOREIGN KEY (template_id) REFERENCES sms_templates(id) ON DELETE SET NULL,
        CONSTRAINT fk_sms_automations_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS sms_automation_runs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        automation_id BIGINT NOT NULL,
        branch_id INT NOT NULL,
        customer_account_number VARCHAR(20) NULL,
        recipient VARCHAR(64) NULL,
        delivery_method VARCHAR(32) NOT NULL,
        status VARCHAR(32) NOT NULL,
        error_message TEXT NULL,
        payload TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_sms_runs_automation (automation_id),
        KEY idx_sms_runs_branch_status (branch_id, status),
        KEY idx_sms_runs_created (created_at),
        KEY idx_sms_runs_account (customer_account_number),
        CONSTRAINT fk_sms_runs_automation FOREIGN KEY (automation_id) REFERENCES sms_automations(id) ON DELETE CASCADE,
        CONSTRAINT fk_sms_runs_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
        CONSTRAINT fk_sms_runs_account FOREIGN KEY (customer_account_number) REFERENCES customers(account_number) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS sms_messages (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        schedule_id BIGINT NULL,
        provider VARCHAR(32) NOT NULL DEFAULT 'semaphore',
        recipient VARCHAR(255) NOT NULL,
        recipient_label VARCHAR(200) NULL,
        customer_account_number VARCHAR(20) NULL,
        recipient_area VARCHAR(150) NULL,
        sender_name VARCHAR(128) NULL,
        message_text TEXT NOT NULL,
        status VARCHAR(32) NOT NULL,
        provider_message_id VARCHAR(120) NULL,
        provider_response TEXT NULL,
        error_message TEXT NULL,
        created_by_user_id VARCHAR(32) NULL,
        created_by_username VARCHAR(120) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_sms_branch_created (branch_id, created_at),
        KEY idx_sms_branch_status (branch_id, status),
        KEY idx_sms_account (customer_account_number),
        KEY idx_sms_schedule (schedule_id),
        CONSTRAINT fk_sms_messages_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
        CONSTRAINT fk_sms_messages_schedule FOREIGN KEY (schedule_id) REFERENCES sms_schedules(id) ON DELETE SET NULL,
        CONSTRAINT fk_sms_messages_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    if (!await hasColumn('sms_messages', 'schedule_id')) {
      await query('ALTER TABLE sms_messages ADD COLUMN schedule_id BIGINT NULL AFTER branch_id');
    }
    const recipientLength = await getVarcharLength('sms_messages', 'recipient');
    if (recipientLength > 0 && recipientLength < 255) {
      await query('ALTER TABLE sms_messages MODIFY COLUMN recipient VARCHAR(255) NOT NULL');
    }
    const senderNameLength = await getVarcharLength('sms_messages', 'sender_name');
    if (senderNameLength > 0 && senderNameLength < 128) {
      await query('ALTER TABLE sms_messages MODIFY COLUMN sender_name VARCHAR(128) NULL');
    }
    if (!await hasColumn('sms_schedules', 'run_count')) {
      await query('ALTER TABLE sms_schedules ADD COLUMN run_count INT NOT NULL DEFAULT 0 AFTER repeat_count');
    }
    if (!await hasIndex('sms_messages', 'idx_sms_schedule')) {
      await query('ALTER TABLE sms_messages ADD KEY idx_sms_schedule (schedule_id)');
    }
    if (!await hasForeignKey('sms_messages', 'fk_sms_messages_schedule')) {
      await query(
        'ALTER TABLE sms_messages ADD CONSTRAINT fk_sms_messages_schedule FOREIGN KEY (schedule_id) REFERENCES sms_schedules(id) ON DELETE SET NULL'
      );
    }
  })().catch((error) => {
    smsSchemaReady = null;
    throw error;
  });
  return smsSchemaReady;
};

module.exports = {
  ensureSmsSchema
};
