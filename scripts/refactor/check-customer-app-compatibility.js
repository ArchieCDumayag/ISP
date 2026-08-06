#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
require(path.join(projectRoot, 'core/config/env-loader'));

const { loadModuleBackend, getModuleWebRoot } = require(path.join(
  projectRoot,
  'core/runtime/module-loader'
));

const backendPairs = [
  ['customer-app-api.js', 'customer-app-api'],
  ['customer-fcm-tokens.js', 'customer-fcm-tokens'],
  ['customer-notification-inbox.js', 'customer-notification-inbox'],
  ['customer-upstream.js', 'customer-upstream'],
  ['firebase-push.js', 'firebase-push'],
  ['messenger-bot.js', 'messenger-bot'],
  ['messenger-reminders.js', 'messenger-reminders'],
  ['sms-delivery.js', 'sms-delivery'],
  ['sms-scheduler.js', 'sms-scheduler'],
  ['sms-schema.js', 'sms-schema'],
  ['sms.js', 'sms']
];

const backend = loadModuleBackend('customer-app', { required: true, fresh: true });
assert.strictEqual(backend.id, 'customer-app');
assert.strictEqual(typeof backend.load, 'function');
assert.strictEqual(Object.keys(backend.entries).length, backendPairs.length);

backendPairs.forEach(([legacyFile, canonicalName]) => {
  const legacyPath = path.join(projectRoot, legacyFile);
  const canonicalPath = path.join(projectRoot, 'Features/modules/customer-app/backend', canonicalName);
  assert(!fs.existsSync(legacyPath), `Obsolete root entry must be removed: ${legacyFile}`);
  assert(fs.existsSync(`${canonicalPath}.js`), `Missing Customer App backend: ${canonicalName}.js`);
  require(canonicalPath);
  console.log(`PASS retired Customer App root entry ${legacyFile}`);
});

const webRoot = getModuleWebRoot('customer-app', { required: true });
const webFiles = [
  'company-info.html',
  'customer-app-popup-reminder.html',
  'customer-app.html',
  'customer-login.html',
  'customer-portal.html',
  'messenger-reminders.html',
  'privacy-terms.html',
  'sms.html',
  'sms.js',
  'terms-of-use.html',
  'css/customer-app.css',
  'css/customer-portal.css',
  'css/messenger-reminders.css',
  'css/public-pages.css',
  'css/sms.css',
  'css/sms.js',
  'js/company-info.js',
  'js/customer-app-popup-reminder.js',
  'js/messenger-reminders.js',
  'js/customer-portal-login.js',
  'js/customer-portal.js'
];

webFiles.forEach((relativePath) => {
  assert(fs.existsSync(path.join(webRoot, relativePath)), `Missing Customer App web asset: ${relativePath}`);
  assert(
    !fs.existsSync(path.join(projectRoot, 'public', relativePath)),
    `Legacy Customer App web asset must be removed: public/${relativePath}`
  );
});
console.log(`PASS Customer App web root (${webFiles.length} files)`);

const messengerPageSource = fs.readFileSync(path.join(webRoot, 'messenger-reminders.html'), 'utf8');
const messengerPageScript = fs.readFileSync(path.join(webRoot, 'js/messenger-reminders.js'), 'utf8');
assert(messengerPageSource.includes('id="generateQueueBtn"'));
assert(messengerPageSource.includes('id="businessInboxBtn"'));
assert(messengerPageSource.includes('id="consentAllowedInput"'));
assert(messengerPageSource.includes('id="markSentBtn"'));
assert(messengerPageScript.includes("const API_BASE = '/api/messenger-reminders'"));
assert(messengerPageScript.includes("data-action=\"setup\""));
assert(!messengerPageScript.includes('graph.facebook.com'));
console.log('PASS manual Messenger reminder queue UI and no browser-side Meta delivery');

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(serverSource.includes('const MODULE_RUNTIMES = loadModuleRuntimes({'));
assert(serverSource.includes("requireModuleRuntime('customer-app')"));
assert(serverSource.includes("customerAppBackend.load('sms')"));
assert(serverSource.includes("customerAppBackend.load('smsScheduler')"));
assert(serverSource.includes("customerAppBackend.load('customerAppApi')"));
assert(serverSource.includes("customerAppBackend.load('messengerBot')"));
assert(serverSource.includes("customerAppBackend.load('messengerReminders')"));
assert(serverSource.includes("customerAppBackend.load('customerUpstream')"));
assert(serverSource.includes('CUSTOMER_APP_WEB_ROOT'));
assert(serverSource.includes("app.use('/webhooks/messenger', messengerBotRouter)"));
assert(serverSource.includes("app.use('/api/customer-app'"));
assert(serverSource.includes("app.use('/api/messenger-reminders'"));
assert(serverSource.includes("requireMessengerReminderAccess, requireFeature('customerAppPopupReminder'), messengerRemindersRouter"));
assert(serverSource.includes("accountHasRole(sessionUser, 'Collector')"));
assert(serverSource.includes("app.use('/api/sms'"));
assert(serverSource.includes('startCustomerUpstream();'));
assert(serverSource.includes('scheduleSmsRunner();'));
assert(!serverSource.includes("path.join(__dirname, 'public', 'customer-login.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'customer-app-popup-reminder.html')"));
console.log('PASS Customer App server loader, page/API wiring, webhook, upstream, and schedulers');

