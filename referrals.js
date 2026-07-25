const express = require('express');
const createError = require('http-errors');
const customersModule = require('./customers');
const { loadAccounts } = require('./accounts-store');
const { accountHasRole } = require('./role-utils');
const {
  buildReferralLedger,
  summarizeReferralLedger,
  getCustomerName
} = require('./referral-engine');

const router = express.Router();

const readCustomers = async (branchId = null) => {
  if (typeof customersModule.readVisibleCustomers === 'function') {
    return customersModule.readVisibleCustomers(branchId);
  }
  return customersModule.readCustomers(branchId);
};
const readPayments = async (branchId = null) => customersModule.readPayments(branchId);

const assertAdminUser = (req) => {
  const user = req.user || null;
  if (!user || !accountHasRole(user, 'Admin')) {
    throw createError(403, 'Admin access is required.');
  }
  return user;
};

const normalizeText = (value) => String(value || '').trim();
const normalizeAccountNumber = (value) => normalizeText(value);

const readReferralAgents = async (branchId = null) => {
  const accounts = await loadAccounts();
  return (Array.isArray(accounts) ? accounts : [])
    .filter((account) => {
      if (account.hidden || account.system) return false;
      if (account.isActive === false) return false;
      if (branchId && account.branchId && String(account.branchId) !== String(branchId)) return false;
      return true;
    })
    .map((account) => ({
      id: normalizeText(account.id),
      username: normalizeText(account.username),
      name: normalizeText(account.name || account.username),
      role: normalizeText(account.role || (Array.isArray(account.roles) ? account.roles.join(', ') : 'User')),
      branchId: account.branchId || null
    }))
    .filter((account) => account.id);
};

const buildCustomerOptions = (customers = []) => (
  (Array.isArray(customers) ? customers : [])
    .map((customer) => ({
      accountNumber: normalizeAccountNumber(customer.accountNumber),
      name: getCustomerName(customer),
      planName: normalizeText(customer.planName),
      status: normalizeText(customer.status || 'active'),
      area: normalizeText(customer.area),
      street: normalizeText(customer.street),
      barangay: normalizeText(customer.barangay),
      municipality: normalizeText(customer.municipality),
      province: normalizeText(customer.province)
    }))
    .filter((customer) => customer.accountNumber)
    .sort((left, right) => left.name.localeCompare(right.name))
);

router.get('/options', async (req, res, next) => {
  try {
    const user = assertAdminUser(req);
    const branchId = user.branchId || null;
    const [customers, agents] = await Promise.all([
      readCustomers(branchId),
      readReferralAgents(branchId)
    ]);
    res.json({
      ok: true,
      customers: buildCustomerOptions(customers),
      agents
    });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to load referral options.'));
  }
});

router.get('/', async (req, res, next) => {
  try {
    const user = assertAdminUser(req);
    const branchId = user.branchId || null;
    const [customers, payments, agents] = await Promise.all([
      readCustomers(branchId),
      readPayments(branchId),
      readReferralAgents(branchId)
    ]);
    const items = buildReferralLedger({ customers, payments, agents, now: new Date() });
    res.json({
      ok: true,
      items,
      metrics: summarizeReferralLedger(items)
    });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to load referrals.'));
  }
});

module.exports = router;
