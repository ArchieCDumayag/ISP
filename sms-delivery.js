const nodemailer = require('nodemailer');
const { query } = require('./db');
const { loadIntegrationSettings } = require('./integration-settings');
const { accountHasRole } = require('./role-utils');

const SEMAPHORE_ENDPOINT = 'https://semaphore.co/api/v4/messages';
const STATUS_FAILED = 'failed';
const STATUS_SENT = 'sent';

const toText = (value) => String(value || '').trim();

const toSafeJsonText = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return toText(value);
  }
};

const normalizeDeliveryMethods = (value, { fallback = [] } = {}) => {
  const source = Array.isArray(value)
    ? value
    : toText(value)
      ? String(value).split(',')
      : fallback;
  const mapped = source
    .map((entry) => toText(entry).toLowerCase())
    .map((entry) => {
      if (entry === 'sms') return 'semaphore';
      if (entry === 'email') return 'mail';
      return entry;
    })
    .filter((entry) => entry === 'semaphore' || entry === 'mail');
  return Array.from(new Set(mapped));
};

const normalizeTemplateChannels = (value) => {
  const methods = normalizeDeliveryMethods(value, { fallback: ['semaphore'] });
  const channels = methods.map((method) => (method === 'semaphore' ? 'sms' : 'email'));
  return Array.from(new Set(channels));
};

const normalizeMobileForSms = (value) => {
  const raw = toText(value).replace(/[^\d+]/g, '');
  if (!raw) return '';

  let local = raw;
  if (local.startsWith('+63')) local = `0${local.slice(3)}`;
  if (local.startsWith('63')) local = `0${local.slice(2)}`;
  if (local.startsWith('9') && local.length === 10) local = `0${local}`;

  if (!/^09\d{9}$/.test(local)) return '';
  return local;
};

const normalizeEmail = (value) => {
  const email = toText(value).toLowerCase();
  if (!email) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
};

const normalizeRecipient = (entry) => {
  if (typeof entry === 'string') {
    const asMobile = normalizeMobileForSms(entry);
    const asEmail = normalizeEmail(entry);
    return {
      raw: entry,
      label: asMobile || asEmail || toText(entry),
      mobile: asMobile,
      email: asEmail,
      accountNumber: '',
      area: ''
    };
  }

  if (!entry || typeof entry !== 'object') {
    return {
      raw: entry,
      label: '',
      mobile: '',
      email: '',
      accountNumber: '',
      area: ''
    };
  }

  const mobile = normalizeMobileForSms(
    entry.mobile || entry.mobileRaw || entry.phone || entry.number || entry.recipient
  );
  const email = normalizeEmail(entry.email || entry.recipientEmail);
  return {
    raw: entry,
    label: toText(
      entry.label ||
      entry.name ||
      entry.recipient ||
      entry.mobile ||
      entry.mobileRaw ||
      entry.email
    ),
    mobile,
    email,
    accountNumber: toText(entry.accountNumber || entry.account || entry.customerAccountNumber),
    area: toText(entry.area || entry.recipientArea)
  };
};

const resolveRecipients = (payloadRecipients, deliveryMethods = []) => {
  const source = Array.isArray(payloadRecipients) ? payloadRecipients : [];
  const methods = normalizeDeliveryMethods(deliveryMethods);
  const invalid = [];
  const dedupe = new Set();
  const valid = [];

  source.forEach((entry) => {
    const normalized = normalizeRecipient(entry);
    const requiresSms = methods.includes('semaphore');
    const requiresMail = methods.includes('mail');
    const hasSmsTarget = Boolean(normalized.mobile);
    const hasMailTarget = Boolean(normalized.email);
    const hasAnyTarget = hasSmsTarget || hasMailTarget;

    const missingForSelected =
      (requiresSms && !hasSmsTarget) ||
      (requiresMail && !hasMailTarget);
    if (!hasAnyTarget || missingForSelected) {
      invalid.push({
        recipient: toText(normalized.label || normalized.raw),
        reason: 'Missing required contact details for selected delivery methods.'
      });
      return;
    }

    const dedupeKey = `${normalized.mobile}|${normalized.email}`.toLowerCase();
    if (dedupe.has(dedupeKey)) return;
    dedupe.add(dedupeKey);
    valid.push(normalized);
  });

  return { valid, invalid };
};

