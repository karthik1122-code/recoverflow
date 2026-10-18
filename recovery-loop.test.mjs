// End to end: signed failure webhook → case → approve → Razorpay payment link (mocked) → signed paid webhook → recovered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';

const PORT = 4700 + Math.floor(Math.random() * 300);
const SECRET = 'loop-secret';
const base = `http://127.0.0.1:${PORT}`;
const linksCreated = [];
let failNext = 0, child, mock;

test.before(async () => {
  if (process.env.TEST_DATABASE_URL_LOOP) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL_LOOP });
    await pool.query('DROP TABLE IF EXISTS webhook_keys, events, audit, users, sessions, login_failures CASCADE');
    await pool.end();
  }
  mock = createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      if (req.url !== '/v1/payment_links' || req.headers.authorization !== `Basic ${Buffer.from('rzp_test_k:s').toString('base64')}`) { res.writeHead(401).end('{}'); return; }
      if (failNext > 0) { failNext -= 1; res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { description: 'upstream exploded' } })); return; }
      const body = JSON.parse(raw);
      const link = { id: `plink_${linksCreated.length + 1}`, short_url: `https://rzp.io/l/${linksCreated.length + 1}`, status: 'created', expire_by: body.expire_by };
      linksCreated.push({ body, link });
      // Simulate Razorpay latency so concurrent approvals genuinely overlap.
      setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(link)), 40);
    });
  }).listen(0);
  await once(mock, 'listening');
  child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL_LOOP || '', AUTH: 'off', PORT: String(PORT), RAZORPAY_WEBHOOK_SECRET: SECRET, RAZORPAY_KEY_ID: 'rzp_test_k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_API_BASE: `http://127.0.0.1:${mock.address().port}` }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { child.stdout.on('data', d => { if (String(d).includes('ready')) resolve(); }); setTimeout(() => reject(new Error('server did not start')), 5000); });
});
test.after(async () => { child.kill(); await once(child, 'exit'); mock.close(); });

