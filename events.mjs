import { diagnose, policyDecision } from './core.mjs';

/**
 * Turns a Razorpay failure payload into a diagnosed, policy-checked event.
 * Pure (no Node built-ins) so the server and the in-browser preview share it.
 */
export function evaluateRazorpayWebhook(payload) {
  const allowedEvents = new Set(['payment.failed', 'subscription.pending', 'subscription.halted']);
  if (!allowedEvents.has(payload?.event)) return {ignored:true, reason:'event_not_in_recovery_scope'};
  const payment = payload?.payload?.payment?.entity || {};
  const event = {
    id: payment.id || `event_${Date.now()}`,
    amount: payment.amount || 0,
    currency: payment.currency || 'INR',
    error_code: payment.error_code,
    error_description: payment.error_description,
    customer_opted_in: payment.notes?.recovery_opt_in === 'true',
    retry_count: Number(payment.notes?.retry_count || 0),
    checkout_open_minutes: Number(payment.notes?.checkout_open_minutes || 0),
    received_event: payload.event,
    customer: { name: payment.notes?.customer_name || null, email: payment.email || null, contact: payment.contact || null },
    duplicate_suspected: payment.notes?.duplicate_suspected === 'true',
    dispute_open: payment.notes?.dispute_open === 'true',
    test_event: payment.notes?.test_event === 'true',
  };
  const diagnosis = diagnose(event);
  const decision = policyDecision(event, diagnosis);
  return {event, diagnosis, decision};
}
