const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { PROJECT_ROOT } = require('../../../../core/runtime/paths');

const MAX_MULTICAST_TOKENS = 500;
const DEFAULT_ANDROID_CHANNEL_ID = String(process.env.FIREBASE_ANDROID_CHANNEL_ID || '').trim();

const CREDENTIAL_CANDIDATES = [
  path.join(PROJECT_ROOT, 'data', 'firebase-service-account.json'),
  path.join(PROJECT_ROOT, 'data', 'service-account.json'),
  path.join(PROJECT_ROOT, 'data', 'service-account.json.json'),
  path.join(PROJECT_ROOT, 'firebase-service-account.json'),
  path.join(PROJECT_ROOT, 'service-account.json')
];

let firebaseApp = null;

const toRelativePath = (filePath) => {
  if (!filePath) return '';
  const relative = path.relative(PROJECT_ROOT, filePath);
  return relative && !relative.startsWith('..') ? relative.replace(/\\/g, '/') : filePath;
};

const resolveCredentialPath = () => {
  const configuredPath = String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  if (configuredPath) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(PROJECT_ROOT, configuredPath);
  }
  return CREDENTIAL_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || '';
};

const loadServiceAccount = () => {
  const filePath = resolveCredentialPath();
  if (!filePath) {
    throw new Error('Firebase service account file was not found.');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Firebase service account file does not exist: ${toRelativePath(filePath)}`);
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read Firebase service account JSON: ${error.message || error}`);
  }

  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('Firebase service account is missing project_id, client_email, or private_key.');
  }

  return { filePath, serviceAccount };
};

const initializeFirebaseApp = () => {
  if (firebaseApp) return firebaseApp;
  if (admin.apps && admin.apps.length) {
    firebaseApp = admin.apps[0];
    return firebaseApp;
  }

  const { serviceAccount } = loadServiceAccount();
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  return firebaseApp;
};

const getPushStatus = () => {
  const filePath = resolveCredentialPath();
  const status = {
    configured: Boolean(filePath && fs.existsSync(filePath)),
    initialized: Boolean(firebaseApp || (admin.apps && admin.apps.length)),
    configPath: filePath ? toRelativePath(filePath) : '',
    projectId: '',
    clientEmail: '',
    error: ''
  };

  if (!filePath) {
    status.error = 'Firebase service account file was not found.';
    return status;
  }
  if (!fs.existsSync(filePath)) {
    status.error = `Firebase service account file does not exist: ${toRelativePath(filePath)}`;
    return status;
  }

  try {
    const serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    status.projectId = String(serviceAccount.project_id || '');
    status.clientEmail = String(serviceAccount.client_email || '');
    if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
      status.error = 'Firebase service account is missing project_id, client_email, or private_key.';
    }
  } catch (error) {
    status.error = `Unable to read Firebase service account JSON: ${error.message || error}`;
  }

  return status;
};

const normalizeDataPayload = (data = {}) => {
  const normalized = {};
  Object.entries(data || {}).forEach(([key, value]) => {
    const safeKey = String(key || '').trim();
    if (!safeKey || safeKey.startsWith('google.') || safeKey.startsWith('gcm.')) return;
    if (value === undefined || value === null) return;
    normalized[safeKey] = String(value);
  });
  return normalized;
};

const chunkEntries = (entries = [], size = MAX_MULTICAST_TOKENS) => {
  const chunks = [];
  for (let index = 0; index < entries.length; index += size) {
    chunks.push(entries.slice(index, index + size));
  }
  return chunks;
};

const isInvalidTokenError = (code) =>
  code === 'messaging/registration-token-not-registered' ||
  code === 'messaging/invalid-registration-token';

async function sendToFcmEntries(entries = [], notification = {}, options = {}) {
  const recipients = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && entry.enabled !== false && String(entry.token || '').trim());

  if (!recipients.length) {
    return {
      requestedCount: 0,
      successCount: 0,
      failureCount: 0,
      invalidTokenHashes: [],
      errors: []
    };
  }

  const title = String(notification.title || 'Billing Notification').trim().slice(0, 80) || 'Billing Notification';
  const body = String(notification.body || notification.message || '').trim().slice(0, 500);
  if (!body) {
    throw new Error('Notification message is required.');
  }

  const messaging = initializeFirebaseApp().messaging();
  const data = normalizeDataPayload(options.data || {});
  const errors = [];
  const invalidTokenHashes = [];
  const acceptedTokenHashes = [];
  const acceptedAccountNumbers = [];
  let successCount = 0;
  let failureCount = 0;

  for (const chunk of chunkEntries(recipients)) {
    const androidNotification = {
      sound: 'default'
    };
    const androidChannelId = String(options.androidChannelId || DEFAULT_ANDROID_CHANNEL_ID || '').trim();
    if (androidChannelId) {
      androidNotification.channelId = androidChannelId;
    }

    const message = {
      tokens: chunk.map((entry) => String(entry.token || '').trim()),
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        notification: androidNotification
      },
      apns: {
        payload: {
          aps: {
            sound: 'default'
          }
        }
      }
    };

    const response = await messaging.sendEachForMulticast(message);
    successCount += Number(response.successCount || 0);
    failureCount += Number(response.failureCount || 0);

    response.responses.forEach((item, index) => {
      const entry = chunk[index] || {};
      if (item.success) {
        if (entry.tokenHash) {
          acceptedTokenHashes.push(String(entry.tokenHash));
        }
        if (entry.accountNumber) {
          acceptedAccountNumbers.push(String(entry.accountNumber).trim());
        }
        return;
      }
      const code = String(item.error?.code || 'messaging/unknown-error');
      const messageText = String(item.error?.message || 'Firebase messaging failed.');
      if (isInvalidTokenError(code) && entry.tokenHash) {
        invalidTokenHashes.push(entry.tokenHash);
      }
      errors.push({
        tokenHash: entry.tokenHash || '',
        accountNumber: entry.accountNumber || '',
        code,
        message: messageText
      });
    });
  }

  return {
    requestedCount: recipients.length,
    successCount,
    failureCount,
    acceptedTokenHashes: Array.from(new Set(acceptedTokenHashes)),
    acceptedAccountNumbers: Array.from(new Set(acceptedAccountNumbers.filter(Boolean))),
    invalidTokenHashes: Array.from(new Set(invalidTokenHashes)),
    errors: errors.slice(0, 20)
  };
}

module.exports = {
  getPushStatus,
  sendToFcmEntries
};