const mapSemaphoreStatus = (value) => {
  const normalized = toText(value).toLowerCase();
  if (!normalized) return STATUS_SENT;
  if (normalized.includes('fail') || normalized.includes('reject')) return STATUS_FAILED;
  if (normalized.includes('deliver')) return 'delivered';
  if (normalized.includes('queue') || normalized.includes('pend')) return 'queued';
  if (normalized.includes('send') || normalized.includes('success') || normalized.includes('ok')) return STATUS_SENT;
  return STATUS_SENT;
};

const withTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    done: () => clearTimeout(timer)
  };
};

const sendViaSemaphore = async ({ apiKey, senderName, recipient, message }) => {
  const params = new URLSearchParams();
  params.set('apikey', apiKey);
  params.set('number', recipient);
  params.set('message', message);
  if (senderName) params.set('sendername', senderName);

  const timeout = withTimeoutSignal(12000);
  let response;
  try {
    response = await fetch(SEMAPHORE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: timeout.signal
    });
  } finally {
    timeout.done();
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const details = Array.isArray(payload)
      ? payload.map((item) => toText(item?.message || item?.status)).filter(Boolean).join('; ')
      : toText(payload?.message || payload);
    const suffix = details ? ` ${details}` : '';
    throw new Error(`Semaphore request failed (${response.status}).${suffix}`);
  }

  const first = Array.isArray(payload) ? payload[0] : payload;
  return {
    messageId: toText(first?.message_id || first?.id),
    status: mapSemaphoreStatus(first?.status || first?.message),
    raw: payload
  };
};

const sendViaSmtp = async ({ smtpSettings, recipient, subject, message }) => {
  const host = toText(smtpSettings?.host);
  const username = toText(smtpSettings?.username);
  const password = smtpSettings?.password != null ? String(smtpSettings.password) : '';
  const fromEmail = toText(smtpSettings?.fromEmail);
  const fromName = toText(smtpSettings?.fromName);
  const port = Number(smtpSettings?.port || 0);
  const secure = smtpSettings?.secure === true || String(smtpSettings?.secure).toLowerCase() === 'true';

  if (!host || !username || !password || !fromEmail) {
    throw new Error('Email SMTP settings are incomplete. Configure host, username, password, and fromEmail.');
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number.isInteger(port) && port > 0 ? port : (secure ? 465 : 587),
    secure,
    auth: {
      user: username,
      pass: password
    }
  });

  const info = await transporter.sendMail({
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
    to: recipient,
    subject: toText(subject) || 'Billing Notification',
    text: message
  });

  return {
    messageId: toText(info?.messageId),
    status: STATUS_SENT,
    raw: info
  };
};

const resolveAuditUser = (user) => {
  const userId = toText(user?.id);
  const username = toText(user?.username);
  if (!accountHasRole(user, 'Admin') || !userId) {
    return { userId: '', username };
  }
  return { userId, username };
};

