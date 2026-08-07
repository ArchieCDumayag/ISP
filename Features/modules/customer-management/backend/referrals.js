const crypto = require('crypto');
const express = require('express');
const createError = require('http-errors');
const customersModule = require('./customers');
const { loadAccounts } = require('../../admin/backend/accounts-store');
const { accountHasRole } = require('../../../../core/security/role-utils');
const {
  buildReferralLedger,
  summarizeReferralLedger,
  getCustomerName
} = require('./referral-engine');
const {
  mutateReferralRegistry,
  normalizeActor,
  normalizeMonthKey,
  readReferralRegistry
} = require('./referral-store');

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

const normalizeText = (value, maxLength = 240) => String(value || '').trim().slice(0, maxLength);
const normalizeAccountNumber = (value) => normalizeText(value, 160);
const normalizeReason = (value) => normalizeText(value, 500);
const roundMoney = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
};
const buildActor = (user = {}) => normalizeActor({
  id: user.id || null,
  username: user.username || null,
  name: user.name || user.username || null
});
const createAuditEntry = ({ action, reason, actor, at = new Date().toISOString() } = {}) => ({
  id: `${action}-${crypto.randomUUID()}`,
  action,
  reason: normalizeReason(reason),
  at,
  by: actor
});
const requireReason = (value) => {
  const reason = normalizeReason(value);
  if (reason.length < 3) throw createError(400, 'Enter a reason with at least 3 characters.');
  return reason;
};
const getCurrentMonthKey = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value || '';
  const month = parts.find((part) => part.type === 'month')?.value || '';
  return year && month ? `${year}-${month}` : '';
};
const validateApplyFromMonth = (value, now = new Date()) => {
  const raw = normalizeText(value, 32);
  if (!raw) return '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
    throw createError(400, 'Choose a valid Apply From Month.');
  }
  const monthKey = normalizeMonthKey(raw);
  if (!monthKey) throw createError(400, 'Choose a valid Apply From Month.');
  const currentMonth = getCurrentMonthKey(now);
  if (currentMonth && monthKey < currentMonth) {
    throw createError(400, `Apply From Month cannot be before ${currentMonth}.`);
  }
  return monthKey;
};

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
      planAmount: Number(customer.planAmount) || 0,
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

const loadReferralLedgerForBranch = async (branchId = null, now = new Date()) => {
  const [customers, payments, agents, registry] = await Promise.all([
    readCustomers(branchId),
    readPayments(branchId),
    readReferralAgents(branchId),
    readReferralRegistry(branchId)
  ]);
  const items = buildReferralLedger({ customers, payments, agents, registry, now });
  return { customers, payments, agents, registry, items };
};

const materializeReferralRecord = (item = {}, { actor, reason, now = new Date() } = {}) => {
  const timestamp = now.toISOString();
  return {
    id: item.id,
    sourceType: item.sourceType,
    referrerAccountNumber: item.referrerAccountNumber || '',
    referrerId: item.referrerId || '',
    referrerName: item.referrerName || '',
    referredAccountNumber: item.referredAccountNumber,
    approvalStatus: item.approvalStatus || 'pending',
    approvalReason: reason || '',
    approvedDiscountAmount: Number(item.approvedDiscountAmount) || 0,
    approvedAt: item.approvedAt || '',
    approvedBy: item.approvedBy || null,
    applyFromMonth: item.applyFromMonth || '',
    createdAt: item.createdAt || timestamp,
    createdBy: item.createdBy || actor,
    updatedAt: timestamp,
    updatedBy: actor,
    applications: Array.isArray(item.applications) ? item.applications : [],
    audit: Array.isArray(item.audit) ? item.audit : []
  };
};

