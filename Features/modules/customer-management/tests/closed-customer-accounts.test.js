const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const stores = {
  closed_customer_accounts: { version: 1, branches: {} }
};

function replaceModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports
  };
}

replaceModule('../../../../core/data/data-store', {
  readJson: async (key, fallback) => structuredClone(stores[key] ?? fallback),
  writeJson: async (key, payload) => {
    stores[key] = structuredClone(payload);
  }
});

const storePath = require.resolve('../backend/closed-customer-account-store');
delete require.cache[storePath];
const closedAccounts = require(storePath);

const ADMIN = {
  id: 'admin-1',
  username: 'archiecd',
  name: 'Archie Admin',
  role: 'Admin'
};

async function run() {
  const started = await closedAccounts.beginCustomerAccountClosure({
    branchId: 1,
    customer: {
      accountNumber: '100000356',
      name: 'Paid Subscriber',
      mobileRaw: '09170000000',
      planName: 'Postpaid 800',
      area: 'Carupian'
    },
    closureDate: '2026-08-26',
    reason: 'Customer requested permanent disconnection',
    balanceBefore: 0,
    balanceTreatment: 'zero',
    closedBy: ADMIN
  });
  assert.equal(started.state, closedAccounts.STATE_CLOSING);
  assert.equal(started.active, true);
  assert.equal(started.auditHistory[0].action, 'closure-started');

  const completed = await closedAccounts.completeCustomerAccountClosure(started.id, {
    branchId: 1,
    balanceTreatment: 'zero',
    writeOffAmount: 0,
    finalBalance: 0,
    actor: ADMIN
  });
  assert.equal(completed.state, closedAccounts.STATE_CLOSED);
  assert.ok(completed.closedAt);
  assert.equal(completed.auditHistory.at(-1).action, 'account-closed');

  const listed = await closedAccounts.listClosedCustomerAccounts({ branchId: 1 });
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].accountNumber, '100000356');
  assert.equal((await closedAccounts.getActiveClosedAccountNumberSet(1)).has('100000356'), true);
  assert.equal((await closedAccounts.getActiveClosedAccountNumberSet(2)).size, 0);

  await assert.rejects(
    () => closedAccounts.beginCustomerAccountClosure({
      branchId: 1,
      customer: { accountNumber: '100000356' },
      closureDate: '2026-08-26',
      reason: 'Duplicate close request',
      balanceBefore: 0,
      balanceTreatment: 'zero',
      closedBy: ADMIN
    }),
    /already closed/i
  );

  const reopened = await closedAccounts.reopenClosedCustomerAccount(started.id, {
    branchId: 1,
    reason: 'Customer requested service again',
    balanceAction: 'collect-first',
    reopenedBy: ADMIN
  });
  assert.equal(reopened.active, false);
  assert.ok(reopened.reopenedAt);
  assert.equal(reopened.reopenBalanceAction, 'collect-first');
  assert.equal(reopened.auditHistory.at(-1).action, 'account-reopened');
  assert.equal((await closedAccounts.getActiveClosedAccountNumberSet(1)).has('100000356'), false);
  assert.equal((await closedAccounts.listClosedCustomerAccounts({ branchId: 1 })).total, 0);
  assert.equal((await closedAccounts.listClosedCustomerAccounts({ branchId: 1, includeReopened: true })).total, 1);

  const failedStart = await closedAccounts.beginCustomerAccountClosure({
    branchId: 1,
    customer: { accountNumber: '100000016', name: 'Retry Subscriber' },
    closureDate: '2026-08-26',
    reason: 'Customer requested permanent disconnection',
    balanceBefore: 800,
    balanceTreatment: 'write-off',
    closedBy: ADMIN
  });
  const failed = await closedAccounts.failCustomerAccountClosure(failedStart.id, {
    branchId: 1,
    warning: 'Billing write-off: simulated database failure',
    actor: ADMIN
  });
  assert.equal(failed.state, closedAccounts.STATE_FAILED);
  const retried = await closedAccounts.beginCustomerAccountClosure({
    branchId: 1,
    customer: { accountNumber: '100000016', name: 'Retry Subscriber' },
    closureDate: '2026-08-26',
    reason: 'Customer requested permanent disconnection',
    balanceBefore: 0,
    balanceTreatment: 'write-off',
    closedBy: ADMIN
  });
  assert.equal(retried.state, closedAccounts.STATE_CLOSING);
  assert.equal(retried.balanceBefore, 800, 'retry must preserve the first audited balance snapshot');
  assert.equal(retried.balanceTreatment, 'write-off');
  assert.equal(retried.finalBalance, 0, 'retry may retain the latest canonical balance separately');
  assert.equal(retried.auditHistory.at(-1).action, 'closure-retried');

  const retainedStart = await closedAccounts.beginCustomerAccountClosure({
    branchId: 1,
    customer: { accountNumber: '100000017', name: 'Retained Balance Subscriber' },
    closureDate: '2026-08-26',
    reason: 'Close while retaining debt for collection',
    balanceBefore: 1600,
    balanceTreatment: 'keep',
    closedBy: ADMIN
  });
  const retainedClosed = await closedAccounts.completeCustomerAccountClosure(retainedStart.id, {
    branchId: 1,
    balanceTreatment: 'keep',
    writeOffAmount: 0,
    finalBalance: 1600,
    actor: ADMIN
  });
  assert.equal(retainedClosed.balanceTreatment, 'keep');
  assert.equal(retainedClosed.writeOffAmount, 0);
  assert.equal(retainedClosed.finalBalance, 1600);
  const retainedReopened = await closedAccounts.reopenClosedCustomerAccount(retainedStart.id, {
    branchId: 1,
    reason: 'Customer returned and will keep the balance outstanding',
    balanceAction: 'keep',
    reopenedBy: ADMIN
  });
  assert.equal(retainedReopened.reopenBalanceAction, 'keep');

  const customerBackendSource = fs.readFileSync(
    path.join(__dirname, '..', 'backend', 'customers.js'),
    'utf8'
  );
  const archivePage = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'customer-archive.html'),
    'utf8'
  );
  const customersPage = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'customers.html'),
    'utf8'
  );
  const archiveScript = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'js', 'customer-archive.js'),
    'utf8'
  );
  const archiveCss = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'css', 'customer-archive.css'),
    'utf8'
  );

  assert.match(customerBackendSource, /router\.post\('\/:accountNumber\/close-account'/);
  assert.match(customerBackendSource, /accountHasRole\(user, 'Admin'\)/);
  assert.match(customerBackendSource, /BILLING_POLICY_STOP/);
  assert.match(customerBackendSource, /excludeCollectorClient/);
  assert.match(customerBackendSource, /getActiveClosedAccountNumberSet/);
  assert.match(customerBackendSource, /ACCOUNT_CLOSURE_RETRYABLE_FAILURE/);
  assert.match(customerBackendSource, /Any completed write-off is locked to this closure and will not be duplicated/);
  assert.match(customerBackendSource, /closureStage = 'billing-write-off'/);
  assert.match(customerBackendSource, /ACCOUNT_CLOSURE_BALANCE_TREATMENT_REQUIRED/);
  assert.match(customerBackendSource, /balanceTreatment === 'write-off'/);
  assert.match(customerBackendSource, /stoppedBalance - finalBalance/);
  assert.match(customerBackendSource, /balanceAction/);
  assert.match(customerBackendSource, /nextUrl/);
  assert.match(customerBackendSource, /billingThroughDate/);
  assert.match(customerBackendSource, /closureStage = 'post-stop-balance-check'/);
  assert.match(customerBackendSource, /router\.post\('\/closed-accounts\/:closureId\/reopen'/);
  assert.match(archivePage, /Closed \/ Disconnected Accounts/);
  assert.match(archivePage, /Records are preserved permanently/);
  assert.match(archivePage, /id="reopenAccountModal"/);
  assert.match(archivePage, /Collect first — keep service stopped/);
  assert.match(customersPage, /id="closeAccountBalanceTreatment"/);
  assert.match(customersPage, /Keep outstanding for collection — no write-off/);
  assert.match(customersPage, /balanceTreatment: balance > 0\.005/);
  assert.match(archiveScript, /\/api\/customers\/closed-accounts/);
  assert.match(archiveScript, /data-action="retry-close"/);
  assert.match(archiveScript, /\/api\/customers\/\$\{encodeURIComponent\(accountNumber\)\}\/close-account/);
  assert.match(archiveScript, /Any completed write-off is locked and cannot be duplicated/);
  assert.match(archiveScript, /payment-breakdown\.html\?account=/);
  assert.match(archiveScript, /balanceAction/);
  assert.match(archiveScript, /payload\?\.nextUrl/);
  assert.match(archiveScript, /returns as Disabled/i);
  new vm.Script(archiveScript, { filename: 'customer-archive.js' });
  const staticMarkup = archivePage.replace(/<script[\s\S]*?<\/script>/gi, '');
  const ids = [...staticMarkup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Customer Archive IDs must be unique.');
  assert.equal((archiveCss.match(/\{/g) || []).length, (archiveCss.match(/\}/g) || []).length);

  console.log('PASS durable closed-account lifecycle, retained-balance closure, guarded reopen handoff, branch isolation, and preserved-history UI contracts');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
