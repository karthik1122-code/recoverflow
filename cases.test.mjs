import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseError, initialRecovery, paymentLinkRequest, referenceIdFor, statusOf, summarize, transition } from './cases.mjs';

const eligible = (over = {}) => ({ id: 'pay_A1', amount: 125000, currency: 'INR', decision: { status: 'approval_required' }, recovery: initialRecovery({ status: 'approval_required' }), customer: { email: 'a@b.in', contact: '+919999999999' }, ...over });
const held = () => ({ id: 'pay_H1', amount: 9000, decision: { status: 'held' }, recovery: initialRecovery({ status: 'held' }) });

test('a policy-eligible event starts open, a held one starts held', () => {
  assert.equal(statusOf(eligible()), 'open');
  assert.equal(statusOf(held()), 'held');
  assert.equal(statusOf({ decision: { status: 'approval_required' } }), 'open', 'records from before cases existed still resolve');
});

test('happy path: open → approving → link_sent → recovered, with history', () => {
  let r = transition(eligible(), 'claim', { by: 'ops@shop.in' }, 't1');
  assert.equal(r.recovery.status, 'approving');
  assert.equal(r.recovery.approved_by, 'ops@shop.in');
  r = transition(r, 'link_sent', { id: 'plink_1', short_url: 'https://rzp.io/x', expire_by: 99 }, 't2');
  assert.deepEqual(r.recovery.link, { id: 'plink_1', short_url: 'https://rzp.io/x', expire_by: 99 });
  r = transition(r, 'paid', { amount_paid: 125000, payment_id: 'pay_OK' }, 't3');
  assert.equal(r.recovery.status, 'recovered');
  assert.equal(r.recovery.recovered_amount, 125000);
  assert.deepEqual(r.recovery.history.map(h => h.to), ['approving', 'link_sent', 'recovered']);
});

test('transitions never mutate the input record', () => {
  const before = eligible();
  const snapshot = JSON.stringify(before);
  transition(before, 'claim', { by: 'x' });
  assert.equal(JSON.stringify(before), snapshot);
});

test('a held case can never be approved, only dismissed', () => {
  assert.throws(() => transition(held(), 'claim', { by: 'x' }), e => e instanceof CaseError && e.code === 'invalid_transition' && e.current === 'held');
  assert.equal(transition(held(), 'dismiss', { by: 'x', reason: 'duplicate' }).recovery.status, 'dismissed');
});

test('an open case whose policy is not approval_required is blocked even if its status was forced', () => {
  const forged = eligible({ decision: { status: 'held' } });
  assert.throws(() => transition(forged, 'claim', { by: 'x' }), e => e.code === 'policy_blocked');
});

test('a second approve is rejected while the first is in flight or done', () => {
  const claimed = transition(eligible(), 'claim', { by: 'a' });
  assert.throws(() => transition(claimed, 'claim', { by: 'b' }), e => e.code === 'invalid_transition' && e.current === 'approving');
  const sent = transition(claimed, 'link_sent', { id: 'l', short_url: 'u' });
  assert.throws(() => transition(sent, 'claim', { by: 'b' }), e => e.current === 'link_sent');
});

test('a failed link creation releases the claim and records why', () => {
  const r = transition(transition(eligible(), 'claim', { by: 'a' }), 'release', { error: 'Razorpay returned 500' });
  assert.equal(r.recovery.status, 'open');
  assert.equal(r.recovery.last_error, 'Razorpay returned 500');
  assert.equal(r.recovery.approved_by, undefined);
});

test('payment can land before link_sent is written (customer is notified at creation)', () => {
  const r = transition(transition(eligible(), 'claim', { by: 'a' }), 'paid', { amount_paid: 125000 });
  assert.equal(r.recovery.status, 'recovered');
});

test('paid twice, expired after paid, and dismiss after sending are all rejected', () => {
  const recovered = transition(transition(transition(eligible(), 'claim', {}), 'link_sent', { id: 'l', short_url: 'u' }), 'paid', {});
  assert.throws(() => transition(recovered, 'paid', {}), e => e.current === 'recovered');
  assert.throws(() => transition(recovered, 'expired', {}), e => e.current === 'recovered');
  const sent = transition(transition(eligible(), 'claim', {}), 'link_sent', { id: 'l', short_url: 'u' });
  assert.throws(() => transition(sent, 'dismiss', {}), e => e.current === 'link_sent');
  assert.equal(transition(sent, 'expired', {}).recovery.status, 'expired');
  assert.throws(() => transition(sent, 'teleport', {}), e => e.code === 'unknown_action');
});

test('recovered amount falls back to the case amount when the link omits it', () => {
  const r = transition(transition(eligible(), 'claim', {}), 'paid', {});
  assert.equal(r.recovery.recovered_amount, 125000);
});

test('dismiss reasons are capped', () => {
  assert.equal(transition(held(), 'dismiss', { reason: 'x'.repeat(1000) }).recovery.dismiss_reason.length, 280);
});

test('payment link request: amount in paise, ≤40-char reference, notes link back, Razorpay notifies', () => {
  const body = paymentLinkRequest(eligible({ id: 'pay_' + 'Z'.repeat(60) }), { now: 1_700_000_000_000, expireMinutes: 60 });
  assert.equal(body.amount, 125000);
  assert.equal(body.accept_partial, false);
  assert.ok(body.reference_id.length <= 40);
  assert.equal(body.notes.rf_case, 'pay_' + 'Z'.repeat(60));
  assert.equal(body.notes.source, 'recoverflow');
  assert.deepEqual(body.notify, { sms: true, email: true });
  assert.deepEqual(body.customer, { email: 'a@b.in', contact: '+919999999999' });
  assert.equal(body.expire_by, 1_700_000_000 + 3600);
});

test('payment link request without contact details sends no notification and no customer block', () => {
  const body = paymentLinkRequest(eligible({ customer: { email: null, contact: null } }));
  assert.deepEqual(body.notify, { sms: false, email: false });
  assert.equal('customer' in body, false);
  assert.equal(referenceIdFor('pay_1'), 'rf_pay_1');
});

test('summary is value-weighted and counts every status', () => {
  const open = eligible({ id: 'o', amount: 1000 });
  const sent = transition(transition(eligible({ id: 's', amount: 2000 }), 'claim', {}), 'link_sent', { id: 'l', short_url: 'u' });
  const won = transition(transition(eligible({ id: 'w', amount: 3000 }), 'claim', {}), 'paid', { amount_paid: 3000 });
  const lost = transition(transition(transition(eligible({ id: 'x', amount: 1000 }), 'claim', {}), 'link_sent', { id: 'l', short_url: 'u' }), 'expired', {});
  const s = summarize([open, sent, won, lost, held()]);
  assert.equal(s.cases, 5);
  assert.equal(s.at_risk, 1000 + 2000 + 9000);
  assert.equal(s.in_flight, 2000);
  assert.equal(s.recovered, 3000);
  assert.equal(s.recovery_rate, 0.5, '3000 recovered of 6000 actioned');
  assert.equal(s.by_status.held, 1);
  assert.equal(summarize([]).recovery_rate, 0);
});
