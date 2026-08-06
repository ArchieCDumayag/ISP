const entries = Object.freeze({
  customerAppApi: './customer-app-api',
  customerFcmTokens: './customer-fcm-tokens',
  customerNotificationInbox: './customer-notification-inbox',
  customerUpstream: './customer-upstream',
  firebasePush: './firebase-push',
  messengerBot: './messenger-bot',
  messengerReminders: './messenger-reminders',
  smsDelivery: './sms-delivery',
  smsScheduler: './sms-scheduler',
  smsSchema: './sms-schema',
  sms: './sms'
});

function load(entryName) {
  const entry = entries[entryName];
  if (!entry) throw new Error(`Unknown Customer App backend entry: ${entryName}`);
  return require(entry);
}

module.exports = Object.freeze({
  id: 'customer-app',
  entries,
  load
});