const setReferralApprovalStatus = async ({ branchId, referralId, status, reason, applyFromMonth, user } = {}) => {
  const approvalStatus = normalizeText(status, 40).toLowerCase();
  if (!['approved', 'cancelled'].includes(approvalStatus)) {
    throw createError(400, 'Status must be approved or cancelled.');
  }
  const safeReferralId = normalizeText(referralId, 200);
  const safeReason = requireReason(reason);
  const safeApplyFromMonth = approvalStatus === 'approved'
    ? validateApplyFromMonth(applyFromMonth)
    : '';
  const actor = buildActor(user);
  const ledger = await loadReferralLedgerForBranch(branchId);
  const item = ledger.items.find((entry) => entry.id === safeReferralId) || null;
  if (!item) throw createError(404, 'Referral not found.');
  if (approvalStatus === 'cancelled' && item.activeApplications?.length) {
    throw createError(409, 'Reverse the applied billing discount before cancelling this referral.');
  }
  const now = new Date();
  return mutateReferralRegistry(branchId, (records) => {
    const index = records.findIndex((record) => record.id === safeReferralId);
    const record = index >= 0
      ? { ...records[index] }
      : materializeReferralRecord(item, { actor, reason: safeReason, now });
    const wasApproved = record.approvalStatus === 'approved' && Boolean(record.approvedAt);
    record.approvalStatus = approvalStatus;
    record.approvalReason = safeReason;
    if (approvalStatus === 'approved' && !wasApproved) {
      record.approvedDiscountAmount = roundMoney(item.discountAmount);
      record.approvedAt = now.toISOString();
      record.approvedBy = actor;
    }
    if (approvalStatus === 'approved') record.applyFromMonth = safeApplyFromMonth;
    record.updatedAt = now.toISOString();
    record.updatedBy = actor;
    record.audit = [
      ...(Array.isArray(record.audit) ? record.audit : []),
      createAuditEntry({ action: approvalStatus, reason: safeReason, actor, at: record.updatedAt })
    ];
    if (index >= 0) records[index] = record;
    else records.push(record);
    return { records, result: record };
  });
};

const setReferralApplyFromMonth = async ({
  branchId,
  referralId,
  applyFromMonth,
  reason,
  user,
  now = new Date()
} = {}) => {
  const safeReferralId = normalizeText(referralId, 200);
  const safeReason = requireReason(reason);
  const safeApplyFromMonth = validateApplyFromMonth(applyFromMonth, now);
  const actor = buildActor(user);
  const ledger = await loadReferralLedgerForBranch(branchId);
  const item = ledger.items.find((entry) => entry.id === safeReferralId) || null;
  if (!item) throw createError(404, 'Referral not found.');
  if (item.approvalStatus !== 'approved') {
    throw createError(409, 'Approve this referral before scheduling its billing month.');
  }
  if (Array.isArray(item.activeApplications) && item.activeApplications.length) {
    throw createError(409, 'An applied referral month is locked. Reverse the application before rescheduling.');
  }
  return mutateReferralRegistry(branchId, (records) => {
    const index = records.findIndex((record) => record.id === safeReferralId);
    if (index < 0) throw createError(409, 'Approve this referral before scheduling it.');
    const record = { ...records[index] };
    if (record.approvalStatus !== 'approved') {
      throw createError(409, 'Approve this referral before scheduling its billing month.');
    }
    if ((Array.isArray(record.applications) ? record.applications : [])
      .some((application) => application.status === 'applied')) {
      throw createError(409, 'An applied referral month is locked. Reverse the application before rescheduling.');
    }
    const previousMonth = record.applyFromMonth || 'next available';
    const nextMonth = safeApplyFromMonth || 'next available';
    record.applyFromMonth = safeApplyFromMonth;
    record.updatedAt = now.toISOString();
    record.updatedBy = actor;
    record.audit = [
      ...(Array.isArray(record.audit) ? record.audit : []),
      createAuditEntry({
        action: 'rescheduled',
        reason: `${safeReason} (${previousMonth} -> ${nextMonth})`,
        actor,
        at: record.updatedAt
      })
    ];
    records[index] = record;
    return { records, result: record };
  });
};

