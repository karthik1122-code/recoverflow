import { createHmac, timingSafeEqual } from 'node:crypto';
import { diagnose, policyDecision } from './core.mjs';

export function verifyRazorpaySignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

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
  };
  const diagnosis = diagnose(event);
  const decision = policyDecision(event, diagnosis);
  return {event, diagnosis, decision};
}
