const entries = Object.freeze({
  coverage: './api_coverage',
  customerArchiveStore: './customer-archive-store',
  customerDraftSubmissionsStore: './customer-draft-submissions-store',
  customerDraftSubmissions: './customer-draft-submissions',
  customerFullJsonImport: './customer-full-json-import',
  customers: './customers',
  philippinesAddresses: './philippines-addresses',
  referralEngine: './referral-engine',
  referrals: './referrals'
});

function load(entryName) {
  const entry = entries[entryName];
  if (!entry) throw new Error(`Unknown Customer Management backend entry: ${entryName}`);
  return require(entry);
}

module.exports = Object.freeze({
  id: 'customer-management',
  entries,
  load
});
