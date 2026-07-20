const fs = require('fs');
const path = require('path');

const FEATURES_FILE = path.join(__dirname, 'data', 'flavor-features.json');
const FLAVORS_DIR = path.join(__dirname, 'flavors');

const DEFAULT_FEATURES = Object.freeze({
  dashboard: true,
  customers: true,
  customerDrafts: true,
  customerArchive: true,
  plans: true,
  coverageTable: true,
  coverageMap: true,
  payments: true,
  paymentHistory: true,
  paymentConfirmationQueue: false,
  paymentConfirmationQueueHistory: false,
  ponManagement: true,
  genieacs: true,
  collectors: true,
  collectionHistory: true,
  tickets: true,
  jobs: true,
  jobHistory: true,
  expenses: true,
  payroll: true,
  mikrotikPppoe: true,
  customerAppPopupReminder: true,
  accounts: true,
  sms: true
});

const FEATURE_LABELS = Object.freeze({
  dashboard: 'Dashboard',
  customers: 'Customers',
  customerDrafts: 'Customer Drafts',
  customerArchive: 'Customer Archive',
  plans: 'Plans',
  coverageTable: 'Coverage Table',
  coverageMap: 'Coverage Map',
  payments: 'Payments',
  paymentHistory: 'Payment History',
  paymentConfirmationQueue: 'Payment Confirmation Queue',
  paymentConfirmationQueueHistory: 'Payment Queue History',
  ponManagement: 'PON Management',
  genieacs: 'GenieACS',
  collectors: 'Assign Collector',
  collectionHistory: 'Collection History',
  tickets: 'Tickets',
  jobs: 'Jobs',
  jobHistory: 'Job History',
  expenses: 'Expenses',
  payroll: 'Payroll',
  mikrotikPppoe: 'MikroTik PPPoE',
  customerAppPopupReminder: 'Customer App Pop Up Reminder',
  accounts: 'Accounts',
  sms: 'SMS'
});

const FEATURE_GROUPS = Object.freeze([
  {
    key: 'core',
    label: 'Core Pages',
    features: ['dashboard', 'customers', 'customerDrafts', 'customerArchive', 'plans', 'accounts']
  },
  {
    key: 'billing',
    label: 'Billing',
    features: ['payments', 'paymentHistory', 'paymentConfirmationQueue', 'paymentConfirmationQueueHistory']
  },
  {
    key: 'network',
    label: 'Network',
    features: ['coverageTable', 'coverageMap', 'ponManagement', 'genieacs', 'mikrotikPppoe']
  },
  {
    key: 'operations',
    label: 'Operations',
    features: ['collectors', 'collectionHistory', 'tickets', 'jobs', 'jobHistory']
  },
  {
    key: 'business',
    label: 'Business Tools',
    features: ['expenses', 'payroll', 'sms', 'customerAppPopupReminder']
  }
]);

const FEATURE_ORDER = Object.freeze(FEATURE_GROUPS.flatMap((group) => group.features));

const normalizeFeatures = (input = {}) => {
  const source = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_FEATURES).map(([key, defaultValue]) => [key, source[key] === undefined ? defaultValue : Boolean(source[key])])
  );
};

const readFeaturePayload = () => {
  try {
    const activeFlavorName = String(process.env.ACTIVE_FLAVOR_NAME || '').trim();
    if (activeFlavorName) {
      const safeFlavorName = activeFlavorName
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const activeFlavorPath = path.join(FLAVORS_DIR, `${safeFlavorName}.json`);
      if (safeFlavorName && fs.existsSync(activeFlavorPath)) {
        const flavor = JSON.parse(fs.readFileSync(activeFlavorPath, 'utf8'));
        if (flavor?.features && typeof flavor.features === 'object') {
          return { features: flavor.features };
        }
      }
    }
  } catch {
    // Fall through to env/file/defaults.
  }

  try {
    if (String(process.env.FLAVOR_RUNTIME_ISOLATED || '').trim() === '1' && process.env.FLAVOR_FEATURES) {
      return { features: JSON.parse(process.env.FLAVOR_FEATURES) };
    }
  } catch {
    // Fall through to file/defaults.
  }

  try {
    if (fs.existsSync(FEATURES_FILE)) {
      return JSON.parse(fs.readFileSync(FEATURES_FILE, 'utf8'));
    }
  } catch {
    // Fall through to env/defaults.
  }

  try {
    if (process.env.FLAVOR_FEATURES) {
      return { features: JSON.parse(process.env.FLAVOR_FEATURES) };
    }
  } catch {
    // Fall through to defaults.
  }

  return { features: DEFAULT_FEATURES };
};

const getFlavorFeatures = () => {
  const payload = readFeaturePayload();
  const features = normalizeFeatures(payload?.features || payload);
  const checklist = FEATURE_ORDER.map((key) => ({
    key,
    label: FEATURE_LABELS[key] || key,
    enabled: Boolean(features[key])
  }));
  return {
    ok: true,
    features,
    checklist
  };
};

const isFeatureEnabled = (key) => Boolean(getFlavorFeatures().features[key]);

module.exports = {
  DEFAULT_FEATURES,
  FEATURE_GROUPS,
  FEATURE_LABELS,
  FEATURE_ORDER,
  getFlavorFeatures,
  isFeatureEnabled,
  normalizeFeatures
};
