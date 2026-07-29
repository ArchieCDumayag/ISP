const crypto = require('crypto');
const express = require('express');

const router = express.Router();

const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\//i;
const DEFAULT_GRAPH_API_VERSION = 'v25.0';
const MAX_REPLY_LENGTH = 1900;

const normalizeGraphApiVersion = (value) => {
  const version = String(value || '').trim().toLowerCase();
  if (!version) return DEFAULT_GRAPH_API_VERSION;
  return version.startsWith('v') ? version : `v${version}`;
};

const trimSlash = (value = '') => String(value || '').trim().replace(/\/+$/, '');

const isLocalhostUrl = (urlValue = '') => {
  try {
    const parsed = new URL(String(urlValue || '').trim());
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
};

const configuredBaseUrl = () => [
  process.env.MESSENGER_PUBLIC_BASE_URL,
  process.env.PUBLIC_BASE_URL,
  process.env.CENTRAL_URL,
  process.env.APP_BASE_URL
]
  .map((value) => trimSlash(value))
  .find((value) => ABSOLUTE_HTTP_URL_PATTERN.test(value) && !isLocalhostUrl(value));

const requestBaseUrl = (req) => {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (req.secure ? 'https' : req.protocol || 'http');
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host') || '';
  return host ? `${proto}://${host}` : '';
};

const getPortalUrl = (req) => {
  const explicit = trimSlash(process.env.MESSENGER_PORTAL_URL || '');
  if (ABSOLUTE_HTTP_URL_PATTERN.test(explicit)) return explicit;
  const baseUrl = configuredBaseUrl() || trimSlash(requestBaseUrl(req));
  if (!baseUrl) return '/customer-login.html';
  return `${baseUrl}/customer-login.html`;
};

const timingSafeEqualText = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const verifyRequestSignature = (req) => {
  const appSecret = String(process.env.MESSENGER_APP_SECRET || process.env.FACEBOOK_APP_SECRET || '').trim();
  if (!appSecret) return true;

  const signature = String(req.get('x-hub-signature-256') || '').trim();
  if (!signature.startsWith('sha256=')) return false;

  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  const digest = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex');

  return timingSafeEqualText(signature, `sha256=${digest}`);
};

const renderReplyText = (req) => {
  const portalUrl = getPortalUrl(req);
  const configuredReply = String(process.env.MESSENGER_AUTO_REPLY_TEXT || '').trim();
  const text = configuredReply
    ? configuredReply.replace(/\{portalUrl\}/g, portalUrl)
    : [
        'Hi! Para makita ang bill, balance, due date, payments, at e-statement mo, mag-login dito:',
        portalUrl,
        '',
        'Gamitin ang Client ID/Username o Account Number at password na ibinigay sa iyo.',
        '',
        'Reminder: Huwag isend dito ang password mo. Kung kailangan ng tulong, maghintay lang sa admin reply.'
      ].join('\n');

  return text.slice(0, MAX_REPLY_LENGTH);
};

const shouldReplyToEvent = (event = {}) => {
  if (!event || typeof event !== 'object') return false;
  if (event.message?.is_echo) return false;
  if (event.delivery || event.read) return false;
  return Boolean(event.sender?.id && (event.message || event.postback));
};

const extractMessagingEvents = (payload = {}) => {
  if (payload?.object !== 'page') return [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const events = [];
  entries.forEach((entry) => {
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    messaging.forEach((event) => {
      if (shouldReplyToEvent(event)) events.push(event);
    });
  });
  return events;
};

const sendMessengerText = async (recipientId, text) => {
  const pageAccessToken = String(process.env.MESSENGER_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '').trim();
  if (!pageAccessToken) {
    console.warn('[messenger-bot] MESSENGER_PAGE_ACCESS_TOKEN is not configured; skipped reply.');
    return { ok: false, skipped: true };
  }

  const graphVersion = normalizeGraphApiVersion(process.env.MESSENGER_GRAPH_API_VERSION);
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/me/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pageAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
      message: { text }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Messenger Send API failed with status ${response.status}.`;
    throw new Error(message);
  }
  return { ok: true, data };
};

const processWebhookPayload = async (req) => {
  const events = extractMessagingEvents(req.body || {});
  if (!events.length) return;

  const replyText = renderReplyText(req);
  const sends = events.map((event) => sendMessengerText(event.sender.id, replyText));
  const results = await Promise.allSettled(sends);
  results.forEach((result) => {
    if (result.status === 'rejected') {
      console.warn('[messenger-bot] Failed to send reply:', result.reason?.message || result.reason);
    }
  });
};

router.get('/', (req, res) => {
  const verifyToken = String(process.env.MESSENGER_VERIFY_TOKEN || '').trim();
  if (!verifyToken) {
    return res.status(503).send('Messenger verify token is not configured.');
  }

  const mode = String(req.query['hub.mode'] || '').trim();
  const token = String(req.query['hub.verify_token'] || '').trim();
  const challenge = String(req.query['hub.challenge'] || '');

  if (mode === 'subscribe' && timingSafeEqualText(token, verifyToken)) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

router.post('/', (req, res) => {
  if (!verifyRequestSignature(req)) {
    return res.sendStatus(403);
  }

  if (req.body?.object !== 'page') {
    return res.sendStatus(404);
  }

  res.sendStatus(200);

  setImmediate(() => {
    processWebhookPayload(req).catch((error) => {
      console.warn('[messenger-bot] Failed to process webhook:', error?.message || error);
    });
  });
});

module.exports = router;
