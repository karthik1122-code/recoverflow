import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyRazorpaySignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export { evaluateRazorpayWebhook } from './events.mjs';
