import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentLink, razorpayConfig, RazorpayError } from './razorpay.mjs';

test('config: missing keys are not ready', () => {
  assert.deepEqual(razorpayConfig({}), { ready: false, reason: 'razorpay_not_configured' });
});

test('config: test keys work, live keys need an explicit opt-in', () => {
  assert.equal(razorpayConfig({ RAZORPAY_KEY_ID: 'rzp_test_1', RAZORPAY_KEY_SECRET: 's' }).mode, 'test');
  assert.equal(razorpayConfig({ RAZORPAY_KEY_ID: 'rzp_live_1', RAZORPAY_KEY_SECRET: 's' }).reason, 'live_keys_need_RAZORPAY_MODE_live');
  assert.equal(razorpayConfig({ RAZORPAY_KEY_ID: 'rzp_live_1', RAZORPAY_KEY_SECRET: 's', RAZORPAY_MODE: 'live' }).mode, 'live');
  assert.equal(razorpayConfig({ RAZORPAY_KEY_ID: 'junk', RAZORPAY_KEY_SECRET: 's', RAZORPAY_MODE: 'live' }).ready, false);
  assert.equal(razorpayConfig({ RAZORPAY_KEY_ID: 'rzp_test_1', RAZORPAY_KEY_SECRET: 's', RAZORPAY_API_BASE: 'http://x/' }).base, 'http://x');
});

const config = razorpayConfig({ RAZORPAY_KEY_ID: 'rzp_test_1', RAZORPAY_KEY_SECRET: 'sec' });
const respond = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });

test('creates a link with basic auth and returns only what we store', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return respond(200, { id: 'plink_1', short_url: 'https://rzp.io/l/x', status: 'created', expire_by: 5, extra: 'ignored' })(); };
  const link = await createPaymentLink(config, { amount: 100 }, { fetchImpl });
  assert.deepEqual(link, { id: 'plink_1', short_url: 'https://rzp.io/l/x', status: 'created', expire_by: 5 });
  assert.equal(seen.url, 'https://api.razorpay.com/v1/payment_links');
  assert.equal(seen.init.headers.authorization, `Basic ${Buffer.from('rzp_test_1:sec').toString('base64')}`);
  assert.equal(JSON.parse(seen.init.body).amount, 100);
});

test('surfaces Razorpay rejections, network failures and malformed replies as RazorpayError', async () => {
  await assert.rejects(createPaymentLink(config, {}, { fetchImpl: respond(400, { error: { description: 'amount too low' } }) }), e => e instanceof RazorpayError && e.code === 'razorpay_rejected' && e.message === 'amount too low');
  await assert.rejects(createPaymentLink(config, {}, { fetchImpl: async () => { throw new Error('ECONNRESET'); } }), e => e.code === 'razorpay_unreachable');
  await assert.rejects(createPaymentLink(config, {}, { fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError(); } }) }), e => e.code === 'razorpay_rejected' && /502/.test(e.message));
  await assert.rejects(createPaymentLink(config, {}, { fetchImpl: respond(200, { id: 'x' }) }), e => e.code === 'razorpay_rejected', 'a 200 without short_url is not a usable link');
  await assert.rejects(createPaymentLink({ ready: false, reason: 'razorpay_not_configured' }, {}), e => e.code === 'razorpay_not_configured');
});

test('reference lookup returns the live link and ignores cancelled or foreign ones', async () => {
  const { findPaymentLinkByReference, simulatedProvider } = await import('./razorpay.mjs');
  let url;
  const list = links => async u => { url = u; return { ok: true, status: 200, json: async () => ({ payment_links: links }) }; };
  const found = await findPaymentLinkByReference(config, 'rf_pay_1', { fetchImpl: list([{ id: 'p0', reference_id: 'rf_pay_1', status: 'cancelled' }, { id: 'p1', reference_id: 'rf_pay_1', status: 'created', short_url: 'u' }]) });
  assert.equal(found.id, 'p1');
  assert.match(url, /\/v1\/payment_links\?reference_id=rf_pay_1$/);
  assert.equal(await findPaymentLinkByReference(config, 'rf_pay_2', { fetchImpl: list([{ id: 'x', reference_id: 'rf_other', status: 'created' }]) }), null);
  await assert.rejects(findPaymentLinkByReference(config, 'r', { fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) }), e => e.code === 'razorpay_rejected');
  const sim = simulatedProvider();
  const link = await sim.createPaymentLink({ reference_id: 'rf_pay_9' });
  assert.match(link.short_url, /^https:\/\/rzp\.io\/demo\/rf_pay_9$/);
  assert.equal(sim.mode, 'simulated');
});