const sourceChecks = [
  ['Features/modules/customer-app/backend/customer-app-api.js', '../../../../core/data/data-store'],
  ['Features/modules/customer-app/backend/customer-app-api.js', '../../customer-management/backend/customers'],
  ['Features/modules/customer-app/backend/customer-fcm-tokens.js', '../../../../core/data/data-store'],
  ['Features/modules/customer-app/backend/customer-notification-inbox.js', '../../../../core/data/data-store'],
  ['Features/modules/customer-app/backend/customer-upstream.js', '../../../../core/security/passwords'],
  ['Features/modules/customer-app/backend/customer-upstream.js', '../../customer-management/backend/customers'],
  ['Features/modules/customer-app/backend/firebase-push.js', '../../../../core/runtime/paths'],
  ['Features/modules/customer-app/backend/firebase-push.js', "path.join(PROJECT_ROOT, 'data'"],
  ['Features/modules/customer-app/backend/messenger-reminders.js', '../../billing/backend/payment-records'],
  ['Features/modules/customer-app/backend/messenger-reminders.js', '../../../../core/data/data-store'],
  ['Features/modules/customer-app/backend/messenger-reminders.js', '../../../../core/security/role-utils'],
  ['Features/modules/customer-app/backend/sms-delivery.js', '../../admin/backend/integration-settings'],
  ['Features/modules/customer-app/backend/sms-delivery.js', '../../../../core/security/role-utils'],
  ['Features/modules/customer-app/backend/sms-scheduler.js', '../../../../core/data/db-relational'],
  ['Features/modules/customer-app/backend/sms-scheduler.js', '../../../../core/config/storage-mode'],
  ['Features/modules/customer-app/backend/sms-schema.js', '../../../../core/data/db'],
  ['Features/modules/customer-app/backend/sms.js', '../../../../core/config/storage-mode'],
  ['Features/modules/customer-management/backend/customers.js', '../../customer-app/backend/customer-fcm-tokens'],
  [
    'Features/modules/customer-management/backend/customers.js',
    '../../customer-app/backend/customer-notification-inbox'
  ]
];
sourceChecks.forEach(([relativePath, expectedPath]) => {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  assert(source.includes(expectedPath), `${relativePath} must use canonical dependency ${expectedPath}`);
});
console.log('PASS canonical Core, Admin, Customer Management, and Customer-App-to-Customer dependencies');

const routeContracts = (router) => router.stack
  .filter((layer) => layer.route)
  .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);

const customerAppApi = backend.load('customerAppApi');
assert.strictEqual(typeof customerAppApi.router, 'function');
assert.strictEqual(typeof customerAppApi.publicRouter, 'function');
assert.strictEqual(typeof customerAppApi.schedulePushScheduler, 'function');
assert.strictEqual(typeof customerAppApi.runPushSchedulerOnce, 'function');
assert.deepStrictEqual(routeContracts(customerAppApi.publicRouter), [
  'GET /popup-reminder',
  'GET /notifications',
  'POST /notifications/read-all',
  'POST /notifications/:id/read',
  'POST /fcm-token',
  'DELETE /fcm-token'
]);

const fcmTokens = backend.load('customerFcmTokens');
assert.strictEqual(fcmTokens.getRequestFcmToken({ fcmToken: ' token-value ' }), 'token-value');
assert.strictEqual(fcmTokens.getRequestDeviceId({ deviceId: ' device-1 ' }), 'device-1');
const deduped = fcmTokens.dedupeFcmTokenEntriesForDelivery([
  {
    token: 'old-token', tokenHash: 'old', accountNumber: '100001', deviceId: 'device-1', updatedAt: '2026-01-01'
  },
  {
    token: 'new-token', tokenHash: 'new', accountNumber: '100001', deviceId: 'device-1', updatedAt: '2026-02-01'
  }
]);
assert.strictEqual(deduped.length, 1);
assert.strictEqual(deduped[0].tokenHash, 'new');

