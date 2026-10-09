/**
 * Explainable diagnosis and policy decisioning for synthetic or webhook-derived
 * payment events. This is deliberately deterministic: models may propose a
 * diagnosis, but policy is the final authority for any recovery action.
 */
export function diagnose(event) {
  const code = String(event.error_code || '').toLowerCase();
  const description = String(event.error_description || '').toLowerCase();
  const text = `${code} ${description}`;
  if (event.duplicate_suspected) return result('possible_duplicate', 0.61, 'Hold for a human review', ['duplicate payment fingerprint']);
  if (event.dispute_open) return result('dispute_risk', 0.96, 'Hold for a human review', ['open dispute']);
  if (event.retry_count >= 1) return result('retry_limit_reached', 0.92, 'Hold; retry limit reached', ['retry attempted in prior 24h']);
  if (/insufficient|balance|fund/.test(text)) return result('insufficient_funds', 0.89, 'Send a single payment-link reminder', ['bank balance failure', 'active customer consent']);
  if (/mandate|expired|card.*expir/.test(text)) return result('mandate_or_card_issue', 0.91, 'Ask customer to update payment method', ['mandate or expiry signal']);
  if (/timeout|network|gateway|technical/.test(text)) return result('transient_bank_failure', 0.94, 'Offer one delayed retry', ['issuer or network timeout', 'no retry in last 24h']);
  if (event.checkout_open_minutes >= 5 && event.customer_opted_in) return result('high_intent_abandonment', 0.77, 'Send one cart-recovery payment link', ['checkout open ≥ 5 minutes', 'marketing consent']);
  return result('unknown', 0.42, 'Hold for human review', ['insufficient diagnostic evidence']);
}

/** Amounts are in paise (Razorpay's unit). Actions above ₹5,00,000 always go to an accounts owner. */
export const HIGH_VALUE_PAISE = 50_000_000;

export function policyDecision(event, diagnosis) {
  if (!event.customer_opted_in && /Send|Ask/.test(diagnosis.recommended_action)) return hold('NO_CONSENT', 'Customer has not consented to contact.');
  if (event.amount > HIGH_VALUE_PAISE) return hold('HIGH_VALUE_REVIEW', 'High-value action needs an accounts-owner review.');
  if (['possible_duplicate', 'dispute_risk', 'retry_limit_reached', 'unknown'].includes(diagnosis.label)) return hold('EXCEPTION_QUEUE', 'This failure type is never automatically actioned.');
  if (diagnosis.confidence < 0.75) return hold('LOW_CONFIDENCE', 'Diagnosis confidence is below the 75% policy threshold.');
  return {status: 'approval_required', policy_code: 'HUMAN_GATE', reason: 'A human must approve this single, bounded recovery action.'};
}

function result(label, confidence, recommended_action, evidence) { return {label, confidence, recommended_action, evidence}; }
function hold(policy_code, reason) { return {status: 'held', policy_code, reason}; }