const applyReferralDiscount = async ({
  branchId,
  referrerAccountNumber,
  referralId,
  billingMonth,
  action = 'apply',
  reason,
  user
} = {}) => {
  const safeAccountNumber = normalizeAccountNumber(referrerAccountNumber);
  const safeReferralId = normalizeText(referralId, 200);
  const safeBillingMonth = normalizeMonthKey(billingMonth);
  const safeAction = normalizeText(action, 40).toLowerCase();
  const safeReason = requireReason(reason);
  if (!safeAccountNumber || !safeReferralId || !safeBillingMonth) {
    throw createError(400, 'Referral, referrer account, and billing month are required.');
  }
  if (!['apply', 'reverse'].includes(safeAction)) {
    throw createError(400, 'Referral action must be apply or reverse.');
  }
  const actor = buildActor(user);
  const ledger = await loadReferralLedgerForBranch(branchId);
  const item = ledger.items.find((entry) => entry.id === safeReferralId) || null;
  if (!item) throw createError(404, 'Referral not found.');
  if (item.sourceType !== 'customer' || item.referrerAccountNumber !== safeAccountNumber) {
    throw createError(409, 'This referral does not belong to the selected subscriber account.');
  }
  if (safeAction === 'apply') {
    if (item.approvalStatus !== 'approved') {
      throw createError(409, 'Only Admin-approved referrals can be applied.');
    }
    if ((Number(item.discountAmount) || 0) <= 0) {
      throw createError(409, 'This referral does not have a valid automatic discount amount.');
    }
  }

  const now = new Date();
  return mutateReferralRegistry(branchId, (records) => {
    const recordIndex = records.findIndex((record) => record.id === safeReferralId);
    if (recordIndex < 0) throw createError(409, 'Approve this referral before applying it to billing.');
    const record = { ...records[recordIndex] };
    const applications = (Array.isArray(record.applications) ? record.applications : []).map((entry) => ({ ...entry }));
    const activeApplicationIndex = applications.findIndex((application) => application.status === 'applied');

    if (safeAction === 'apply') {
      if (record.approvalStatus !== 'approved') throw createError(409, 'This referral is not approved.');
      if (activeApplicationIndex >= 0) throw createError(409, 'This referral discount has already been applied.');
      const appliedThisMonth = records.reduce((count, candidate) => count + (
        (Array.isArray(candidate.applications) ? candidate.applications : [])
          .filter((application) => (
            application.status === 'applied'
            && application.referrerAccountNumber === safeAccountNumber
            && application.billingMonth === safeBillingMonth
          )).length
      ), 0);
      if (appliedThisMonth >= 2) {
        throw createError(409, 'A maximum of two referral discounts can be applied to one billing month.');
      }
      const application = {
        id: `referral-application-${crypto.randomUUID()}`,
        billingMonth: safeBillingMonth,
        referrerAccountNumber: safeAccountNumber,
        amount: Number(item.discountAmount) || 0,
        status: 'applied',
        automatic: false,
        appliedAt: now.toISOString(),
        appliedBy: actor,
        applyReason: safeReason
      };
      applications.push(application);
      record.applications = applications;
      record.updatedAt = now.toISOString();
      record.updatedBy = actor;
      record.audit = [
        ...(Array.isArray(record.audit) ? record.audit : []),
        createAuditEntry({ action: 'applied', reason: safeReason, actor, at: record.updatedAt })
      ];
      records[recordIndex] = record;
      return { records, result: { referral: record, application } };
    }

    const matchingIndex = applications.findIndex((application) => (
      application.status === 'applied'
      && application.referrerAccountNumber === safeAccountNumber
      && application.billingMonth === safeBillingMonth
    ));
    if (matchingIndex < 0) throw createError(409, 'No applied referral discount was found for this billing month.');
    const application = {
      ...applications[matchingIndex],
      status: 'reversed',
      reversedAt: now.toISOString(),
      reversedBy: actor,
      reverseReason: safeReason
    };
    applications[matchingIndex] = application;
    record.applications = applications;
    record.updatedAt = now.toISOString();
    record.updatedBy = actor;
    record.audit = [
      ...(Array.isArray(record.audit) ? record.audit : []),
      createAuditEntry({ action: 'reversed', reason: safeReason, actor, at: record.updatedAt })
    ];
    records[recordIndex] = record;
    return { records, result: { referral: record, application } };
  });
};

