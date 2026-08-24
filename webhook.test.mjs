import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { evaluateRazorpayWebhook, verifyRazorpaySignature } from './webhook.mjs';

test('accepts a valid Razorpay HMAC signature', () => {
  const raw = Buffer.from('{"event":"payment.failed"}');
  const secret = 'test-only-webhook-secret';
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(verifyRazorpaySignature(raw, signature, secret), true);
});
test('rejects a forged or altered Razorpay HMAC signature', () => {
  const raw = Buffer.from('{"event":"payment.failed"}');
  assert.equal(verifyRazorpaySignature(raw, '0'.repeat(64), 'test-only-webhook-secret'), false);
});
test('turns a signed payment failure into a bounded recovery case', () => {
  const result = evaluateRazorpayWebhook({event:'payment.failed',payload:{payment:{entity:{id:'pay_test_failure',amount:15500,currency:'INR',error_description:'issuer network timeout',notes:{recovery_opt_in:'true'}}}}});
  assert.equal(result.diagnosis.label, 'transient_bank_failure');
  assert.equal(result.decision.status, 'approval_required');
});
