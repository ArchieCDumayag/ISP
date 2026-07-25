const { query } = require('./db');
const { assertRelationalReady } = require('./db-relational');
const { ensureSmsSchema } = require('./sms-schema');
const { isJsonStorageMode } = require('./storage-mode');
const { toText, normalizeDeliveryMethods, normalizeMobileForSms, normalizeEmail, dispatchMessageToRecipients } = require('./sms-delivery');

const DEFAULT_TICK_MS = Number.parseInt(process.env.SMS_SCHEDULER_TICK_MS || '60000', 10) || 60000;
const LOCK_KEY = 'billing_system_sms_scheduler_lock';
const SECONDS = 1000;
const MINUTES = 60 * SECONDS;
const HOURS = 60 * MINUTES;
const DAYS = 24 * HOURS;

let runnerInterval = null;
let tickRunning = false;

const pad2 = (value) => String(value).padStart(2, '0');

const toMySqlDateTime = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

const parseMysqlDateAsUtc = (value) => {
  const raw = toText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return new Date(raw.replace(' ', 'T') + 'Z');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00Z`);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const firstDayOfMonthUtc = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0));

const addMonthsUtc = (date, monthsToAdd) =>
  new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + Number(monthsToAdd || 0),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds()
  ));

const getLastDayOfMonth = (year, monthIndex) => {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 0, 0, 0)).getUTCDate();
};

const normalizeScheduleMode = (value) => {
  const mode = toText(value).toLowerCase();
  if (mode === 'billing-date') return 'billing-date';
  if (mode === 'due-date') return 'due-date';
  return 'custom';
};

const normalizeRepeatMode = (value) => {
  const mode = toText(value).toLowerCase();
  if (mode === 'twice') return 'twice';
  if (mode === 'more') return 'more';
  if (mode === 'every-month') return 'every-month';
  return 'once';
};

const getRepeatLimit = (repeatMode, repeatCount) => {
  const mode = normalizeRepeatMode(repeatMode);
  if (mode === 'every-month') return Number.POSITIVE_INFINITY;
  if (mode === 'twice') return 2;
  if (mode === 'more') return Math.max(3, Number.parseInt(repeatCount || '3', 10) || 3);
  return 1;
};

const parseScheduleDueTime = (value) => {
  const raw = toText(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hour: 9, minute: 0 };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return { hour: 9, minute: 0 };
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return { hour: 9, minute: 0 };
  return { hour, minute };
};

const parseDayFromCycleDate = (value) => {
  const raw = toText(value);
  if (!raw) return null;
  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= 31) return asNumber;
  const parsed = parseMysqlDateAsUtc(raw);
  if (!parsed) return null;
  return parsed.getUTCDate();
};

const getCustomerLabel = (customer) => {
  const name = toText(customer?.name);
  if (name) return name;
  const first = toText(customer?.firstName);
  const last = toText(customer?.lastName);
  const full = `${first} ${last}`.trim();
  if (full) return full;
  return toText(customer?.accountNumber || customer?.mobile || customer?.email || 'Subscriber');
};

const parseRecipientValue = (value) => {
  const parsed = typeof value === 'string' ? (() => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  })() : value;
  if (Array.isArray(parsed)) return parsed;
  if (parsed == null) return [];
  return [parsed];
};

const keyByAccount = (customers) => {
  const map = new Map();
  (customers || []).forEach((customer) => {
    const key = toText(customer.accountNumber);
    if (!key) return;
    map.set(key, customer);
  });
  return map;
};

const buildRecipientsFromSchedule = (schedule, customers) => {
  const recipientType = toText(schedule.recipientType).toLowerCase() === 'area' ? 'area' : 'subscriber';
  const recipientValue = parseRecipientValue(schedule.recipientValue);
  const byAccount = keyByAccount(customers);

  if (recipientType === 'area') {
    const areaNames = recipientValue
      .map((entry) => {
        if (entry && typeof entry === 'object') return toText(entry.name || entry.area || entry.id);
        return toText(entry);
      })
      .map((entry) => entry.toLowerCase())
      .filter(Boolean);

    if (!areaNames.length) return [];
    return (customers || [])
      .filter((customer) => areaNames.includes(toText(customer.area).toLowerCase()))
      .map((customer) => ({
        label: getCustomerLabel(customer),
        accountNumber: toText(customer.accountNumber),
        mobile: normalizeMobileForSms(customer.mobileRaw || customer.mobile),
        email: normalizeEmail(customer.email),
        area: toText(customer.area)
      }));
  }

  const recipients = [];
  const dedupe = new Set();

  recipientValue.forEach((entry) => {
    const payload = entry && typeof entry === 'object' ? entry : { accountNumber: entry };
    const accountNumber = toText(payload.accountNumber || payload.account);
    const customer = accountNumber ? byAccount.get(accountNumber) : null;

    const resolved = {
      label: toText(payload.label) || (customer ? getCustomerLabel(customer) : ''),
      accountNumber: accountNumber || toText(customer?.accountNumber),
      mobile: normalizeMobileForSms(
        payload.mobile ||
        payload.mobileRaw ||
        customer?.mobileRaw ||
        customer?.mobile
      ),
      email: normalizeEmail(payload.email || customer?.email),
      area: toText(payload.area || customer?.area)
    };
    if (!resolved.label) {
      resolved.label = resolved.accountNumber || resolved.mobile || resolved.email || 'Subscriber';
    }
    const dedupeKey = `${resolved.accountNumber}|${resolved.mobile}|${resolved.email}`.toLowerCase();
    if (!dedupeKey.replace(/\|/g, '')) return;
    if (dedupe.has(dedupeKey)) return;
    dedupe.add(dedupeKey);
    recipients.push(resolved);
  });

  return recipients;
};

const getDueCycleDateForCustomer = ({ customer, scheduleMode, cycleStart, scheduleDueTime, scheduleDelayDays }) => {
  const day = scheduleMode === 'billing-date'
    ? parseDayFromCycleDate(customer.billDate)
    : parseDayFromCycleDate(customer.dueDate);
  if (!day) return null;

  const year = cycleStart.getUTCFullYear();
  const month = cycleStart.getUTCMonth();
  const lastDay = getLastDayOfMonth(year, month);
  const clampedDay = Math.min(day, lastDay);
  const target = new Date(Date.UTC(year, month, clampedDay, scheduleDueTime.hour, scheduleDueTime.minute, 0));
  const offsetDays = Math.max(0, Number.parseInt(scheduleDelayDays || '0', 10) || 0);
  return new Date(target.getTime() + (offsetDays * DAYS));
};

const readScheduleLogsForCycle = async ({ scheduleId, cycleStart, cycleEnd }) => {
  const [rows] = await query(
    `SELECT
        provider,
        recipient,
        customer_account_number AS accountNumber
     FROM sms_messages
     WHERE schedule_id = ?
       AND created_at >= ?
       AND created_at < ?`,
    [scheduleId, toMySqlDateTime(cycleStart), toMySqlDateTime(cycleEnd)]
  );

  const sentSet = new Set();
  (rows || []).forEach((row) => {
    const account = toText(row.accountNumber);
    const recipient = toText(row.recipient);
    const provider = toText(row.provider).toLowerCase();
    sentSet.add(`${account}|${provider}`);
    sentSet.add(`${recipient}|${provider}`);
  });
  return sentSet;
};

const readBranchCustomers = async (branchId) => {
  const [rows] = await query(
    `SELECT
        account_number AS accountNumber,
        first_name AS firstName,
        last_name AS lastName,
        name,
        mobile_raw AS mobileRaw,
        mobile,
        email,
        area,
        bill_date AS billDate,
        due_date AS dueDate
     FROM customers
     WHERE branch_id = ?`,
    [branchId]
  );
  return rows || [];
};

const completeIfDone = async (schedule, nextRunCount, now) => {
  const limit = getRepeatLimit(schedule.repeatMode, schedule.repeatCount);
  const completed = Number.isFinite(limit) && nextRunCount >= limit;
  if (!completed) return false;
  await query(
    'UPDATE sms_schedules SET run_count = ?, status = ?, last_executed_at = ? WHERE id = ? AND branch_id = ?',
    [nextRunCount, 'completed', toMySqlDateTime(now), schedule.id, schedule.branchId]
  );
  return true;
};

const processCustomSchedule = async (schedule, now, recipients) => {
  const baseTime = parseMysqlDateAsUtc(schedule.scheduleTime);
  if (!baseTime) return;

  const runCount = Number.parseInt(schedule.runCount || '0', 10) || 0;
  const limit = getRepeatLimit(schedule.repeatMode, schedule.repeatCount);
  if (Number.isFinite(limit) && runCount >= limit) {
    await query(
      'UPDATE sms_schedules SET status = ? WHERE id = ? AND branch_id = ?',
      ['completed', schedule.id, schedule.branchId]
    );
    return;
  }

  const cycleTarget = addMonthsUtc(baseTime, runCount);
  if (now < cycleTarget) return;

  const methods = normalizeDeliveryMethods(schedule.deliveryMethods, { fallback: ['semaphore'] });
  const dueRecipients = recipients.filter((entry) => entry.mobile || entry.email);
  if (dueRecipients.length && methods.length) {
    await dispatchMessageToRecipients({
      branchId: schedule.branchId,
      recipients: dueRecipients,
      message: schedule.messageText,
      deliveryMethods: methods,
      user: { id: schedule.createdByUserId || '', username: 'System', role: 'admin' },
      scheduleId: schedule.id,
      subject: schedule.title
    });
  }

  const nextRunCount = runCount + 1;
  const completed = await completeIfDone(schedule, nextRunCount, now);
  if (!completed) {
    await query(
      'UPDATE sms_schedules SET run_count = ?, last_executed_at = ? WHERE id = ? AND branch_id = ?',
      [nextRunCount, toMySqlDateTime(now), schedule.id, schedule.branchId]
    );
  }
};

const processBillingOrDueSchedule = async (schedule, now, customers) => {
  const runCount = Number.parseInt(schedule.runCount || '0', 10) || 0;
  const limit = getRepeatLimit(schedule.repeatMode, schedule.repeatCount);
  if (Number.isFinite(limit) && runCount >= limit) {
    await query(
      'UPDATE sms_schedules SET status = ? WHERE id = ? AND branch_id = ?',
      ['completed', schedule.id, schedule.branchId]
    );
    return;
  }

  const createdAt = parseMysqlDateAsUtc(schedule.createdAt) || now;
  const baseCycleStart = firstDayOfMonthUtc(createdAt);
  const cycleStart = addMonthsUtc(baseCycleStart, runCount);
  const cycleEnd = addMonthsUtc(cycleStart, 1);
  if (now < cycleStart) return;

  if (now >= cycleEnd) {
    const nextRunCount = runCount + 1;
    const completed = await completeIfDone(schedule, nextRunCount, now);
    if (!completed) {
      await query(
        'UPDATE sms_schedules SET run_count = ?, last_executed_at = ? WHERE id = ? AND branch_id = ?',
        [nextRunCount, toMySqlDateTime(now), schedule.id, schedule.branchId]
      );
    }
    return;
  }

  const methods = normalizeDeliveryMethods(schedule.deliveryMethods, { fallback: ['semaphore'] });
  if (!methods.length) return;

  const recipients = buildRecipientsFromSchedule(schedule, customers);
  if (!recipients.length) return;

  const dueTime = parseScheduleDueTime(schedule.scheduleDueTime);
  const sentSet = await readScheduleLogsForCycle({ scheduleId: schedule.id, cycleStart, cycleEnd });
  const mode = normalizeScheduleMode(schedule.scheduleMode);
  let sentAny = false;

  for (const recipient of recipients) {
    const customer = customers.find((item) => toText(item.accountNumber) === toText(recipient.accountNumber));
    if (!customer) continue;
    const targetAt = getDueCycleDateForCustomer({
      customer,
      scheduleMode: mode,
      cycleStart,
      scheduleDueTime: dueTime,
      scheduleDelayDays: schedule.scheduleDelayDays
    });
    if (!targetAt || now < targetAt) continue;

    const methodSubset = methods.filter((method) => {
      const provider = method === 'semaphore' ? 'semaphore' : 'smtp';
      const keyByAccountName = `${toText(recipient.accountNumber)}|${provider}`;
      const keyByRecipient = `${toText(method === 'semaphore' ? recipient.mobile : recipient.email)}|${provider}`;
      return !(sentSet.has(keyByAccountName) || sentSet.has(keyByRecipient));
    });
    if (!methodSubset.length) continue;

    const validRecipient = {
      ...recipient,
      mobile: normalizeMobileForSms(recipient.mobile),
      email: normalizeEmail(recipient.email)
    };
    await dispatchMessageToRecipients({
      branchId: schedule.branchId,
      recipients: [validRecipient],
      message: schedule.messageText,
      deliveryMethods: methodSubset,
      user: { id: schedule.createdByUserId || '', username: 'System', role: 'admin' },
      scheduleId: schedule.id,
      subject: schedule.title
    });
    sentAny = true;
  }

  if (sentAny) {
    await query(
      'UPDATE sms_schedules SET last_executed_at = ? WHERE id = ? AND branch_id = ?',
      [toMySqlDateTime(now), schedule.id, schedule.branchId]
    );
  }
};

const processSchedule = async (scheduleRow, now) => {
  const schedule = {
    id: Number(scheduleRow.id),
    branchId: Number(scheduleRow.branchId),
    title: toText(scheduleRow.title),
    recipientType: toText(scheduleRow.recipientType || 'subscriber'),
    recipientValue: scheduleRow.recipientValue,
    messageText: toText(scheduleRow.messageText),
    deliveryMethods: scheduleRow.deliveryMethods,
    scheduleMode: normalizeScheduleMode(scheduleRow.scheduleMode),
    scheduleTime: scheduleRow.scheduleTime,
    scheduleDueTime: toText(scheduleRow.scheduleDueTime),
    scheduleDelayDays: Number.parseInt(scheduleRow.scheduleDelayDays || '0', 10) || 0,
    repeatMode: normalizeRepeatMode(scheduleRow.repeatMode),
    repeatCount: Number.parseInt(scheduleRow.repeatCount || '0', 10) || 0,
    runCount: Number.parseInt(scheduleRow.runCount || '0', 10) || 0,
    status: toText(scheduleRow.status || 'active'),
    createdByUserId: toText(scheduleRow.createdByUserId),
    createdAt: scheduleRow.createdAt
  };

  const customers = await readBranchCustomers(schedule.branchId);
  const recipients = buildRecipientsFromSchedule(schedule, customers);
  if (schedule.scheduleMode === 'custom') {
    await processCustomSchedule(schedule, now, recipients);
    return;
  }
  await processBillingOrDueSchedule(schedule, now, customers);
};

const runSmsSchedulesUnsafe = async () => {
  await ensureSmsSchema();
  const now = new Date();

  const [rows] = await query(
    `SELECT
        id,
        branch_id AS branchId,
        title,
        recipient_type AS recipientType,
        recipient_value AS recipientValue,
        message_text AS messageText,
        delivery_methods AS deliveryMethods,
        schedule_mode AS scheduleMode,
        schedule_time AS scheduleTime,
        schedule_due_time AS scheduleDueTime,
        schedule_delay_days AS scheduleDelayDays,
        repeat_mode AS repeatMode,
        repeat_count AS repeatCount,
        run_count AS runCount,
        status,
        created_by_user_id AS createdByUserId,
        created_at AS createdAt
     FROM sms_schedules
     WHERE status = 'active'
     ORDER BY id ASC`
  );

  for (const schedule of rows || []) {
    try {
      await processSchedule(schedule, now);
    } catch (error) {
      console.warn(`SMS scheduler failed for schedule ${schedule.id}:`, error?.message || error);
    }
  }
};

const runSmsSchedulesOnce = async () => {
  if (isJsonStorageMode()) return false;
  if (tickRunning) return false;
  tickRunning = true;
  try {
    await assertRelationalReady();

    const [lockRows] = await query('SELECT GET_LOCK(?, 1) AS locked', [LOCK_KEY]);
    const locked = Number(lockRows?.[0]?.locked || 0) === 1;
    if (!locked) return false;

    try {
      await runSmsSchedulesUnsafe();
      return true;
    } finally {
      await query('SELECT RELEASE_LOCK(?)', [LOCK_KEY]).catch(() => {});
    }
  } finally {
    tickRunning = false;
  }
};

const scheduleSmsRunner = () => {
  if (isJsonStorageMode()) return null;
  if (runnerInterval) return runnerInterval;
  runSmsSchedulesOnce().catch((error) => {
    console.warn('Initial SMS scheduler run failed:', error?.message || error);
  });
  runnerInterval = setInterval(() => {
    runSmsSchedulesOnce().catch((error) => {
      console.warn('SMS scheduler tick failed:', error?.message || error);
    });
  }, DEFAULT_TICK_MS);
  return runnerInterval;
};

module.exports = {
  scheduleSmsRunner,
  runSmsSchedulesOnce
};