const allocateQueuedReferralDiscounts = async ({ branchId, billingTargets = [] } = {}) => {
  const targets = (Array.isArray(billingTargets) ? billingTargets : [])
    .map((target) => ({
      referrerAccountNumber: normalizeAccountNumber(target?.referrerAccountNumber),
      billingMonth: normalizeMonthKey(target?.billingMonth),
      referralCapacity: roundMoney(Math.max(
        0,
        Number(target?.referralCapacity ?? target?.remainingDue) || 0
      ))
    }))
    .filter((target) => target.referrerAccountNumber && target.billingMonth && target.referralCapacity > 0);
  if (!targets.length) return { changed: false, applications: [] };

  const ledger = await loadReferralLedgerForBranch(branchId);
  const ledgerById = new Map(ledger.items.map((item) => [item.id, item]));
  const queuedItems = ledger.items
    .filter((item) => (
      item.sourceType === 'customer'
      && item.approvalStatus === 'approved'
      && item.referrerAccountNumber
      && !(Array.isArray(item.activeApplications) && item.activeApplications.length)
      && (Number(item.discountAmount) || 0) > 0
    ))
    .sort((left, right) => {
      const timeCompare = normalizeText(left.approvedAt || left.updatedAt || left.createdAt)
        .localeCompare(normalizeText(right.approvedAt || right.updatedAt || right.createdAt));
      return timeCompare || normalizeText(left.id).localeCompare(normalizeText(right.id));
    });
  if (!queuedItems.length) return { changed: false, applications: [] };

  const actor = normalizeActor({ username: 'system', name: 'Billing System' });
  const now = new Date();
  return mutateReferralRegistry(branchId, (records) => {
    let changed = false;
    const applicationsCreated = [];
    targets.forEach((target) => {
      const activeApplications = records.flatMap((record) => (
        (Array.isArray(record.applications) ? record.applications : []).filter((application) => (
          application.status === 'applied'
          && application.referrerAccountNumber === target.referrerAccountNumber
          && application.billingMonth === target.billingMonth
        ))
      ));
      let remainingDue = roundMoney(Math.max(
        0,
        target.referralCapacity - activeApplications.reduce((sum, application) => (
          sum + (Number(application.amount) || 0)
        ), 0)
      ));
      let slots = Math.max(0, 2 - activeApplications.length);
      if (!slots || remainingDue <= 0) return;

      queuedItems.forEach((item) => {
        if (!slots || remainingDue <= 0) return;
        if (item.referrerAccountNumber !== target.referrerAccountNumber) return;
        const recordIndex = records.findIndex((record) => record.id === item.id);
        if (recordIndex < 0) return;
        const record = { ...records[recordIndex] };
        if (record.approvalStatus !== 'approved' || record.sourceType !== 'customer') return;
        if (record.applyFromMonth && target.billingMonth < record.applyFromMonth) return;
        const applications = (Array.isArray(record.applications) ? record.applications : [])
          .map((application) => ({ ...application }));
        if (applications.some((application) => application.status === 'applied')) return;
        if (applications.some((application) => application.billingMonth === target.billingMonth)) return;

        const ledgerItem = ledgerById.get(record.id) || item;
        const entitlementAmount = roundMoney(
          Number(record.approvedDiscountAmount) || Number(ledgerItem.discountAmount) || 0
        );
        if (entitlementAmount <= 0) return;
        const appliedAmount = roundMoney(Math.min(entitlementAmount, remainingDue));
        if (appliedAmount <= 0) return;
        const timestamp = now.toISOString();
        const application = {
          id: `referral-application-${crypto.randomUUID()}`,
          billingMonth: target.billingMonth,
          referrerAccountNumber: target.referrerAccountNumber,
          amount: appliedAmount,
          status: 'applied',
          automatic: true,
          appliedAt: timestamp,
          appliedBy: actor,
          applyReason: 'Automatically applied from the Admin-approved referral queue.'
        };
        record.approvedDiscountAmount = entitlementAmount;
        record.approvedAt = record.approvedAt || record.updatedAt || record.createdAt || timestamp;
        record.approvedBy = record.approvedBy || actor;
        record.applications = [...applications, application];
        record.updatedAt = timestamp;
        record.updatedBy = actor;
        record.audit = [
          ...(Array.isArray(record.audit) ? record.audit : []),
          createAuditEntry({
            action: 'applied-automatically',
            reason: application.applyReason,
            actor,
            at: timestamp
          })
        ];
        records[recordIndex] = record;
        applicationsCreated.push({ referralId: record.id, application });
        remainingDue = roundMoney(Math.max(0, remainingDue - appliedAmount));
        slots -= 1;
        changed = true;
      });
    });
    return {
      changed,
      records,
      result: { changed, applications: applicationsCreated }
    };
  });
};

