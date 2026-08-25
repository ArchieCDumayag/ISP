const roundMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : Number.NaN;
};

const cleanText = (value, maxLength = 200) => String(value || '').trim().slice(0, maxLength);

const buildMainGcashAllocationPlan = ({
  mainPayments = [],
  officialAmount,
  transactionDate
} = {}) => {
  const creditedAmount = roundMoney(officialAmount);
  const paymentDate = cleanText(transactionDate, 10);
  const sourcePayments = Array.isArray(mainPayments) ? mainPayments : [];
  const allocations = sourcePayments.map((payment) => ({
    accountNumber: cleanText(payment?.accountNumber, 20).toUpperCase(),
    customerName: `Main - ${cleanText(payment?.customerName || payment?.accountNumber || 'Customer', 193)}`,
    amount: roundMoney(payment?.amount),
    billingMonth: paymentDate.slice(0, 7),
    paymentEntryId: cleanText(payment?.paymentEntryId || payment?.id, 64),
    date: cleanText(payment?.date, 10),
    pending: payment?.pending === true
  }));
  const mainAmount = roundMoney(allocations.reduce((total, allocation) => (
    total + (Number.isFinite(allocation.amount) ? allocation.amount : 0)
  ), 0));
  const remainingAmount = roundMoney(creditedAmount - mainAmount);
  const invalidPayment = allocations.find((allocation) => (
    !allocation.accountNumber
    || !allocation.paymentEntryId
    || !Number.isFinite(allocation.amount)
    || allocation.amount <= 0
    || allocation.date !== paymentDate
  ));
  const duplicateAccount = new Set(allocations.map((allocation) => allocation.accountNumber)).size !== allocations.length;

  if (!allocations.length) {
    return { status: 'none', allocations: [], mainAmount: 0, remainingAmount: creditedAmount, reason: '' };
  }
  if (!Number.isFinite(creditedAmount) || creditedAmount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    return { status: 'conflict', allocations, mainAmount, remainingAmount, reason: 'The imported GCash credit is invalid.' };
  }
  if (allocations.some((allocation) => allocation.pending)) {
    return { status: 'conflict', allocations, mainAmount, remainingAmount, reason: 'A matching Main payment is still pending verification.' };
  }
  if (invalidPayment) {
    return {
      status: 'conflict',
      allocations,
      mainAmount,
      remainingAmount,
      reason: 'Every Main payment must have a valid account, entry ID, amount, and the same date as the official credit.'
    };
  }
  if (duplicateAccount) {
    return { status: 'conflict', allocations, mainAmount, remainingAmount, reason: 'The Main portion contains duplicate customer accounts.' };
  }
  if (mainAmount > creditedAmount) {
    return { status: 'conflict', allocations, mainAmount, remainingAmount, reason: 'Main payments exceed the official GCash credit.' };
  }
  if (mainAmount === creditedAmount) {
    return { status: 'complete', allocations, mainAmount, remainingAmount: 0, reason: 'The full credit is already recorded in Main.' };
  }
  return {
    status: 'partial',
    allocations,
    mainAmount,
    remainingAmount,
    reason: 'The recorded Main portion can be linked while the remaining amount is posted to Temp.'
  };
};

module.exports = {
  buildMainGcashAllocationPlan,
  roundMoney
};
