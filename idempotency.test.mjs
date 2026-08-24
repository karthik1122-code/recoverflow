import test from 'node:test';
import assert from 'node:assert/strict';
import { claimEvent, razorpayEventKey } from './idempotency.mjs';

test('generates the same key for a retried webhook snapshot', () => {
  const payload = {event:'payment.failed',created_at:1730000000,payload:{payment:{entity:{id:'pay_replay',created_at:1730000000}}}};
  assert.equal(razorpayEventKey(payload), razorpayEventKey(structuredClone(payload)));
});
test('only claims an event once', () => {
  const seen = new Set();
  assert.equal(claimEvent(seen, 'payment.failed:pay_replay:1730000000'), true);
  assert.equal(claimEvent(seen, 'payment.failed:pay_replay:1730000000'), false);
});