router.get('/options', async (req, res, next) => {
  try {
    const user = assertAdminUser(req);
    const branchId = user.branchId || null;
    const [customers, agents] = await Promise.all([
      readCustomers(branchId),
      readReferralAgents(branchId)
    ]);
    res.json({ ok: true, customers: buildCustomerOptions(customers), agents });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to load referral options.'));
  }
});

router.get('/', async (req, res, next) => {
  try {
    const user = assertAdminUser(req);
    const branchId = user.branchId || null;
    const { items } = await loadReferralLedgerForBranch(branchId);
    res.json({ ok: true, items, metrics: summarizeReferralLedger(items) });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to load referrals.'));
  }
});

router.post('/', async (req, res, next) => {
  try {
    const user = assertAdminUser(req);
    const branchId = user.branchId || null;
    const sourceType = normalizeText(req.body?.sourceType, 40).toLowerCase();
    const referredAccountNumber = normalizeAccountNumber(req.body?.referredAccountNumber);
    const referrerAccountNumber = normalizeAccountNumber(req.body?.referrerAccountNumber);
    const referrerId = normalizeText(req.body?.referrerId, 160);
    const reason = requireReason(req.body?.reason);
    if (!['customer', 'agent'].includes(sourceType)) {
      return next(createError(400, 'Choose an existing customer or agent as the referral source.'));
    }
    const { customers, agents, items } = await loadReferralLedgerForBranch(branchId);
    const referredCustomer = customers.find((customer) => (
      normalizeAccountNumber(customer?.accountNumber) === referredAccountNumber
    )) || null;
    if (!referredCustomer) return next(createError(404, 'Referred customer not found.'));
    if (items.some((item) => item.referredAccountNumber === referredAccountNumber)) {
      return next(createError(409, 'This customer already has a referral record. Approve or restore the existing record instead.'));
    }
    let referrerName = '';
    if (sourceType === 'customer') {
      if (!referrerAccountNumber || referrerAccountNumber === referredAccountNumber) {
        return next(createError(400, 'Choose a different customer as the referrer.'));
      }
      const customer = customers.find((entry) => (
        normalizeAccountNumber(entry?.accountNumber) === referrerAccountNumber
      )) || null;
      if (!customer) return next(createError(404, 'Referrer customer not found.'));
      referrerName = getCustomerName(customer);
    } else {
      const agent = agents.find((entry) => normalizeText(entry?.id) === referrerId) || null;
      if (!agent) return next(createError(404, 'Referral agent not found.'));
      referrerName = normalizeText(agent.name || agent.username || referrerId);
    }
    const actor = buildActor(user);
    const now = new Date();
    const record = {
      id: `referral-${crypto.randomUUID()}`,
      sourceType,
      referrerAccountNumber: sourceType === 'customer' ? referrerAccountNumber : '',
      referrerId: sourceType === 'agent' ? referrerId : '',
      referrerName,
      referredAccountNumber,
      approvalStatus: 'pending',
      approvalReason: reason,
      applyFromMonth: '',
      createdAt: now.toISOString(),
      createdBy: actor,
      updatedAt: now.toISOString(),
      updatedBy: actor,
      applications: [],
      audit: [createAuditEntry({ action: 'created', reason, actor, at: now.toISOString() })]
    };
    await mutateReferralRegistry(branchId, (records) => ({ records: [...records, record], result: record }));
    res.status(201).json({ ok: true, referral: record });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to create referral.'));
  }
});

router.patch('/:referralId/status', async (req, res, next) => {
  try {
    const user = assertAdminUser(req);
    const referral = await setReferralApprovalStatus({
      branchId: user.branchId || null,
      referralId: req.params.referralId,
      status: req.body?.status,
      reason: req.body?.reason,
      applyFromMonth: req.body?.applyFromMonth,
      user
    });
    res.json({ ok: true, referral });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to update referral status.'));
  }
});

