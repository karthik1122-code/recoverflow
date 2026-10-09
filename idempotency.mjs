import { createHash } from 'node:crypto';

/**
 * Derive a stable recovery event key from the immutable webhook snapshot.
 * A retried delivery has the same body, so it gets the same key. When the payload
 * lacks an entity id or a timestamp we fall back to a fingerprint of the raw body,
 * so two different events can never collapse into one key.
 */
export function razorpayEventKey(payload, rawBody) {
  const payment = payload?.payload?.payment?.entity || {};
  const subscription = payload?.payload?.subscription?.entity || {};
  const entityId = payment.id || subscription.id;
  const occurredAt = payment.created_at || subscription.current_start || payload?.created_at;
  const event = payload?.event || 'unknown_event';
  if (entityId && occurredAt) return `${event}:${entityId}:${occurredAt}`;
  const source = rawBody ?? JSON.stringify(payload ?? null);
  return `${event}:fp:${createHash('sha256').update(source).digest('hex').slice(0, 24)}`;
}
