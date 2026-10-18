// Public demo (DEMO=on, AUTH=off, no Razorpay keys): seeded history, simulated links, and the full loop works without any network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const start = async env => {
  const port = 5100 + Math.floor(Math.random() * 800);
  const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, DATABASE_URL: '', RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', AUTH: 'off', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { child.stdout.on('data', d => { if (String(d).includes('ready')) resolve(); }); setTimeout(() => reject(new Error('no start')), 5000); });
  const base = `http://127.0.0.1:${port}`;
  const api = (path, body) => fetch(`${base}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'x-ag-csrf': '1' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
  return { api, stop: async () => { child.kill(); await once(child, 'exit'); } };
};

test('demo: seeded cases cover every state and the summary is real', async () => {
  const s = await start({ DEMO: 'on' });
  try {
    const { body } = await s.api('/api/cases');
    assert.equal(body.cases.length, 44, '10 named cases plus two weeks of history');
    assert.deepEqual(body.razorpay, { ready: true, mode: 'simulated' });
    for (const st of ['open', 'held', 'link_sent', 'recovered', 'expired']) assert.ok(body.summary.by_status[st] > 0, st);
    assert.ok(body.summary.recovered >= (2499 + 4899) * 100);
    const trend = await s.api('/api/report?days=14');
    assert.equal(trend.body.daily.length, 14);
    assert.ok(trend.body.daily.filter(d => d.recovered > 0).length >= 5, 'the trend has shape');
    assert.equal(trend.body.daily.reduce((a, d) => a + d.recovered, 0), trend.body.recovered_amount, 'daily buckets add up to the total');
    assert.ok(body.cases.find(c => c.customer.name === 'Ananya Iyer'));
    const audit = await s.api('/api/audit');
    assert.equal(audit.body.integrity.valid, true);
  } finally { await s.stop(); }
});

test('demo: approve sends a simulated link and "customer pays" recovers it', async () => {
  const s = await start({ DEMO: 'on' });
  try {
    const open = (await s.api('/api/cases?status=open')).body.cases[0];
    const approved = await s.api(`/api/cases/${open.id}/approve`, {});
    assert.equal(approved.status, 200);
    assert.match(approved.body.link.short_url, /rzp\.io\/demo\//);
    const paid = await s.api(`/api/demo/pay/${open.id}`, {});
    assert.deepEqual(paid.body, { id: open.id, status: 'recovered' });
    assert.equal((await s.api(`/api/demo/pay/${open.id}`, {})).body.duplicate, true);
    const report = await s.api('/api/report?days=7');
    assert.ok(report.body.recovered.some(r => r.id === open.id));
    const connect = await s.api('/api/connect');
    assert.equal(connect.body.demo, true);
    assert.equal(connect.body.razorpay.mode, 'simulated');
    assert.ok(connect.body.events.includes('payment_link.paid'));
  } finally { await s.stop(); }
});

test('without DEMO and without keys: nothing is simulated and approve explains what to do', async () => {
  const s = await start({ DEMO: '', RAZORPAY_WEBHOOK_SECRET: 'sec' });
  try {
    assert.equal((await s.api('/api/cases')).body.cases.length, 0, 'no seed outside the demo');
    const test1 = await s.api('/api/connect/test-event', {});
    assert.equal(test1.status, 201, 'the test event runs the real signature check and creates a case');
    const id = test1.body.id;
    assert.match(id, /^pay_test_/);
    const approve = await s.api(`/api/cases/${id}/approve`, {});
    assert.equal(approve.status, 409);
    assert.equal(approve.body.error, 'razorpay_not_configured');
    assert.equal((await s.api(`/api/demo/pay/${id}`, {})).status, 404);
    const connect = (await s.api('/api/connect')).body;
    assert.equal(connect.secret_set, true);
    assert.equal(connect.razorpay.ready, false);
    assert.ok(connect.last_event_at);
  } finally { await s.stop(); }
});

test('the test event refuses to run without a webhook secret', async () => {
  const s = await start({ DEMO: '', RAZORPAY_WEBHOOK_SECRET: '' });
  try {
    const r = await s.api('/api/connect/test-event', {});
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'webhook_secret_missing');
  } finally { await s.stop(); }
});
