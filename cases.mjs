/**
 * Recovery case lifecycle for real webhook events.
 *
 *   held ──────────────────────────────► dismissed
 *   open ──approve──► approving ──link──► link_sent ──paid──► recovered
 *     │                  │                   │
 *     │                  └─fail─► open        └─expired/cancelled─► expired
 *     └──dismiss──► dismissed
 *
 * `approving` is a claim: it is taken in one transaction before Razorpay is called,
 * so two people pressing Approve at once can never create two payment links.
 * A payment can also land while still `approving` (the customer was notified the moment
 * the link was created), so `approving → recovered` is allowed.
 */
export const STATUSES = ['open', 'held', 'approving', 'link_sent', 'recovered', 'expired', 'dismissed'];

const ALLOWED = {
  claim: ['open'],
  release: ['approving'],
  link_sent: ['approving'],
  paid: ['approving', 'link_sent'],
  expired: ['link_sent'],
  dismiss: ['open', 'held'],
};
const NEXT = { claim: 'approving', release: 'open', link_sent: 'link_sent', paid: 'recovered', expired: 'expired', dismiss: 'dismissed' };

export class CaseError extends Error {
  constructor(code, message, status) { super(message || code); this.code = code; this.current = status; }
}

/** Starting recovery state for a freshly evaluated webhook event. */
export function initialRecovery(decision) {
  return { status: decision?.status === 'approval_required' ? 'open' : 'held', history: [] };
}

export function statusOf(record) { return record?.recovery?.status || initialRecovery(record?.decision).status; }

/**
 * Pure transition. Returns a NEW record; never mutates the input.
 * Throws CaseError('invalid_transition') when the action is not allowed from the current status.
 */
export function transition(record, action, data = {}, at = new Date().toISOString()) {
  if (!(action in ALLOWED)) throw new CaseError('unknown_action', `unknown action: ${action}`);
  const current = statusOf(record);
  if (!ALLOWED[action].includes(current)) throw new CaseError('invalid_transition', `cannot ${action} a case that is ${current}`, current);
  if (action === 'claim' && record.decision?.status !== 'approval_required') throw new CaseError('policy_blocked', 'policy does not allow an action on this case', current);
  const recovery = { ...(record.recovery || initialRecovery(record.decision)) };
  recovery.history = [...(recovery.history || []), { action, from: current, to: NEXT[action], at, ...(data.by ? { by: data.by } : {}) }];
  recovery.status = NEXT[action];
  if (action === 'claim') { recovery.approved_by = data.by; recovery.approved_at = at; }
  if (action === 'release') { recovery.last_error = data.error || 'payment link could not be created'; delete recovery.approved_by; delete recovery.approved_at; }
  if (action === 'link_sent') { recovery.link = { id: data.id, short_url: data.short_url, expire_by: data.expire_by ?? null }; delete recovery.last_error; }
  if (action === 'paid') { recovery.recovered_amount = Number(data.amount_paid) || record.amount || 0; recovery.recovered_at = at; recovery.recovery_payment_id = data.payment_id || null; }
  if (action === 'dismiss') { recovery.dismissed_by = data.by; recovery.dismiss_reason = String(data.reason || '').slice(0, 280) || null; }
  return { ...record, recovery };
}

/** Razorpay limits reference_id to 40 characters. */
export const referenceIdFor = id => `rf_${String(id)}`.slice(0, 40);

/**
 * Body for POST /v1/payment_links. Razorpay itself texts / emails the customer
 * (notify), so the first version needs no WhatsApp or email provider.
 */
export function paymentLinkRequest(record, { expireMinutes = 72 * 60, now = Date.now() } = {}) {
  const email = record.customer?.email || undefined;
  const contact = record.customer?.contact || undefined;
  return {
    amount: record.amount,
    currency: record.currency || 'INR',
    accept_partial: false,
    reference_id: referenceIdFor(record.id),
    description: 'Complete your payment',
    ...(email || contact ? { customer: { ...(email && { email }), ...(contact && { contact }) } } : {}),
    notify: { sms: !!contact, email: !!email },
    reminder_enable: false,
    expire_by: Math.floor(now / 1000) + expireMinutes * 60,
    notes: { rf_case: String(record.id), source: 'recoverflow' },
  };
}

/** Value-weighted outcome numbers for the dashboard. All amounts are in paise. */
export function summarize(records) {
  const by_status = Object.fromEntries(STATUSES.map(s => [s, 0]));
  let at_risk = 0, recovered = 0, in_flight = 0, actioned = 0;
  for (const r of records) {
    const s = statusOf(r);
    by_status[s] = (by_status[s] || 0) + 1;
    const amount = Number(r.amount) || 0;
    if (['open', 'held', 'approving', 'link_sent'].includes(s)) at_risk += amount;
    if (s === 'approving' || s === 'link_sent') in_flight += amount;
    if (s === 'recovered') recovered += r.recovery?.recovered_amount ?? amount;
    if (['link_sent', 'recovered', 'expired'].includes(s)) actioned += amount;
  }
  return { cases: records.length, by_status, at_risk, in_flight, recovered, recovery_rate: actioned ? Math.round((recovered / actioned) * 1000) / 1000 : 0 };
}

/** How many payment links were sent in the window ending at `now`. Used for the daily safety cap. */
export function linksSentSince(records, sinceMs) {
  let n = 0;
  for (const r of records) for (const h of r.recovery?.history || []) if (h.to === 'link_sent' && Date.parse(h.at) >= sinceMs) n += 1;
  return n;
}
