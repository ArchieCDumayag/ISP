const entries = Object.freeze({
  accountsStore: './accounts-store',
  accounts: './accounts',
  activityLogVisibility: './activity-log-visibility',
  activityLog: './activity-log',
  appDownloadsStore: './app-downloads-store',
  appDownloads: './app-downloads',
  auth: './auth',
  businessProfile: './business-profile',
  factoryReset: './factory-reset',
  infoApi: './info-api',
  integrationSettings: './integration-settings',
  setupInstaller: './setup-installer',
  systemBackupService: './system-backup-service',
  systemBackup: './system-backup'
});

function load(entryName) {
  const entry = entries[entryName];
  if (!entry) throw new Error(`Unknown Admin backend entry: ${entryName}`);
  return require(entry);
}

module.exports = Object.freeze({
  id: 'admin',
  entries,
  load
});
