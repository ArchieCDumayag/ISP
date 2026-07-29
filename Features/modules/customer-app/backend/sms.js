const express = require('express');
const { query } = require('../../../../core/data/db');
const { ensureSmsSchema } = require('./sms-schema');
const { isJsonStorageMode } = require('../../../../core/config/storage-mode');
const {
  STATUS_FAILED,
  STATUS_SENT,
  toText,
  normalizeDeliveryMethods,
  normalizeTemplateChannels,
  resolveRecipients,
  resolveAuditUser,
  dispatchMessageToRecipients
} = require('./sms-delivery');

const router = express.Router();

router.use((req, res, next) => {
  if (!isJsonStorageMode()) return next();
  return res.status(503).json({
    ok: false,
    error: 'SMS tools require MySQL storage. JSON file storage mode does not use the SMS database schema.'
  });
});

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const getBranchIdFromRequest = (req) => {
  const branchId = Number(req.user?.branchId);
  if (!Number.isInteger(branchId) || branchId <= 0) return null;
  return branchId;
};

const parseJsonSafe = (value, fallback = null) => {
  const raw = toText(value);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const toMySqlDateTime = (value) => {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  const raw = toText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return `${raw.replace('T', ' ')}:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(raw)) {
    return new Date(raw).toISOString().slice(0, 19).replace('T', ' ');
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
};

const normalizeScheduleDueTime = (value) => {
  const raw = toText(value);
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return '';
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const normalizeRepeatMode = (value) => {
  const mode = toText(value).toLowerCase();
  if (mode === 'twice') return 'twice';
  if (mode === 'more') return 'more';
  if (mode === 'every-month') return 'every-month';
  return 'once';
};

const normalizeScheduleMode = (value) => {
  const mode = toText(value).toLowerCase();
  if (mode === 'billing-date') return 'billing-date';
  if (mode === 'due-date') return 'due-date';
  return 'custom';
};

const normalizeScheduleStatus = (value) => {
  const status = toText(value).toLowerCase();
  if (status === 'paused') return 'paused';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'completed') return 'completed';
  return 'active';
};

const normalizeAutomationStatus = (value) => {
  const status = toText(value).toLowerCase();
  if (status === 'paused') return 'paused';
  return 'active';
};

const normalizeAutomationChannels = (value) => {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const mapped = source
    .map((entry) => toText(entry).toLowerCase())
    .map((entry) => {
      if (entry === 'semaphore') return 'sms';
      if (entry === 'mail') return 'email';
      return entry;
    })
    .filter((entry) => entry === 'sms' || entry === 'email');
  return Array.from(new Set(mapped));
};

const mapTemplateRow = (row) => ({
  id: row.id,
  name: toText(row.name),
  content: toText(row.content),
  channels: normalizeTemplateChannels(row.channels || 'sms,email'),
  isActive: Number(row.isActive) !== 0,
  createdAt: row.createdAt || null,
  updatedAt: row.updatedAt || null
});

const mapScheduleRow = (row) => ({
  id: row.id,
  title: toText(row.title),
  recipientType: toText(row.recipientType || 'subscriber') || 'subscriber',
  recipientValue: parseJsonSafe(row.recipientValue, null),
  recipientIdentifier: toText(row.recipientIdentifier),
  messageText: toText(row.messageText),
  deliveryMethods: normalizeDeliveryMethods(row.deliveryMethods || 'semaphore'),
  templateId: row.templateId != null ? Number(row.templateId) : null,
  scheduleMode: normalizeScheduleMode(row.scheduleMode),
  scheduleTime: row.scheduleTime || null,
  scheduleDueTime: normalizeScheduleDueTime(row.scheduleDueTime),
  scheduleDelayDays: Number.isInteger(Number(row.scheduleDelayDays)) ? Number(row.scheduleDelayDays) : 0,
  repeatMode: normalizeRepeatMode(row.repeatMode),
  repeatCount: Number.isInteger(Number(row.repeatCount)) ? Number(row.repeatCount) : 0,
  runCount: Number.isInteger(Number(row.runCount)) ? Number(row.runCount) : 0,
  status: normalizeScheduleStatus(row.status),
  lastExecutedAt: row.lastExecutedAt || null,
  createdAt: row.createdAt || null,
  updatedAt: row.updatedAt || null
});

const mapAutomationRow = (row) => {
  const channels = normalizeAutomationChannels(row.channels || 'sms,email');
  return {
    id: row.id,
    name: toText(row.name),
    triggerEvent: toText(row.triggerEvent),
    trigger: toText(row.triggerEvent),
    timing: toText(row.timing || 'immediate'),
    channels,
    templateId: row.templateId != null ? Number(row.templateId) : null,
    messageText: toText(row.messageText),
    message: toText(row.messageText),
    status: normalizeAutomationStatus(row.status),
    lastTriggeredAt: row.lastTriggeredAt || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
};

router.post('/send', async (req, res, next) => {
  try {
    await ensureSmsSchema();

    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const message = toText(req.body?.message);
    if (!message) {
      return res.status(400).json({ ok: false, error: 'Message is required.' });
    }

    const methods = normalizeDeliveryMethods(req.body?.deliveryMethods || req.body?.deliveryMethod, {
      fallback: ['semaphore']
    });
    if (!methods.length) {
      return res.status(400).json({ ok: false, error: 'At least one delivery method is required.' });
    }

    const { valid, invalid } = resolveRecipients(req.body?.recipients, methods);
    if (!valid.length) {
      return res.status(400).json({
        ok: false,
        error: 'No valid recipients found for the selected delivery methods.',
        invalidRecipients: invalid
      });
    }

    let dispatched;
    try {
      dispatched = await dispatchMessageToRecipients({
        branchId,
        recipients: valid,
        message,
        deliveryMethods: methods,
        user: req.user,
        scheduleId: null,
        subject: toText(req.body?.subject)
      });
    } catch (error) {
      const messageText = toText(error?.message);
      if (messageText.includes('CONFIG_MASTER_KEY')) {
        return res.status(400).json({
          ok: false,
          error: 'CONFIG_MASTER_KEY is required before sending notifications.'
        });
      }
      throw error;
    }

    const statusCode = dispatched.failed > 0 ? (dispatched.sent > 0 ? 207 : 502) : 200;
    return res.status(statusCode).json({
      ok: dispatched.failed === 0,
      requested: valid.length,
      attempted: dispatched.results.length,
      sent: dispatched.sent,
      failed: dispatched.failed,
      results: dispatched.results,
      invalidRecipients: invalid
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/history', async (req, res, next) => {
  try {
    await ensureSmsSchema();

    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const requestedLimit = Number(req.query.limit);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 500)
      : 100;

    const [rows] = await query(
      `SELECT
          id,
          schedule_id AS scheduleId,
          provider,
          recipient,
          recipient_label AS recipientLabel,
          customer_account_number AS accountNumber,
          recipient_area AS area,
          message_text AS message,
          status,
          error_message AS errorMessage,
          created_by_username AS sentBy,
          created_at AS createdAt
       FROM sms_messages
       WHERE branch_id = ?
       ORDER BY id DESC
       LIMIT ?`,
      [branchId, limit]
    );

    const history = (rows || []).map((row) => ({
      id: row.id,
      scheduleId: row.scheduleId != null ? Number(row.scheduleId) : null,
      provider: toText(row.provider),
      recipient: toText(row.recipientLabel || row.recipient),
      recipientNumber: toText(row.recipient),
      accountNumber: toText(row.accountNumber),
      area: toText(row.area),
      message: toText(row.message),
      status: toText(row.status || STATUS_SENT),
      error: toText(row.errorMessage),
      sentBy: toText(row.sentBy),
      date: row.createdAt || null
    }));

    return res.json({ ok: true, history });
  } catch (error) {
    return next(error);
  }
});

router.get('/templates', async (req, res, next) => {
  try {
    await ensureSmsSchema();
    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const [rows] = await query(
      `SELECT
          id,
          name,
          content,
          channels,
          is_active AS isActive,
          created_at AS createdAt,
          updated_at AS updatedAt
       FROM sms_templates
       WHERE branch_id = ?
       ORDER BY updated_at DESC, id DESC`,
      [branchId]
    );

    return res.json({
      ok: true,
      templates: (rows || []).map(mapTemplateRow)
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/templates', async (req, res, next) => {
  try {
    await ensureSmsSchema();
    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const name = toText(req.body?.name);
    const content = toText(req.body?.content);
    const channels = normalizeTemplateChannels(req.body?.channels || req.body?.deliveryMethods);
    const isActive = req.body?.isActive === false || String(req.body?.isActive).toLowerCase() === 'false' ? 0 : 1;
    const auditUser = resolveAuditUser(req.user);

    if (!name) {
      return res.status(400).json({ ok: false, error: 'Template name is required.' });
    }
    if (!content) {
      return res.status(400).json({ ok: false, error: 'Template content is required.' });
    }
    if (!channels.length) {
      return res.status(400).json({ ok: false, error: 'At least one channel is required.' });
    }

    const [result] = await query(
      `INSERT INTO sms_templates (
          branch_id, name, content, channels, is_active, created_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        branchId,
        name,
        content,
        channels.join(','),
        isActive,
        auditUser.userId || null
      ]
    );

    const [rows] = await query(
      `SELECT
          id,
          name,
          content,
          channels,
          is_active AS isActive,
          created_at AS createdAt,
          updated_at AS updatedAt
       FROM sms_templates
       WHERE id = ? AND branch_id = ?
       LIMIT 1`,
      [result.insertId, branchId]
    );

    return res.status(201).json({
      ok: true,
      template: rows && rows.length ? mapTemplateRow(rows[0]) : null
    });
  } catch (error) {
    if (String(error?.code || '').toUpperCase() === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, error: 'Template name already exists in this branch.' });
    }
    return next(error);
  }
});

