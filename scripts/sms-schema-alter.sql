-- Manual idempotent upgrade for existing databases.
-- Run this against your target schema before restarting the app.

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'sms_messages'
        AND column_name = 'schedule_id'
    ),
    'SELECT 1',
    'ALTER TABLE sms_messages ADD COLUMN schedule_id BIGINT NULL AFTER branch_id'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'sms_schedules'
        AND column_name = 'run_count'
    ),
    'SELECT 1',
    'ALTER TABLE sms_schedules ADD COLUMN run_count INT NOT NULL DEFAULT 0 AFTER repeat_count'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'sms_messages'
        AND index_name = 'idx_sms_schedule'
    ),
    'SELECT 1',
    'ALTER TABLE sms_messages ADD KEY idx_sms_schedule (schedule_id)'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'sms_messages'
        AND column_name = 'recipient'
        AND character_maximum_length >= 255
    ),
    'SELECT 1',
    'ALTER TABLE sms_messages MODIFY COLUMN recipient VARCHAR(255) NOT NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'sms_messages'
        AND column_name = 'sender_name'
        AND character_maximum_length >= 128
    ),
    'SELECT 1',
    'ALTER TABLE sms_messages MODIFY COLUMN sender_name VARCHAR(128) NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = DATABASE()
        AND table_name = 'sms_messages'
        AND constraint_name = 'fk_sms_messages_schedule'
        AND constraint_type = 'FOREIGN KEY'
    ),
    'SELECT 1',
    'ALTER TABLE sms_messages ADD CONSTRAINT fk_sms_messages_schedule FOREIGN KEY (schedule_id) REFERENCES sms_schedules(id) ON DELETE SET NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
