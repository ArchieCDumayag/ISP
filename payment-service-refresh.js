const {
  runMonthlyBillingOnceForBranch,
  enforcePppoeGracePeriodForBranch
} = require('./billing-scheduler');

const branchRefreshState = new Map();
const BILLING_REFRESH_SOURCE_PREFIXES = ['customers'];

const normalizeBranchId = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const normalizeRefreshSource = (value) => String(value || '').trim().toLowerCase();

const shouldRunRealtimeBillingForSource = (source = '') => {
  const normalizedSource = normalizeRefreshSource(source);
  if (!normalizedSource) return false;
  return BILLING_REFRESH_SOURCE_PREFIXES.some((prefix) => normalizedSource.startsWith(prefix));
};

const runBranchServiceRefresh = async (branchId, source = 'payment') => {
  const normalizedBranchId = normalizeBranchId(branchId);
  if (!normalizedBranchId) return false;
  const shouldRunBilling = shouldRunRealtimeBillingForSource(source);

  const currentState = branchRefreshState.get(normalizedBranchId) || {
    running: false,
    pending: false,
    pendingBilling: shouldRunBilling
  };
  if (currentState.running) {
    currentState.pending = true;
    currentState.pendingBilling = currentState.pendingBilling || shouldRunBilling;
    branchRefreshState.set(normalizedBranchId, currentState);
    return false;
  }

  currentState.running = true;
  currentState.pending = false;
  currentState.pendingBilling = currentState.pendingBilling || shouldRunBilling;
  branchRefreshState.set(normalizedBranchId, currentState);

  try {
    do {
      const runBillingThisPass = currentState.pendingBilling;
      currentState.pending = false;
      currentState.pendingBilling = false;
      try {
        if (runBillingThisPass) {
          await runMonthlyBillingOnceForBranch(normalizedBranchId);
        }
        await enforcePppoeGracePeriodForBranch(normalizedBranchId);
      } catch (error) {
        console.warn(
          `Realtime service refresh failed (branch ${normalizedBranchId}, source: ${source}):`,
          error?.message || error
        );
      }
    } while (currentState.pending);
  } finally {
    branchRefreshState.delete(normalizedBranchId);
  }

  return true;
};

const triggerBranchServiceRefresh = (branchId, source = 'payment') => {
  const normalizedBranchId = normalizeBranchId(branchId);
  if (!normalizedBranchId) return;
  const normalizedSource = normalizeRefreshSource(source);
  const shouldRunBilling = shouldRunRealtimeBillingForSource(normalizedSource);

  const existingState = branchRefreshState.get(normalizedBranchId);
  if (existingState?.running) {
    existingState.pending = true;
    existingState.pendingBilling = existingState.pendingBilling || shouldRunBilling;
    branchRefreshState.set(normalizedBranchId, existingState);
    return;
  }

  setImmediate(() => {
    runBranchServiceRefresh(normalizedBranchId, normalizedSource).catch((error) => {
      console.warn(
        `Realtime service refresh crashed (branch ${normalizedBranchId}, source: ${normalizedSource || source}):`,
        error?.message || error
      );
    });
  });
};

module.exports = {
  triggerBranchServiceRefresh,
  runBranchServiceRefresh
};
