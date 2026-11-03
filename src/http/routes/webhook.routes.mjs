import { evaluateRazorpayWebhook, verifyRazorpaySignature } from '../../domain/webhook.mjs';
import { razorpayEventKey } from '../../domain/idempotency.mjs';
import { reply, readBody, HttpError } from '../respond.mjs';

// POST /webhooks/razorpay. No session: it is protected by Razorpay's HMAC signature instead.
// The idempotency key, event and audit record are committed together, so a retried delivery is never processed twice.
export async function webhookRoutes({ request, response, url }, { store, metrics, config }) {
  if (request.method !== 'POST' || url.pathname !== '/webhooks/razorpay') return false;
  const raw = await readBody(request);
  if (!verifyRazorpaySignature(raw, request.headers['x-razorpay-signature'], config.webhookSecret())) {
    metrics.record('signature_failures');
    return reply(response, 401, { error: 'invalid webhook signature' });
  }
  let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'invalid_json'); }
  metrics.record('received');
  const idempotencyKey = razorpayEventKey(payload, raw);
  const outcome = await store.commitWebhook(idempotencyKey, () => {
    const evaluation = evaluateRazorpayWebhook(payload);
    if (evaluation.ignored) return { value: { status: 202, body: evaluation } };
    const record = { ...evaluation.event, idempotency_key: idempotencyKey, diagnosis: evaluation.diagnosis, decision: evaluation.decision, received_at: new Date().toISOString() };
    return {
      event: record,
      audit: { title: `Webhook received: ${payload.event}`, detail: `${evaluation.diagnosis.label} (${Math.round(evaluation.diagnosis.confidence * 100)}% confidence); ${evaluation.decision.status}.`, payment_id: record.id },
      value: { status: 201, body: { id: record.id, diagnosis: evaluation.diagnosis, decision: evaluation.decision } },
    };
  });
  if (outcome.duplicate) { metrics.record('duplicates_blocked'); return reply(response, 200, { duplicate: true, idempotency_key: idempotencyKey }); }
  metrics.record(outcome.value.status === 201 ? 'accepted' : 'ignored');
  return reply(response, outcome.value.status, outcome.value.body);
}
