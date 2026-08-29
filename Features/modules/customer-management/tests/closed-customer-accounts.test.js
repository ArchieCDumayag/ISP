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
  assert.equal(retainedClosed.requestedFinalBalance, 1600);
  assert.equal(retainedClosed.finalBalance, 1600);
  const retainedReopened = await closedAccounts.reopenClosedCustomerAccount(retainedStart.id, {
    branchId: 1,
    reason: 'Customer returned and will keep the balance outstanding',
    balanceAction: 'keep',
    reopenedBy: ADMIN
  });
  assert.equal(retainedReopened.reopenBalanceAction, 'keep');

  const finalizedStart = await closedAccounts.beginCustomerAccountClosure({
    branchId: 1,
    customer: { accountNumber: '100000018', name: 'Finalized Balance Subscriber' },
    closureDate: '2026-08-26',
    reason: '',
    balanceBefore: 1200,
    balanceTreatment: 'keep',
    requestedFinalBalance: 500,
    closedBy: ADMIN
  });
  assert.equal(finalizedStart.reason, 'Account closed by Admin.');
  assert.equal(finalizedStart.requestedFinalBalance, 500);
  await assert.rejects(
    () => closedAccounts.beginCustomerAccountClosure({
      branchId: 1,
      customer: { accountNumber: '100000018', name: 'Finalized Balance Subscriber' },
      closureDate: '2026-08-26',
      balanceBefore: 500,
      balanceTreatment: 'keep',
      requestedFinalBalance: 600,
      closedBy: ADMIN
    }),
    /original final balance/i
  );
  const finalizedClosed = await closedAccounts.completeCustomerAccountClosure(finalizedStart.id, {
    branchId: 1,
    balanceTreatment: 'keep',
    requestedFinalBalance: 500,
    balanceAdjustmentAmount: 700,
    balanceAdjustmentDirection: 'credit',
    finalBalance: 500,
    actor: ADMIN
  });
  assert.equal(finalizedClosed.balanceAdjustmentAmount, 700);
  assert.equal(finalizedClosed.balanceAdjustmentDirection, 'credit');
  assert.equal(finalizedClosed.balanceBefore, 1200);
  assert.equal(finalizedClosed.requestedFinalBalance, 500);
  assert.equal(finalizedClosed.finalBalance, 500);
  assert.equal(finalizedClosed.reason, 'Account closed by Admin.');
  assert.equal(finalizedClosed.closedBy.id, ADMIN.id);
  assert.ok(finalizedClosed.createdAt);
  assert.ok(finalizedClosed.closedAt);
  assert.equal(finalizedClosed.auditHistory.at(0).action, 'closure-started');
  assert.equal(finalizedClosed.auditHistory.at(-1).action, 'account-closed');
  assert.ok(finalizedClosed.auditHistory.every((event) => event.at));
  const finalizedListed = (await closedAccounts.listClosedCustomerAccounts({ branchId: 1 })).items
    .find((record) => record.id === finalizedClosed.id);
  assert.equal(finalizedListed?.requestedFinalBalance, 500, 'the Admin-finalized closure snapshot must remain durable');
  assert.equal(finalizedListed?.finalBalance, 500);

  const snapshotStart = await closedAccounts.beginCustomerAccountClosure({
    branchId: 1,
    customer: { accountNumber: '100000019', name: 'Snapshot Balance Subscriber' },
    closureDate: '2026-08-29',
    reason: 'Final closed balance set by Admin',
    balanceBefore: 2400,
    balanceMode: closedAccounts.BALANCE_MODE_SNAPSHOT,
    canonicalBalanceAtClosure: 2400,
    requestedFinalBalance: 2398,
    finalClosedCustomerBalance: 2398,
    closedBy: ADMIN
  });
  const snapshotClosed = await closedAccounts.completeCustomerAccountClosure(snapshotStart.id, {
    branchId: 1,
    balanceMode: closedAccounts.BALANCE_MODE_SNAPSHOT,
    canonicalBalanceAtClosure: 2400,
    requestedFinalBalance: 2398,
    finalClosedCustomerBalance: 2398,
    balanceAdjustmentAmount: 2,
    balanceAdjustmentDirection: 'credit',
    finalBalance: 2398,
    actor: ADMIN
  });
  assert.equal(snapshotClosed.balanceMode, closedAccounts.BALANCE_MODE_SNAPSHOT);
  assert.equal(snapshotClosed.balanceBefore, 2400);
  assert.equal(snapshotClosed.canonicalBalanceAtClosure, 2400);
  assert.equal(snapshotClosed.finalClosedCustomerBalance, 2398);
  assert.equal(snapshotClosed.requestedFinalBalance, 2398);
  assert.equal(snapshotClosed.finalBalance, 2398);
  assert.equal(snapshotClosed.balanceAdjustmentAmount, 0, 'snapshot closures never create a Billing adjustment');
  assert.equal(snapshotClosed.balanceAdjustmentDirection, null);
  assert.equal(closedAccounts.resolveClosedCustomerBalance(snapshotClosed, 2400), 2398);
  assert.equal(closedAccounts.resolveClosedCustomerBalance(snapshotClosed, 1800), 1798);
  assert.equal(closedAccounts.resolveClosedCustomerBalance(snapshotClosed, 2), 0);
  assert.equal(
    closedAccounts.resolveClosedCustomerBalance({
      balanceBefore: 1200,
      requestedFinalBalance: 500,
      finalBalance: 500,
      balanceAdjustmentAmount: 700,
      balanceAdjustmentDirection: 'credit'
    }, 500),
    500,
    'unmarked legacy closures must remain canonical and must not double-count their old adjustment'
  );
  assert.equal(stores.closed_customer_accounts.version, 2);

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
  assert.ok(
    (customerBackendSource.match(/enqueuePaymentMutation/g) || []).length >= 5,
    'close, reopen, edit, import, and delete must share the Billing/Collector payment mutation queue'
  );
  assert.match(customerBackendSource, /accountHasRole\(user, 'Admin'\)/);
  assert.match(customerBackendSource, /BILLING_POLICY_STOP/);
  assert.match(customerBackendSource, /excludeCollectorClient/);
  assert.match(customerBackendSource, /getActiveClosedAccountNumberSet/);
  assert.match(customerBackendSource, /ACCOUNT_CLOSURE_RETRYABLE_FAILURE/);
  assert.match(customerBackendSource, /original Final Closed Balance is preserved/);
  assert.match(customerBackendSource, /const balanceMode = existingClosure/);
  assert.match(customerBackendSource, /BALANCE_MODE_SNAPSHOT/);
  assert.match(customerBackendSource, /const adjustmentRequired = balanceMode === BALANCE_MODE_CANONICAL/);
  assert.match(customerBackendSource, /closure\.balanceMode === BALANCE_MODE_CANONICAL/);
  assert.match(customerBackendSource, /\['failed', 'closing'\]\.includes\(existingClosure\?\.state\)/);
  assert.match(customerBackendSource, /recordAccountClosureBalanceAdjustment/);
  assert.doesNotMatch(customerBackendSource, /balanceAdjustmentConfirmed/);
  assert.doesNotMatch(customerBackendSource, /ACCOUNT_CLOSURE_BALANCE_ADJUSTMENT_CONFIRMATION_REQUIRED/);
  assert.match(customerBackendSource, /closedAccountCanonicalBalanceAtClosure/);
  assert.match(customerBackendSource, /finalClosedCustomerBalance/);
  assert.match(customerBackendSource, /resolveClosedCustomerBalance/);
  assert.match(customerBackendSource, /balanceAction/);
  assert.match(customerBackendSource, /nextUrl/);
  assert.match(customerBackendSource, /billingThroughDate/);
  assert.match(customerBackendSource, /closureStage = 'post-stop-balance-check'/);
  assert.match(customerBackendSource, /router\.post\('\/closed-accounts\/:closureId\/reopen'/);
  assert.match(customerBackendSource, /remainingBalance: resolveClosedCustomerBalance\(record, balance\)/);
  assert.match(customerBackendSource, /const closureFinalBalance = resolveFinalClosedCustomerBalance\(record\)/);
  assert.match(customerBackendSource, /closureFinalBalance,\s+remainingBalance:/);
  assert.match(customerBackendSource, /getCanonicalAccountClosureBalance/);
  assert.match(customerBackendSource, /balance: canonicalBalance/);
  assert.match(customerBackendSource, /CUSTOMER_UPDATE_ACCOUNT_CLOSED/);
  assert.match(customerBackendSource, /allowClosedAccountLifecycleMutation: true/);
  assert.match(customerBackendSource, /closed_account_protected/);
  assert.match(customerBackendSource, /CUSTOMER_DELETE_PROTECTED_CLOSED_ACCOUNT_HISTORY/);
  assert.match(customerBackendSource, /lockPaymentAccount\(connection, scopedBranchId, targetAccountNumber\)/);
  assert.match(archivePage, /Closed \/ Disconnected Accounts/);
  assert.match(archivePage, /Records are preserved permanently/);
  assert.match(archivePage, /id="reopenAccountModal"/);
  assert.match(archivePage, /id="reopenAccountBalanceLabel"/);
  assert.match(archivePage, /customer-archive\.js\?v=2\.3/);
  assert.match(archivePage, /Collect first — keep service stopped/);
  assert.match(customersPage, /id="closeAccountFinalBalance"/);
  assert.match(customersPage, /id="closeAccountFinalBalanceHint"/);
  assert.match(customersPage, /Final Closed Customer Balance/);
  assert.match(customersPage, /Reason <span class="text-secondary">\(optional\)<\/span>/);
  assert.doesNotMatch(customersPage, /id="closeAccountReason"[^>]*required/);
  assert.doesNotMatch(customersPage, /balanceAdjustmentConfirmed/);
  assert.doesNotMatch(customersPage, /Audited Credit Adjustment/i);
  assert.doesNotMatch(customersPage, /non-cash credit/i);
  assert.match(archiveScript, /\/api\/customers\/closed-accounts/);
  assert.match(archiveScript, /data-action="retry-close"/);
  assert.match(archiveScript, /\/api\/customers\/\$\{encodeURIComponent\(accountNumber\)\}\/close-account/);
  assert.match(archiveScript, /original Final Closed Balance/);
  assert.match(archiveScript, /payment-breakdown\.html\?account=/);
  assert.match(archiveScript, /balanceAction/);
  assert.match(archiveScript, /payload\?\.nextUrl/);
  assert.match(archiveScript, /returns as Disabled/i);
  assert.match(archiveScript, /item\?\.balanceAvailable === true/);
  assert.match(archiveScript, /item\?\.remainingBalance/);
  assert.match(archiveScript, /const closureFinalBalance = readMoney\(item\?\.finalClosedCustomerBalance\)/);
  assert.match(archiveScript, /\?\? readMoney\(item\?\.closureFinalBalance\)/);
  assert.match(archiveScript, /formatBalance\(closureFinalBalance\)/);
  assert.doesNotMatch(
    archiveScript,
    /<p class="archive-date">\$\{escapeHtml\(formatMoney\(remainingBalance\)\)\}<\/p>/,
    'the Final Balance column must not be replaced by the live remaining balance'
  );
  assert.match(archiveScript, /Current closed balance/);
  assert.match(archiveScript, /Current advance credit/);
  assert.match(archiveScript, /Keep advance credit/);
  assert.match(archiveScript, /advance credit will remain on the account/);
  assert.match(archiveScript, /data-action="reopen-closed"[^>]*data-final-balance="\$\{escapeHtml\(remainingBalance\)\}"/);
  assert.match(archiveScript, /Final Closed Balance paid in full/);
  assert.doesNotMatch(archiveScript, /balanceAdjustmentAmount/);
  assert.doesNotMatch(archiveScript, /No balance adjustment/);
  new vm.Script(archiveScript, { filename: 'customer-archive.js' });

  const archiveFixture = {
    id: snapshotClosed.id,
    accountNumber: snapshotClosed.accountNumber,
    customerName: snapshotClosed.customerName,
    closureDate: snapshotClosed.closureDate,
    reason: snapshotClosed.reason,
    state: 'closed',
    balanceMode: closedAccounts.BALANCE_MODE_SNAPSHOT,
    balanceBefore: 2400,
    canonicalBalanceAtClosure: 2400,
    balanceTreatment: 'keep',
    requestedFinalBalance: 2398,
    finalClosedCustomerBalance: 2398,
    closureFinalBalance: 2398,
    finalBalance: 2398,
    balanceAdjustmentAmount: 0,
    balanceAdjustmentDirection: null,
    remainingBalance: 1798,
    balanceAvailable: true,
    closedAt: snapshotClosed.closedAt
  };
  const renderClosedAccountFixture = async (fixture) => {
    const tableBody = { innerHTML: '', addEventListener() {} };
    const pageSize = { value: '10', addEventListener() {} };
    vm.runInNewContext(archiveScript, {
      console,
      document: {
        getElementById(id) {
          if (id === 'closedAccountsTableBody') return tableBody;
          if (id === 'closedAccountsPageSize') return pageSize;
          return null;
        },
        querySelectorAll() { return []; }
      },
      window: {
        location: { hash: '#closed-accounts' },
        history: { replaceState() {} },
        setTimeout,
        clearTimeout
      },
      fetch: async () => ({
        ok: true,
        json: async () => ({ ok: true, items: [fixture], total: 1 })
      }),
      URLSearchParams,
      Intl,
      encodeURIComponent,
      setTimeout,
      clearTimeout
    }, { filename: 'customer-archive.js' });
    await new Promise((resolve) => setImmediate(resolve));
    return tableBody.innerHTML;
  };
  const closedAccountHtml = await renderClosedAccountFixture(archiveFixture);
  assert.match(
    closedAccountHtml,
    /archive-date">[^<]*2,398\.00/,
    'Final Balance must render the saved Admin closure snapshot'
  );
  assert.match(
    closedAccountHtml,
    /Current closed balance[^<]*1,798\.00/,
    'a later live balance must be labeled separately'
  );
  assert.match(
    closedAccountHtml,
    /data-action="reopen-closed"[^>]*data-final-balance="1798"/,
    'Reopen must continue using the live remaining balance'
  );
  const advanceCreditHtml = await renderClosedAccountFixture({
    ...archiveFixture,
    remainingBalance: -100
  });
  assert.match(
    advanceCreditHtml,
    /archive-date">[^<]*2,398\.00/,
    'a later advance credit must not replace the closure Final Balance'
  );
  assert.match(
    advanceCreditHtml,
    /Current advance credit[^<]*100\.00/,
    'a negative live balance must be labeled as advance credit, not debt'
  );
  assert.doesNotMatch(advanceCreditHtml, /Current closed balance[^<]*100\.00/);
  assert.match(
    advanceCreditHtml,
    /data-action="reopen-closed"[^>]*data-final-balance="-100"/,
    'Reopen must retain the signed advance credit'
  );

  const reopenTableBody = {
    innerHTML: '',
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; }
  };
  const makeControl = (overrides = {}) => ({
    addEventListener() {},
    classList: { add() {}, remove() {} },
    setAttribute() {},
    focus() {},
    style: {},
    ...overrides
  });
  const reopenOptions = {
    'collect-first': { disabled: false, textContent: '' },
    keep: { disabled: false, textContent: '' },
    'write-off': { disabled: false, textContent: '' }
  };
  const reopenControls = {
    closedAccountsTableBody: reopenTableBody,
    closedAccountsPageSize: makeControl({ value: '10' }),
    reopenAccountModal: makeControl(),
    reopenAccountForm: makeControl({ reset() {} }),
    reopenAccountClose: makeControl(),
    reopenAccountCancel: makeControl(),
    reopenAccountCustomerName: makeControl({ textContent: '' }),
    reopenAccountBalanceLabel: makeControl({ textContent: '' }),
    reopenAccountBalance: makeControl({ textContent: '' }),
    reopenAccountBalanceAction: makeControl({
      value: 'collect-first',
      querySelector(selector) {
        const value = String(selector).match(/value="([^"]+)"/)?.[1];
        return reopenOptions[value] || null;
      }
    }),
    reopenAccountBalanceHint: makeControl({ textContent: '' }),
    reopenAccountReason: makeControl({ value: '' }),
    reopenAccountConfirmed: makeControl({ checked: false }),
    reopenAccountConfirmationLabel: makeControl({ textContent: '' }),
    reopenAccountError: makeControl({ textContent: '', hidden: true }),
    reopenAccountSubmit: makeControl({ disabled: true, innerHTML: '' })
  };
  vm.runInNewContext(archiveScript, {
    console,
    document: {
      getElementById(id) { return reopenControls[id] || null; },
      querySelectorAll() { return []; }
    },
    window: {
      location: { hash: '#closed-accounts' },
      history: { replaceState() {} },
      setTimeout,
      clearTimeout
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({ ok: true, items: [{ ...archiveFixture, remainingBalance: -100 }], total: 1 })
    }),
    URLSearchParams,
    Intl,
    encodeURIComponent,
    setTimeout,
    clearTimeout
  }, { filename: 'customer-archive.js' });
  await new Promise((resolve) => setImmediate(resolve));
  const advanceReopenButton = {
    dataset: {
      closureId: snapshotClosed.id,
      accountNumber: snapshotClosed.accountNumber,
      customerName: snapshotClosed.customerName,
      finalBalance: '-100'
    }
  };
  reopenTableBody.listeners.click({
    target: {
      closest(selector) {
        return selector === '[data-action="reopen-closed"]' ? advanceReopenButton : null;
      }
    }
  });
  assert.equal(reopenControls.reopenAccountBalanceLabel.textContent, 'Advance credit');
  assert.equal(reopenControls.reopenAccountBalance.textContent, '₱100.00');
  assert.equal(reopenControls.reopenAccountBalanceAction.value, 'keep');
  assert.equal(reopenOptions['collect-first'].disabled, true);
  assert.match(reopenOptions.keep.textContent, /Keep advance credit/);
  assert.match(reopenControls.reopenAccountBalanceHint.textContent, /advance credit remains on the account/i);
  assert.match(reopenControls.reopenAccountConfirmationLabel.textContent, /advance credit will remain on the account/i);
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