const inbox = backend.load('customerNotificationInbox');
assert.strictEqual(
  inbox.sanitizeNotification({ id: 'notice-1', accountNumber: '100001', title: 'Notice' }).id,
  'notice-1'
);

const smsDelivery = backend.load('smsDelivery');
assert.deepStrictEqual(smsDelivery.normalizeDeliveryMethods(['sms', 'email', 'sms']), ['semaphore', 'mail']);
assert.strictEqual(smsDelivery.normalizeMobileForSms('+63 917 123 4567'), '09171234567');
assert.strictEqual(smsDelivery.normalizeEmail(' CUSTOMER@EXAMPLE.COM '), 'customer@example.com');

assert.strictEqual(typeof backend.load('customerUpstream').startCustomerUpstream, 'function');
assert.strictEqual(typeof backend.load('firebasePush').getPushStatus, 'function');
assert.strictEqual(typeof backend.load('firebasePush').sendToFcmEntries, 'function');
assert.deepStrictEqual(routeContracts(backend.load('messengerBot')), ['GET /', 'POST /']);
const messengerReminders = backend.load('messengerReminders');
assert.strictEqual(typeof messengerReminders.listQueue, 'function');
assert.deepStrictEqual(routeContracts(messengerReminders), [
  'GET /meta-status',
  'GET /',
  'POST /generate',
  'PUT /preferences/:accountNumber',
  'POST /:id/opened',
  'POST /:id/sent',
  'POST /:id/skip',
  'POST /:id/reopen'
]);
assert.strictEqual(messengerReminders.normalizeMessengerLink('customer.name'), 'https://m.me/customer.name');
assert.strictEqual(messengerReminders.normalizeMessengerLink('javascript:alert(1)'), '');
assert.deepStrictEqual(
  messengerReminders.resolveScheduledStage({
    now: new Date('2026-07-28T08:00:00.000Z'),
    balance: 0
  }),
  { stage: 'advance', cycleKey: '2026-08' }
);
assert.deepStrictEqual(
  messengerReminders.resolveScheduledStage({
    now: new Date('2026-08-05T08:00:00.000Z'),
    balance: 1000
  }),
  { stage: 'overdue', cycleKey: '2026-08' }
);
assert.deepStrictEqual(
  messengerReminders.resolveScheduledStage({
    now: new Date('2026-08-07T08:00:00.000Z'),
    balance: 1000
  }),
  { stage: 'final', cycleKey: '2026-08' }
);
const reminderCandidates = messengerReminders.buildReminderCandidates({
  branchId: 1,
  businessName: 'THRE3J Internet',
  now: new Date('2026-08-05T08:00:00.000Z'),
  records: [{
    accountNumber: '100000001',
    name: 'Reminder Customer',
    status: 'Active',
    area: 'Area 1',
    planAmount: 1000,
    billingSummary: {
      endingBalance: 1000,
      billingStatus: 'overdue',
      dueDate: '2026-08-01'
    },
    history: [
      {
        id: 'payment-1',
        kind: 'payment',
        direction: 'credit',
        status: 'completed',
        amount: 500,
        date: '2026-08-04'
      },
      {
        id: 'payment-1',
        kind: 'payment',
        direction: 'credit',
        status: 'completed',
        amount: 500,
        date: '2026-08-04'
      }
    ]
  }]
});
assert.strictEqual(reminderCandidates.length, 2);
assert.strictEqual(new Set(reminderCandidates.map((entry) => entry.key)).size, reminderCandidates.length);
assert(reminderCandidates.some((entry) => entry.stage === 'overdue'));
assert(reminderCandidates.some((entry) => entry.stage === 'payment_confirmation'));
assert(reminderCandidates.every((entry) => entry.message.includes('THRE3J Internet')));
assert.strictEqual(typeof backend.load('smsScheduler').scheduleSmsRunner, 'function');
assert.strictEqual(typeof backend.load('smsScheduler').runSmsSchedulesOnce, 'function');
assert.strictEqual(typeof backend.load('smsSchema').ensureSmsSchema, 'function');
assert.strictEqual(routeContracts(backend.load('sms')).length, 15);
console.log('PASS customer routers, FCM, inbox, Firebase, Messenger, SMS, and upstream contracts');
console.log('CUSTOMER APP COMPATIBILITY PASSED');
