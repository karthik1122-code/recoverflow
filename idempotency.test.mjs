import test from 'node:test';
import assert from 'node:assert/strict';
import { razorpayEventKey } from './idempotency.mjs';

test('generates the same key for a retried webhook snapshot', () => {
  const payload = {event:'payment.failed',created_at:1730000000,payload:{payment:{entity:{id:'pay_replay',created_at:1730000000}}}};
  assert.equal(razorpayEventKey(payload), razorpayEventKey(structuredClone(payload)));
});
test('events without an id or timestamp never share a key', () => {
  const a = {event:'payment.failed',payload:{payment:{entity:{amount:100}}}};
  const b = {event:'payment.failed',payload:{payment:{entity:{amount:200}}}};
  assert.notEqual(razorpayEventKey(a), razorpayEventKey(b));
  assert.equal(razorpayEventKey(a), razorpayEventKey(structuredClone(a)));
});
test('the same raw body always produces the same fallback key', () => {
  const raw = Buffer.from('{"event":"payment.failed"}');
  assert.equal(razorpayEventKey({event:'payment.failed'}, raw), razorpayEventKey({event:'payment.failed'}, Buffer.from(raw)));
});
