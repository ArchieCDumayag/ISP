const entries = Object.freeze({
  billingScheduler: './billing-scheduler',
  disconnectionStore: './disconnection-store',
  disconnections: './disconnections',
  paymentBreakdownBalance: './payment-breakdown-balance',
  paymentConfirmationQueueStore: './payment-confirmation-queue-store',
  paymentConfirmations: './payment-confirmations',
  paymentEntryNormalizer: './payment-entry-normalizer',
  paymentNumbering: './payment-numbering',
  paymentRecords: './payment-records',
  paymentServiceRefresh: './payment-service-refresh',
  payments: './payments',
  planProfileUtils: './plan-profile-utils',
  plans: './plans'
});

function load(entryName) {
  const entry = entries[entryName];
  if (!entry) throw new Error(`Unknown Billing backend entry: ${entryName}`);
  return require(entry);
}

module.exports = Object.freeze({
  id: 'billing',
  entries,
  load
});
