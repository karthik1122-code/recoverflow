import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';

const PORT = 4300 + Math.floor(Math.random() * 400);
const SECRET = 'test-webhook-secret';
const base = `http://127.0.0.1:${PORT}`;
let child;

test.before(async () => {
  child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(PORT), RAZORPAY_WEBHOOK_SECRET: SECRET }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', d => { if (String(d).includes('ready')) resolve(); });
    child.on('error', reject);
    setTimeout(() => reject(new Error('server did not start')), 5000);
  });
});
test.after(async () => { child.kill(); await once(child, 'exit'); });

const sign = body => createHmac('sha256', SECRET).update(body).digest('hex');
const failed = (id, notes = { recovery_opt_in: 'true' }) => JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id, amount: 125000, currency: 'INR', error_description: 'issuer network timeout', created_at: 1700000000, notes } } } });

test('serves the app with security headers', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
});

test('never serves source files, secrets or traversal paths', async () => {
  for (const path of ['/.env', '/server.mjs', '/core.mjs', '/package.json', '/../server.mjs', '/%2e%2e/server.mjs', '/public/../.env']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 404, `${path} should be 404`);
  }
});

test('rejects malformed and oversized bodies', async () => {
  const bad = await fetch(`${base}/api/diagnose`, { method: 'POST', body: '{not json' });
  assert.equal(bad.status, 400);
  const big = await fetch(`${base}/api/diagnose`, { method: 'POST', body: JSON.stringify({ pad: 'x'.repeat(200 * 1024) }) }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
});

test('diagnose returns a policy decision', async () => {
  const res = await fetch(`${base}/api/diagnose`, { method: 'POST', body: JSON.stringify({ id: 't1', amount: 1000, error_description: 'insufficient balance', customer_opted_in: false }) });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.decision.status, 'held');
  assert.equal(data.decision.policy_code, 'NO_CONSENT');
});

test('webhook: forged signatures are rejected, signed events are accepted once', async () => {
  const body = failed('pay_TEST1');
  const forged = await fetch(`${base}/webhooks/razorpay`, { method: 'POST', headers: { 'x-razorpay-signature': 'deadbeef' }, body });
  assert.equal(forged.status, 401);
  const ok = await fetch(`${base}/webhooks/razorpay`, { method: 'POST', headers: { 'x-razorpay-signature': sign(body) }, body });
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).decision.status, 'approval_required');
  const again = await fetch(`${base}/webhooks/razorpay`, { method: 'POST', headers: { 'x-razorpay-signature': sign(body) }, body });
  assert.equal((await again.json()).duplicate, true);
  const audit = await (await fetch(`${base}/api/audit`)).json();
  assert.equal(audit.integrity.valid, true);
  assert.equal(audit.events.filter(e => e.id === 'pay_TEST1').length, 1);
});

test('test payment links are disabled unless explicitly enabled', async () => {
  const res = await fetch(`${base}/api/create-test-payment-link`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 403);
});

test('landing page, dashboard and their assets are served', async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Recover revenue/);
  for (const path of ['/app.html', '/landing.css', '/landing.js', '/app.js', '/styles.css']) {
    assert.equal((await fetch(`${base}${path}`)).status, 200, path);
  }
});
