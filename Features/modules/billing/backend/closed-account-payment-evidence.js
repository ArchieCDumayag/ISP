const EVIDENCE_CLOSED_ACCOUNT_COLLECTION = 'closed_account_collection';
const EVIDENCE_CLOSURE_WRITE_OFF = 'closure_write_off';

const cleanText = (value) => String(value == null ? '' : value).trim();
const cleanLower = (value) => cleanText(value).toLowerCase();

const getClosedAccountPaymentEvidenceType = (entry = {}) => {
  const id = cleanLower(entry?.id);
  const description = cleanLower(entry?.description);
  const fingerprint = cleanLower(entry?.fingerprint);
  const paymentMethod = cleanLower(entry?.paymentMethod || entry?.payment_method);
  const reference = cleanLower(entry?.reference);
  const kind = cleanLower(entry?.kind || entry?.type);
  const direction = cleanLower(entry?.direction);

  const markedCollection = entry?.closedAccountCollection === true
    || entry?.closed_account_collection === true
    || Boolean(cleanText(entry?.closedAccountClosureId || entry?.closed_account_closure_id))
    || description.startsWith('closed account collection | closure id:');
  if (markedCollection && (direction === 'credit' || kind === 'payment' || !kind)) {
    return EVIDENCE_CLOSED_ACCOUNT_COLLECTION;
  }

  const markedWriteOff = id.startsWith('closure-writeoff-')
    || fingerprint.includes('|account-closure|')
    || (
      paymentMethod === 'account closure adjustment'
      && (
        description.startsWith('account closure write-off')
        || description.startsWith('account closure final-balance')
        || reference.startsWith('close-')
      )
    );
  if (markedWriteOff && (
    direction === 'credit'
    || direction === 'debit'
    || kind === 'discount'
    || kind === 'charge'
    || !kind
  )) {
    return EVIDENCE_CLOSURE_WRITE_OFF;
  }

  return null;
};

const isProtectedClosedAccountPaymentEvidence = (entry = {}) => (
  Boolean(getClosedAccountPaymentEvidenceType(entry))
);

module.exports = {
  EVIDENCE_CLOSED_ACCOUNT_COLLECTION,
  EVIDENCE_CLOSURE_WRITE_OFF,
  getClosedAccountPaymentEvidenceType,
  isProtectedClosedAccountPaymentEvidence
};
