/** Derive a stable recovery event key from the immutable webhook snapshot. */
export function razorpayEventKey(payload) {
  const payment = payload?.payload?.payment?.entity || {};
  const subscription = payload?.payload?.subscription?.entity || {};
  const entityId = payment.id || subscription.id || 'unknown_entity';
  const occurredAt = payment.created_at || subscription.current_start || payload.created_at || 'unknown_time';
  return `${payload?.event || 'unknown_event'}:${entityId}:${occurredAt}`;
}

export function claimEvent(seen, key) {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