const sign = body => createHmac('sha256', SECRET).update(body).digest('hex');
const hook = body => fetch(`${base}/webhooks/razorpay`, { method: 'POST', headers: { 'x-razorpay-signature': sign(body) }, body });
const api = (path, body) => fetch(`${base}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'x-ag-csrf': '1' }, body: JSON.stringify(body) });
const failure = (id, { amount = 125000, description = 'issuer network timeout', optIn = 'true' } = {}) => JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id, amount, currency: 'INR', email: 'priya@example.in', contact: '+919876543210', error_description: description, created_at: 1700000000, notes: { recovery_opt_in: optIn } } } } });
const linkEvent = (event, caseId, linkId, { amount_paid = 125000, source = 'recoverflow', paymentId = `pay_ok_${caseId}` } = {}) => JSON.stringify({ event, payload: { payment_link: { entity: { id: linkId, amount_paid, notes: { rf_case: caseId, source } } }, payment: { entity: { id: paymentId, amount: amount_paid, created_at: 1700000999 } } } });
const getCase = async id => (await (await api('/api/cases')).json()).cases.find(c => c.id === id);

test('a signed failure becomes an open case with masked customer details', async () => {
  assert.equal((await hook(failure('pay_L1'))).status, 201);
  const c = await getCase('pay_L1');
  assert.equal(c.recovery.status, 'open');
  assert.equal(c.customer.contact, '•••3210');
  assert.equal(c.customer.email, 'p•••@example.in');
  const { razorpay } = await (await api('/api/cases')).json();
  assert.deepEqual(razorpay, { ready: true, mode: 'test' });
});

test('approve creates exactly one Razorpay link that points back to the case, and notifies the customer', async () => {
  const res = await api('/api/cases/pay_L1/approve', {});
  assert.equal(res.status, 200);
  const { case: c, link } = await res.json();
  assert.equal(c.recovery.status, 'link_sent');
  assert.equal(c.recovery.approved_by, 'demo@local');
  assert.equal(link.short_url, 'https://rzp.io/l/1');
  const sent = linksCreated.at(-1).body;
  assert.equal(sent.amount, 125000);
  assert.equal(sent.notes.rf_case, 'pay_L1');
  assert.deepEqual(sent.notify, { sms: true, email: true });
  assert.equal(sent.customer.contact, '+919876543210', 'Razorpay gets the real contact even though the API masks it');
  assert.equal((await api('/api/cases/pay_L1/approve', {})).status, 409, 'a second approval is refused');
  assert.equal(linksCreated.length, 1);
});

test('the paid webhook marks the case recovered; a redelivery changes nothing', async () => {
  const body = linkEvent('payment_link.paid', 'pay_L1', 'plink_1');
  const res = await hook(body);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: 'pay_L1', status: 'recovered' });
  const again = await hook(body);
  assert.deepEqual(await again.json(), { duplicate: true, status: 'recovered' });
  const { summary } = await (await api('/api/cases')).json();
  assert.equal(summary.recovered, 125000);
  assert.equal(summary.recovery_rate, 1);
  const audit = await (await api('/api/audit')).json();
  assert.equal(audit.integrity.valid, true);
  assert.ok(audit.audit.some(a => a.title === 'Payment recovered' && a.payment_id === 'pay_L1'));
  assert.ok(audit.audit.some(a => a.title === 'Recovery approved' && /demo@local/.test(a.detail)));
});

test('policy-held cases cannot be approved, only dismissed', async () => {
  await hook(failure('pay_H1', { description: 'insufficient balance', optIn: 'false' }));
  const res = await api('/api/cases/pay_H1/approve', {});
  assert.equal(res.status, 409);
  assert.equal((await res.json()).status, 'held');
  const dismissed = await api('/api/cases/pay_H1/dismiss', { reason: 'customer called support' });
  assert.equal(dismissed.status, 200);
  assert.equal((await dismissed.json()).case.recovery.dismiss_reason, 'customer called support');
  assert.equal((await api('/api/cases/nope/approve', {})).status, 404);
});

test('a Razorpay failure releases the case so it can be approved again', async () => {
  await hook(failure('pay_F1'));
  failNext = 1;
  const res = await api('/api/cases/pay_F1/approve', {});
  assert.equal(res.status, 502);
  assert.equal((await res.json()).message, 'upstream exploded');
  const c = await getCase('pay_F1');
  assert.equal(c.recovery.status, 'open');
  assert.equal(c.recovery.last_error, 'upstream exploded');
  assert.equal((await api('/api/cases/pay_F1/approve', {})).status, 200);
});

test('ten simultaneous approvals create exactly one payment link', async () => {
  await hook(failure('pay_C1'));
  const before = linksCreated.length;
  const results = await Promise.all(Array.from({ length: 10 }, () => api('/api/cases/pay_C1/approve', {})));
  const statuses = results.map(r => r.status).sort();
  assert.deepEqual(statuses, [200, ...Array(9).fill(409)]);
  assert.equal(linksCreated.length - before, 1);
});

test('expired links close the case; foreign, unknown and mismatched links are not trusted', async () => {
  await hook(failure('pay_E1'));
  const { link } = await (await api('/api/cases/pay_E1/approve', {})).json();
  assert.equal((await hook(linkEvent('payment_link.paid', 'pay_E1', 'plink_someone_else'))).status, 409, 'a link id that is not the case link');
  assert.equal((await hook(linkEvent('payment_link.expired', 'pay_E1', link.id))).status, 200);
  assert.equal((await getCase('pay_E1')).recovery.status, 'expired');
  assert.equal((await hook(linkEvent('payment_link.paid', 'pay_unknown', 'plink_x'))).status, 202);
  assert.equal((await hook(linkEvent('payment_link.paid', 'pay_L1', 'plink_1', { source: 'other_app' }))).status, 202);
});

test('link events must be signed like every other webhook', async () => {
  const res = await fetch(`${base}/webhooks/razorpay`, { method: 'POST', headers: { 'x-razorpay-signature': 'f'.repeat(64) }, body: linkEvent('payment_link.paid', 'pay_C1', 'plink_x') });
  assert.equal(res.status, 401);
});
