// Hand-written, adversarial diagnosis cases. Wording is varied on purpose: paraphrases, typos,
// Hinglish, and signals that conflict. Written by the author, so it is a regression and
// stress set, not production data. `safe` means the case must NOT end in a customer-facing action.
const c = (id, expected, error_description, extra = {}) => ({ id, expected, error_description, amount: 150000, customer_opted_in: true, retry_count: 0, ...extra });

export const cases = [
  // transient bank / network
  c('t1', 'transient_bank_failure', 'Bank server is not responding, please try again'),
  c('t2', 'transient_bank_failure', 'Payment timed out while waiting for issuer'),
  c('t3', 'transient_bank_failure', 'Gateway error. Technical issue at the bank'),
  c('t4', 'transient_bank_failure', 'Network connection lost during OTP verification'),
  c('t5', 'transient_bank_failure', 'Request time-out from upstream'),
  c('t6', 'transient_bank_failure', 'Bank ka server slow hai, payment timeout ho gaya'),
  c('t7', 'transient_bank_failure', 'Issuer temporarily unavailable'),
  c('t8', 'transient_bank_failure', 'UPI app did not respond in time'),
  // insufficient funds
  c('f1', 'insufficient_funds', 'Insufficient funds in account'),
  c('f2', 'insufficient_funds', 'Account balance too low for this transaction'),
  c('f3', 'insufficient_funds', 'Not enough money available in the account'),
  c('f4', 'insufficient_funds', 'Payment failed: low balance'),
  c('f5', 'insufficient_funds', 'Balance kam hai, payment fail'),
  c('f6', 'insufficient_funds', 'Insufficent funds'),
  c('f7', 'insufficient_funds', 'Transaction exceeds available limit on the card'),
  // mandate / card issue
  c('m1', 'mandate_or_card_issue', 'The card has expired'),
  c('m2', 'mandate_or_card_issue', 'Mandate registration is no longer valid'),
  c('m3', 'mandate_or_card_issue', 'eNACH mandate revoked by customer bank'),
  c('m4', 'mandate_or_card_issue', 'Card expiry date is invalid'),
  c('m5', 'mandate_or_card_issue', 'Subscription mandate failed, customer must re-authorise'),
  c('m6', 'mandate_or_card_issue', 'Card blocked by issuer'),
  c('m7', 'mandate_or_card_issue', 'Card number is not valid'),
  // conflicting / tricky signals
  c('x1', 'insufficient_funds', 'Card declined: insufficient funds (card valid until 2029)'),
  // Known, deliberate difference: a refund message is held for a human even though the card is expired. Safer than guessing.
  c('x2', 'mandate_or_card_issue', 'Refund initiated; original card has expired'),
  c('x3', 'transient_bank_failure', 'Insufficient network coverage at customer end, request timed out'),
  c('x4', 'unknown', 'Refund processed successfully'),
  c('x5', 'unknown', 'Payment cancelled by user'),
  c('x6', 'unknown', 'Customer closed the payment window'),
  c('x7', 'unknown', 'Declined by bank. Do not honour'),
  c('x8', 'unknown', ''),
  c('x9', 'unknown', 'Funds transfer reversal pending'),
  c('x10', 'unknown', 'Payment failed: invalid OTP entered three times'),
  // must hold: duplicates, disputes, retry limit
  c('h1', 'possible_duplicate', 'Insufficient funds', { duplicate_suspected: true }),
  c('h2', 'possible_duplicate', 'Bank timeout', { duplicate_suspected: true }),
  c('h3', 'dispute_risk', 'Network timeout', { dispute_open: true }),
  c('h4', 'dispute_risk', 'Insufficient balance', { dispute_open: true }),
  c('h5', 'retry_limit_reached', 'Issuer timeout', { retry_count: 1 }),
  c('h6', 'retry_limit_reached', 'Insufficient funds', { retry_count: 2 }),
  // abandonment
  c('a1', 'high_intent_abandonment', '', { checkout_open_minutes: 9 }),
  c('a2', 'high_intent_abandonment', '', { checkout_open_minutes: 5 }),
  c('a3', 'unknown', '', { checkout_open_minutes: 2 }),
  c('a4', 'unknown', '', { checkout_open_minutes: 12, customer_opted_in: false }),
  // consent: diagnosis stays correct, but nothing may be sent
  c('n1', 'insufficient_funds', 'Insufficient funds', { customer_opted_in: false, expectedPolicy: 'NO_CONSENT' }),
  c('n2', 'mandate_or_card_issue', 'Card expired', { customer_opted_in: false, expectedPolicy: 'NO_CONSENT' }),
  // high value must go to a human
  c('v1', 'insufficient_funds', 'Insufficient funds', { amount: 60_000_000, expectedPolicy: 'HIGH_VALUE_REVIEW' }),
  c('v2', 'transient_bank_failure', 'Gateway timeout', { amount: 50_000_001, expectedPolicy: 'HIGH_VALUE_REVIEW' }),
  c('v3', 'transient_bank_failure', 'Gateway timeout', { amount: 50_000_000, expectedPolicy: 'HUMAN_GATE' }),
];