const logSmsMessage = async (entry) => {
  await query(
    `INSERT INTO sms_messages (
      branch_id, schedule_id, provider, recipient, recipient_label, customer_account_number, recipient_area,
      sender_name, message_text, status, provider_message_id, provider_response, error_message,
      created_by_user_id, created_by_username
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.branchId,
      entry.scheduleId || null,
      entry.provider || 'semaphore',
      entry.recipient,
      entry.recipientLabel || null,
      entry.accountNumber || null,
      entry.area || null,
      entry.senderName || null,
      entry.message,
      entry.status,
      entry.providerMessageId || null,
      entry.providerResponse || null,
      entry.errorMessage || null,
      entry.userId || null,
      entry.username || null
    ]
  );
};

const dispatchMessageToRecipients = async ({
  branchId,
  recipients,
  message,
  deliveryMethods,
  user = null,
  scheduleId = null,
  subject = ''
}) => {
  const methods = normalizeDeliveryMethods(deliveryMethods, { fallback: ['semaphore'] });
  if (!methods.length) {
    throw new Error('At least one delivery method is required.');
  }

  const settings = await loadIntegrationSettings(branchId);
  const semaphoreApiKey = toText(settings?.semaphore?.apiKey);
  const semaphoreSenderName = toText(settings?.semaphore?.senderName);
  const smtpSettings = settings?.email || {};
  const auditUser = resolveAuditUser(user);
  const normalizedRecipients = Array.isArray(recipients) ? recipients.map(normalizeRecipient) : [];

  const results = [];
  for (const recipient of normalizedRecipients) {
    for (const method of methods) {
      const baseResult = {
        recipient: recipient.label || recipient.mobile || recipient.email || '-',
        recipientNumber: recipient.mobile || '',
        recipientEmail: recipient.email || '',
        accountNumber: recipient.accountNumber || '',
        area: recipient.area || '',
        deliveryMethod: method,
        provider: method === 'semaphore' ? 'semaphore' : 'smtp',
        status: STATUS_FAILED,
        providerMessageId: '',
        error: ''
      };

      try {
        if (method === 'semaphore') {
          if (!recipient.mobile) {
            throw new Error('Recipient mobile number is missing for SMS.');
          }
          if (!semaphoreApiKey) {
            throw new Error('Semaphore API key is not configured.');
          }
          const sent = await sendViaSemaphore({
            apiKey: semaphoreApiKey,
            senderName: semaphoreSenderName,
            recipient: recipient.mobile,
            message
          });
          baseResult.status = sent.status || STATUS_SENT;
          baseResult.providerMessageId = sent.messageId || '';
          await logSmsMessage({
            branchId,
            scheduleId,
            provider: 'semaphore',
            recipient: recipient.mobile,
            recipientLabel: baseResult.recipient,
            accountNumber: recipient.accountNumber,
            area: recipient.area,
            senderName: semaphoreSenderName,
            message,
            status: baseResult.status,
            providerMessageId: sent.messageId,
            providerResponse: toSafeJsonText(sent.raw),
            errorMessage: '',
            userId: auditUser.userId,
            username: auditUser.username
          });
        } else {
          if (!recipient.email) {
            throw new Error('Recipient email is missing for email delivery.');
          }
          const sent = await sendViaSmtp({
            smtpSettings,
            recipient: recipient.email,
            subject,
            message
          });
          baseResult.status = sent.status || STATUS_SENT;
          baseResult.providerMessageId = sent.messageId || '';
          await logSmsMessage({
            branchId,
            scheduleId,
            provider: 'smtp',
            recipient: recipient.email,
            recipientLabel: baseResult.recipient,
            accountNumber: recipient.accountNumber,
            area: recipient.area,
            senderName: toText(smtpSettings?.fromName || smtpSettings?.fromEmail),
            message,
            status: baseResult.status,
            providerMessageId: sent.messageId,
            providerResponse: toSafeJsonText(sent.raw),
            errorMessage: '',
            userId: auditUser.userId,
            username: auditUser.username
          });
        }
      } catch (error) {
        const errorMessage = toText(error?.message || 'Delivery failed.');
        baseResult.status = STATUS_FAILED;
        baseResult.error = errorMessage;
        await logSmsMessage({
          branchId,
          scheduleId,
          provider: baseResult.provider,
          recipient: method === 'semaphore' ? (recipient.mobile || baseResult.recipient) : (recipient.email || baseResult.recipient),
          recipientLabel: baseResult.recipient,
          accountNumber: recipient.accountNumber,
          area: recipient.area,
          senderName: method === 'semaphore'
            ? semaphoreSenderName
            : toText(smtpSettings?.fromName || smtpSettings?.fromEmail),
          message,
          status: STATUS_FAILED,
          providerMessageId: '',
          providerResponse: '',
          errorMessage,
          userId: auditUser.userId,
          username: auditUser.username
        });
      }

      results.push(baseResult);
    }
  }

  const sent = results.filter((item) => item.status !== STATUS_FAILED).length;
  const failed = results.length - sent;
  return { results, sent, failed };
};

module.exports = {
  STATUS_FAILED,
  STATUS_SENT,
  toText,
  normalizeDeliveryMethods,
  normalizeTemplateChannels,
  normalizeMobileForSms,
  normalizeEmail,
  normalizeRecipient,
  resolveRecipients,
  resolveAuditUser,
  sendViaSemaphore,
  sendViaSmtp,
  logSmsMessage,
  dispatchMessageToRecipients
};