router.patch('/templates/:id', async (req, res, next) => {
  try {
    await ensureSmsSchema();
    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid template id.' });
    }

    const [existingRows] = await query(
      'SELECT id, name, content, channels, is_active AS isActive FROM sms_templates WHERE id = ? AND branch_id = ? LIMIT 1',
      [id, branchId]
    );
    if (!existingRows || !existingRows.length) {
      return res.status(404).json({ ok: false, error: 'Template not found.' });
    }

    const existing = existingRows[0];
    const name = hasOwn(req.body, 'name') ? toText(req.body?.name) : existing.name;
    const content = hasOwn(req.body, 'content') ? toText(req.body?.content) : existing.content;
    const channels = hasOwn(req.body, 'channels') || hasOwn(req.body, 'deliveryMethods')
      ? normalizeTemplateChannels(req.body?.channels || req.body?.deliveryMethods)
      : normalizeTemplateChannels(existing.channels || 'sms,email');
    const isActive = hasOwn(req.body, 'isActive')
      ? (req.body?.isActive === false || String(req.body?.isActive).toLowerCase() === 'false' ? 0 : 1)
      : (Number(existing.isActive) === 0 ? 0 : 1);

    if (!name) {
      return res.status(400).json({ ok: false, error: 'Template name is required.' });
    }
    if (!content) {
      return res.status(400).json({ ok: false, error: 'Template content is required.' });
    }
    if (!channels.length) {
      return res.status(400).json({ ok: false, error: 'At least one channel is required.' });
    }

    await query(
      `UPDATE sms_templates
       SET name = ?, content = ?, channels = ?, is_active = ?
       WHERE id = ? AND branch_id = ?`,
      [name, content, channels.join(','), isActive, id, branchId]
    );

    const [rows] = await query(
      `SELECT
          id,
          name,
          content,
          channels,
          is_active AS isActive,
          created_at AS createdAt,
          updated_at AS updatedAt
       FROM sms_templates
       WHERE id = ? AND branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    return res.json({
      ok: true,
      template: rows && rows.length ? mapTemplateRow(rows[0]) : null
    });
  } catch (error) {
    if (String(error?.code || '').toUpperCase() === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, error: 'Template name already exists in this branch.' });
    }
    return next(error);
  }
});

router.delete('/templates/:id', async (req, res, next) => {
  try {
    await ensureSmsSchema();
    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid template id.' });
    }

    const [result] = await query(
      'DELETE FROM sms_templates WHERE id = ? AND branch_id = ?',
      [id, branchId]
    );
    if (!result || !result.affectedRows) {
      return res.status(404).json({ ok: false, error: 'Template not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get('/schedules', async (req, res, next) => {
  try {
    await ensureSmsSchema();
    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const [rows] = await query(
      `SELECT
          id,
          title,
          recipient_type AS recipientType,
          recipient_value AS recipientValue,
          recipient_identifier AS recipientIdentifier,
          message_text AS messageText,
          delivery_methods AS deliveryMethods,
          template_id AS templateId,
          schedule_mode AS scheduleMode,
          schedule_time AS scheduleTime,
          schedule_due_time AS scheduleDueTime,
          schedule_delay_days AS scheduleDelayDays,
          repeat_mode AS repeatMode,
          repeat_count AS repeatCount,
          run_count AS runCount,
          status,
          last_executed_at AS lastExecutedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
       FROM sms_schedules
       WHERE branch_id = ?
       ORDER BY updated_at DESC, id DESC`,
      [branchId]
    );

    return res.json({
      ok: true,
      schedules: (rows || []).map(mapScheduleRow)
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/schedules', async (req, res, next) => {
  try {
    await ensureSmsSchema();
    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const title = toText(req.body?.title || req.body?.scheduleTitle);
    const recipientType = toText(req.body?.recipientType || 'subscriber').toLowerCase() === 'area' ? 'area' : 'subscriber';
    const recipientValueRaw = hasOwn(req.body, 'recipientValue') ? req.body.recipientValue : null;
    const recipientValue = recipientValueRaw == null ? null : JSON.stringify(recipientValueRaw);
    const recipientIdentifier = toText(req.body?.recipientIdentifier || req.body?.recipient || '');
    const messageText = toText(req.body?.messageText || req.body?.message);
    const deliveryMethods = normalizeDeliveryMethods(req.body?.deliveryMethods || req.body?.deliveryMethod, {
      fallback: ['semaphore']
    });
    const templateId = Number(req.body?.templateId);
    const scheduleMode = normalizeScheduleMode(req.body?.scheduleMode || req.body?.scheduleDateMode);
    const scheduleTime = toMySqlDateTime(req.body?.scheduleTime || req.body?.scheduleDateTime);
    const scheduleDueTime = normalizeScheduleDueTime(req.body?.scheduleDueTime);
    const scheduleDelayDays = Math.max(0, Number.parseInt(req.body?.scheduleDelayDays || '0', 10) || 0);
    const repeatMode = normalizeRepeatMode(req.body?.repeatMode || req.body?.scheduleRepeat);
    const repeatCount = repeatMode === 'more'
      ? Math.max(3, Number.parseInt(req.body?.repeatCount || req.body?.scheduleRepeatCount || '3', 10) || 3)
      : 0;
    const status = normalizeScheduleStatus(req.body?.status || 'active');
    const auditUser = resolveAuditUser(req.user);

    if (!title) {
      return res.status(400).json({ ok: false, error: 'Schedule title is required.' });
    }
    if (!messageText) {
      return res.status(400).json({ ok: false, error: 'Message is required.' });
    }
    if (!deliveryMethods.length) {
      return res.status(400).json({ ok: false, error: 'At least one delivery method is required.' });
    }
    if (scheduleMode === 'custom' && !scheduleTime) {
      return res.status(400).json({ ok: false, error: 'Custom schedules require scheduleTime.' });
    }
    if (scheduleMode !== 'custom' && !scheduleDueTime) {
      return res.status(400).json({ ok: false, error: 'Billing/Due schedules require scheduleDueTime (HH:MM).' });
    }

    const [result] = await query(
      `INSERT INTO sms_schedules (
          branch_id, title, recipient_type, recipient_value, recipient_identifier,
          message_text, delivery_methods, template_id,
          schedule_mode, schedule_time, schedule_due_time, schedule_delay_days,
          repeat_mode, repeat_count, run_count, status,
          created_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        branchId,
        title,
        recipientType,
        recipientValue,
        recipientIdentifier || null,
        messageText,
        deliveryMethods.join(','),
        Number.isInteger(templateId) && templateId > 0 ? templateId : null,
        scheduleMode,
        scheduleTime,
        scheduleDueTime || null,
        scheduleDelayDays,
        repeatMode,
        repeatCount,
        status,
        auditUser.userId || null
      ]
    );

    const [rows] = await query(
      `SELECT
          id,
          title,
          recipient_type AS recipientType,
          recipient_value AS recipientValue,
          recipient_identifier AS recipientIdentifier,
          message_text AS messageText,
          delivery_methods AS deliveryMethods,
          template_id AS templateId,
          schedule_mode AS scheduleMode,
          schedule_time AS scheduleTime,
          schedule_due_time AS scheduleDueTime,
          schedule_delay_days AS scheduleDelayDays,
          repeat_mode AS repeatMode,
          repeat_count AS repeatCount,
          run_count AS runCount,
          status,
          last_executed_at AS lastExecutedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
       FROM sms_schedules
       WHERE id = ? AND branch_id = ?
       LIMIT 1`,
      [result.insertId, branchId]
    );

    return res.status(201).json({
      ok: true,
      schedule: rows && rows.length ? mapScheduleRow(rows[0]) : null
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/schedules/:id', async (req, res, next) => {
  try {
    await ensureSmsSchema();
    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid schedule id.' });
    }

    const [existingRows] = await query(
      `SELECT
          id,
          title,
          recipient_type AS recipientType,
          recipient_value AS recipientValue,
          recipient_identifier AS recipientIdentifier,
          message_text AS messageText,
          delivery_methods AS deliveryMethods,
          template_id AS templateId,
          schedule_mode AS scheduleMode,
          schedule_time AS scheduleTime,
          schedule_due_time AS scheduleDueTime,
          schedule_delay_days AS scheduleDelayDays,
          repeat_mode AS repeatMode,
          repeat_count AS repeatCount,
          run_count AS runCount,
          status
       FROM sms_schedules
       WHERE id = ? AND branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    if (!existingRows || !existingRows.length) {
      return res.status(404).json({ ok: false, error: 'Schedule not found.' });
    }

    const existing = existingRows[0];
    const nextTitle = hasOwn(req.body, 'title')
      ? toText(req.body?.title)
      : toText(existing.title);
    const nextRecipientType = hasOwn(req.body, 'recipientType')
      ? (toText(req.body?.recipientType).toLowerCase() === 'area' ? 'area' : 'subscriber')
      : (toText(existing.recipientType).toLowerCase() === 'area' ? 'area' : 'subscriber');
    const nextRecipientValue = hasOwn(req.body, 'recipientValue')
      ? (req.body?.recipientValue == null ? null : JSON.stringify(req.body.recipientValue))
      : existing.recipientValue;
    const nextRecipientIdentifier = hasOwn(req.body, 'recipientIdentifier')
      ? toText(req.body?.recipientIdentifier)
      : toText(existing.recipientIdentifier);
    const nextMessageText = hasOwn(req.body, 'messageText') || hasOwn(req.body, 'message')
      ? toText(req.body?.messageText || req.body?.message)
      : toText(existing.messageText);
    const nextDeliveryMethods = hasOwn(req.body, 'deliveryMethods') || hasOwn(req.body, 'deliveryMethod')
      ? normalizeDeliveryMethods(req.body?.deliveryMethods || req.body?.deliveryMethod)
      : normalizeDeliveryMethods(existing.deliveryMethods || 'semaphore');
    const nextTemplateId = hasOwn(req.body, 'templateId')
      ? Number(req.body?.templateId)
      : Number(existing.templateId);
    const nextScheduleMode = hasOwn(req.body, 'scheduleMode') || hasOwn(req.body, 'scheduleDateMode')
      ? normalizeScheduleMode(req.body?.scheduleMode || req.body?.scheduleDateMode)
      : normalizeScheduleMode(existing.scheduleMode);
    const nextScheduleTime = hasOwn(req.body, 'scheduleTime') || hasOwn(req.body, 'scheduleDateTime')
      ? toMySqlDateTime(req.body?.scheduleTime || req.body?.scheduleDateTime)
      : toMySqlDateTime(existing.scheduleTime);
    const nextScheduleDueTime = hasOwn(req.body, 'scheduleDueTime')
      ? normalizeScheduleDueTime(req.body?.scheduleDueTime)
      : normalizeScheduleDueTime(existing.scheduleDueTime);
    const nextDelayDays = hasOwn(req.body, 'scheduleDelayDays')
      ? Math.max(0, Number.parseInt(req.body?.scheduleDelayDays || '0', 10) || 0)
      : (Math.max(0, Number.parseInt(existing.scheduleDelayDays || '0', 10) || 0));
    const nextRepeatMode = hasOwn(req.body, 'repeatMode') || hasOwn(req.body, 'scheduleRepeat')
      ? normalizeRepeatMode(req.body?.repeatMode || req.body?.scheduleRepeat)
      : normalizeRepeatMode(existing.repeatMode);
    const nextRepeatCount = hasOwn(req.body, 'repeatCount') || hasOwn(req.body, 'scheduleRepeatCount')
      ? Math.max(0, Number.parseInt(req.body?.repeatCount || req.body?.scheduleRepeatCount || '0', 10) || 0)
      : (Math.max(0, Number.parseInt(existing.repeatCount || '0', 10) || 0));
    const nextStatus = hasOwn(req.body, 'status')
      ? normalizeScheduleStatus(req.body?.status)
      : normalizeScheduleStatus(existing.status);

    if (!nextTitle) {
      return res.status(400).json({ ok: false, error: 'Schedule title is required.' });
    }
    if (!nextMessageText) {
      return res.status(400).json({ ok: false, error: 'Message is required.' });
    }
    if (!nextDeliveryMethods.length) {
      return res.status(400).json({ ok: false, error: 'At least one delivery method is required.' });
    }
    if (nextScheduleMode === 'custom' && !nextScheduleTime) {
      return res.status(400).json({ ok: false, error: 'Custom schedules require scheduleTime.' });
    }
    if (nextScheduleMode !== 'custom' && !nextScheduleDueTime) {
      return res.status(400).json({ ok: false, error: 'Billing/Due schedules require scheduleDueTime (HH:MM).' });
    }

    await query(
      `UPDATE sms_schedules
       SET
          title = ?,
          recipient_type = ?,
          recipient_value = ?,
          recipient_identifier = ?,
          message_text = ?,
          delivery_methods = ?,
          template_id = ?,
          schedule_mode = ?,
          schedule_time = ?,
          schedule_due_time = ?,
          schedule_delay_days = ?,
          repeat_mode = ?,
          repeat_count = ?,
          status = ?
       WHERE id = ? AND branch_id = ?`,
      [
        nextTitle,
        nextRecipientType,
        nextRecipientValue,
        nextRecipientIdentifier || null,
        nextMessageText,
        nextDeliveryMethods.join(','),
        Number.isInteger(nextTemplateId) && nextTemplateId > 0 ? nextTemplateId : null,
        nextScheduleMode,
        nextScheduleTime,
        nextScheduleDueTime || null,
        nextDelayDays,
        nextRepeatMode,
        nextRepeatMode === 'more' ? Math.max(3, nextRepeatCount || 3) : 0,
        nextStatus,
        id,
        branchId
      ]
    );

    const [rows] = await query(
      `SELECT
          id,
          title,
          recipient_type AS recipientType,
          recipient_value AS recipientValue,
          recipient_identifier AS recipientIdentifier,
          message_text AS messageText,
          delivery_methods AS deliveryMethods,
          template_id AS templateId,
          schedule_mode AS scheduleMode,
          schedule_time AS scheduleTime,
          schedule_due_time AS scheduleDueTime,
          schedule_delay_days AS scheduleDelayDays,
          repeat_mode AS repeatMode,
          repeat_count AS repeatCount,
          run_count AS runCount,
          status,
          last_executed_at AS lastExecutedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
       FROM sms_schedules
       WHERE id = ? AND branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    return res.json({
      ok: true,
      schedule: rows && rows.length ? mapScheduleRow(rows[0]) : null
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/schedules/:id', async (req, res, next) => {
  try {
    await ensureSmsSchema();
    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid schedule id.' });
    }

    const [result] = await query(
      'DELETE FROM sms_schedules WHERE id = ? AND branch_id = ?',
      [id, branchId]
    );

    if (!result || !result.affectedRows) {
      return res.status(404).json({ ok: false, error: 'Schedule not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get('/automations', async (req, res, next) => {
  try {
    await ensureSmsSchema();
    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const [rows] = await query(
      `SELECT
          id,
          name,
          trigger_event AS triggerEvent,
          timing,
          channels,
          template_id AS templateId,
          message_text AS messageText,
          status,
          last_triggered_at AS lastTriggeredAt,
          created_at AS createdAt,
          updated_at AS updatedAt
       FROM sms_automations
       WHERE branch_id = ?
       ORDER BY updated_at DESC, id DESC`,
      [branchId]
    );

    return res.json({
      ok: true,
      automations: (rows || []).map(mapAutomationRow)
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/automations', async (req, res, next) => {
  try {
    await ensureSmsSchema();
    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const name = toText(req.body?.name);
    const triggerEvent = toText(req.body?.triggerEvent || req.body?.trigger);
    const timing = toText(req.body?.timing || 'immediate');
    const channels = normalizeAutomationChannels(req.body?.channels);
    const templateId = Number(req.body?.templateId);
    const messageText = toText(req.body?.messageText || req.body?.message);
    const status = normalizeAutomationStatus(req.body?.status || 'active');
    const auditUser = resolveAuditUser(req.user);

    if (!name) {
      return res.status(400).json({ ok: false, error: 'Automation name is required.' });
    }
    if (!triggerEvent) {
      return res.status(400).json({ ok: false, error: 'Trigger event is required.' });
    }
    if (!messageText) {
      return res.status(400).json({ ok: false, error: 'Message template is required.' });
    }
    if (!channels.length) {
      return res.status(400).json({ ok: false, error: 'At least one channel is required.' });
    }

    const [result] = await query(
      `INSERT INTO sms_automations (
          branch_id, name, trigger_event, timing, channels, template_id,
          message_text, status, created_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        branchId,
        name,
        triggerEvent,
        timing,
        channels.join(','),
        Number.isInteger(templateId) && templateId > 0 ? templateId : null,
        messageText,
        status,
        auditUser.userId || null
      ]
    );

    const [rows] = await query(
      `SELECT
          id,
          name,
          trigger_event AS triggerEvent,
          timing,
          channels,
          template_id AS templateId,
          message_text AS messageText,
          status,
          last_triggered_at AS lastTriggeredAt,
          created_at AS createdAt,
          updated_at AS updatedAt
       FROM sms_automations
       WHERE id = ? AND branch_id = ?
       LIMIT 1`,
      [result.insertId, branchId]
    );

    return res.status(201).json({
      ok: true,
      automation: rows && rows.length ? mapAutomationRow(rows[0]) : null
    });
  } catch (error) {
    if (String(error?.code || '').toUpperCase() === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, error: 'Automation name already exists in this branch.' });
    }
    return next(error);
  }
});

router.patch('/automations/:id/status', async (req, res, next) => {
  try {
    await ensureSmsSchema();
    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid automation id.' });
    }

    const status = normalizeAutomationStatus(req.body?.status);
    await query(
      'UPDATE sms_automations SET status = ? WHERE id = ? AND branch_id = ?',
      [status, id, branchId]
    );

    const [rows] = await query(
      `SELECT
          id,
          name,
          trigger_event AS triggerEvent,
          timing,
          channels,
          template_id AS templateId,
          message_text AS messageText,
          status,
          last_triggered_at AS lastTriggeredAt,
          created_at AS createdAt,
          updated_at AS updatedAt
       FROM sms_automations
       WHERE id = ? AND branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    if (!rows || !rows.length) {
      return res.status(404).json({ ok: false, error: 'Automation not found.' });
    }

    return res.json({
      ok: true,
      automation: mapAutomationRow(rows[0])
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/automations/:id', async (req, res, next) => {
  try {
    await ensureSmsSchema();
    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid automation id.' });
    }

    const [existingRows] = await query(
      `SELECT
          id,
          name,
          trigger_event AS triggerEvent,
          timing,
          channels,
          template_id AS templateId,
          message_text AS messageText,
          status
       FROM sms_automations
       WHERE id = ? AND branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    if (!existingRows || !existingRows.length) {
      return res.status(404).json({ ok: false, error: 'Automation not found.' });
    }

    const existing = existingRows[0];
    const name = hasOwn(req.body, 'name') ? toText(req.body?.name) : toText(existing.name);
    const triggerEvent = hasOwn(req.body, 'triggerEvent') || hasOwn(req.body, 'trigger')
      ? toText(req.body?.triggerEvent || req.body?.trigger)
      : toText(existing.triggerEvent);
    const timing = hasOwn(req.body, 'timing') ? toText(req.body?.timing) : toText(existing.timing || 'immediate');
    const channels = hasOwn(req.body, 'channels')
      ? normalizeAutomationChannels(req.body?.channels)
      : normalizeAutomationChannels(existing.channels || 'sms,email');
    const templateId = hasOwn(req.body, 'templateId') ? Number(req.body?.templateId) : Number(existing.templateId);
    const messageText = hasOwn(req.body, 'messageText') || hasOwn(req.body, 'message')
      ? toText(req.body?.messageText || req.body?.message)
      : toText(existing.messageText);
    const status = hasOwn(req.body, 'status')
      ? normalizeAutomationStatus(req.body?.status)
      : normalizeAutomationStatus(existing.status);

    if (!name) {
      return res.status(400).json({ ok: false, error: 'Automation name is required.' });
    }
    if (!triggerEvent) {
      return res.status(400).json({ ok: false, error: 'Trigger event is required.' });
    }
    if (!messageText) {
      return res.status(400).json({ ok: false, error: 'Message template is required.' });
    }
    if (!channels.length) {
      return res.status(400).json({ ok: false, error: 'At least one channel is required.' });
    }

    await query(
      `UPDATE sms_automations
       SET
          name = ?,
          trigger_event = ?,
          timing = ?,
          channels = ?,
          template_id = ?,
          message_text = ?,
          status = ?
       WHERE id = ? AND branch_id = ?`,
      [
        name,
        triggerEvent,
        timing,
        channels.join(','),
        Number.isInteger(templateId) && templateId > 0 ? templateId : null,
        messageText,
        status,
        id,
        branchId
      ]
    );

    const [rows] = await query(
      `SELECT
          id,
          name,
          trigger_event AS triggerEvent,
          timing,
          channels,
          template_id AS templateId,
          message_text AS messageText,
          status,
          last_triggered_at AS lastTriggeredAt,
          created_at AS createdAt,
          updated_at AS updatedAt
       FROM sms_automations
       WHERE id = ? AND branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    return res.json({
      ok: true,
      automation: rows && rows.length ? mapAutomationRow(rows[0]) : null
    });
  } catch (error) {
    if (String(error?.code || '').toUpperCase() === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, error: 'Automation name already exists in this branch.' });
    }
    return next(error);
  }
});

router.delete('/automations/:id', async (req, res, next) => {
  try {
    await ensureSmsSchema();
    const branchId = getBranchIdFromRequest(req);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch context is required.' });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid automation id.' });
    }

    const [result] = await query(
      'DELETE FROM sms_automations WHERE id = ? AND branch_id = ?',
      [id, branchId]
    );

    if (!result || !result.affectedRows) {
      return res.status(404).json({ ok: false, error: 'Automation not found.' });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