router.patch('/:referralId/schedule', async (req, res, next) => {
  try {
    const user = assertAdminUser(req);
    const referral = await setReferralApplyFromMonth({
      branchId: user.branchId || null,
      referralId: req.params.referralId,
      applyFromMonth: req.body?.applyFromMonth,
      reason: req.body?.reason,
      user
    });
    res.json({ ok: true, referral });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to schedule referral.'));
  }
});

router.patch('/:referralId', async (req, res, next) => {
  try {
    const user = assertAdminUser(req);
    const branchId = user.branchId || null;
    const referralId = normalizeText(req.params.referralId, 200);
    const sourceType = normalizeText(req.body?.sourceType, 40).toLowerCase();
    const referredAccountNumber = normalizeAccountNumber(req.body?.referredAccountNumber);
    const referrerAccountNumber = normalizeAccountNumber(req.body?.referrerAccountNumber);
    const referrerId = normalizeText(req.body?.referrerId, 160);
    const reason = requireReason(req.body?.reason);
    if (!['customer', 'agent'].includes(sourceType)) {
      return next(createError(400, 'Choose an existing customer or agent as the referral source.'));
    }
    const { customers, agents, items } = await loadReferralLedgerForBranch(branchId);
    const currentItem = items.find((item) => item.id === referralId) || null;
    if (!currentItem) return next(createError(404, 'Referral not found.'));
    if ((Array.isArray(currentItem.applications) ? currentItem.applications : []).length) {
      return next(createError(409, 'A referral with billing application history cannot be edited. Cancel it and create a corrected referral record.'));
    }
    const referredCustomer = customers.find((customer) => (
      normalizeAccountNumber(customer?.accountNumber) === referredAccountNumber
    )) || null;
    if (!referredCustomer) return next(createError(404, 'Referred customer not found.'));
    if (items.some((item) => item.id !== referralId && item.referredAccountNumber === referredAccountNumber)) {
      return next(createError(409, 'This customer already has another referral record.'));
    }
    let referrerName = '';
    if (sourceType === 'customer') {
      if (!referrerAccountNumber || referrerAccountNumber === referredAccountNumber) {
        return next(createError(400, 'Choose a different customer as the referrer.'));
      }
      const referrer = customers.find((customer) => (
        normalizeAccountNumber(customer?.accountNumber) === referrerAccountNumber
      )) || null;
      if (!referrer) return next(createError(404, 'Referrer customer not found.'));
      referrerName = getCustomerName(referrer);
    } else {
      const agent = agents.find((entry) => normalizeText(entry?.id) === referrerId) || null;
      if (!agent) return next(createError(404, 'Referral agent not found.'));
      referrerName = normalizeText(agent.name || agent.username || referrerId);
    }
    const actor = buildActor(user);
    const now = new Date();
    const referral = await mutateReferralRegistry(branchId, (records) => {
      const recordIndex = records.findIndex((record) => record.id === referralId);
      const record = recordIndex >= 0
        ? { ...records[recordIndex] }
        : materializeReferralRecord(currentItem, { actor, reason, now });
      Object.assign(record, {
        sourceType,
        referrerAccountNumber: sourceType === 'customer' ? referrerAccountNumber : '',
        referrerId: sourceType === 'agent' ? referrerId : '',
        referrerName,
        referredAccountNumber,
        approvalStatus: 'pending',
        approvalReason: reason,
        approvedDiscountAmount: 0,
        approvedAt: '',
        approvedBy: null,
        applyFromMonth: '',
        updatedAt: now.toISOString(),
        updatedBy: actor,
        applications: []
      });
      record.audit = [
        ...(Array.isArray(record.audit) ? record.audit : []),
        createAuditEntry({ action: 'edited', reason, actor, at: record.updatedAt })
      ];
      if (recordIndex >= 0) records[recordIndex] = record;
      else records.push(record);
      return { records, result: record };
    });
    res.json({ ok: true, referral });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to edit referral.'));
  }
});

module.exports = router;
module.exports.allocateQueuedReferralDiscounts = allocateQueuedReferralDiscounts;
module.exports.applyReferralDiscount = applyReferralDiscount;
module.exports.loadReferralLedgerForBranch = loadReferralLedgerForBranch;
module.exports.setReferralApplyFromMonth = setReferralApplyFromMonth;
module.exports.setReferralApprovalStatus = setReferralApprovalStatus;
